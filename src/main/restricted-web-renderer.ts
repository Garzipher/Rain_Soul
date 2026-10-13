import { createHash, randomUUID } from 'node:crypto';
import type { BrowserWindow, Session } from 'electron';
import { RenderResourceBroker, type RenderResource } from './render-resource-broker';
import { installRenderNetworkGuard, type RenderNetworkGuard } from './render-network-guard';
import { installRenderErrorObserver, type RenderErrorObserver } from './render-error-observer';
import { captureBoundedDom } from './render-dom-capture';
import { renderLimits } from './restricted-render-policy';

type Broker=Pick<RenderResourceBroker,'initialize'|'fetch'|'assertHealthy'|'close'>;
interface Context {window:BrowserWindow;session:Session;initialize?:()=>Promise<void>}
interface ProcessIdentity {pid:number;creationTime:number}
interface Dependencies {
  createBroker(url:string,deadline:number,signal:AbortSignal):Broker;
  createContext():Context;
  installGuard(session:Session,broker:Broker,signal:AbortSignal,initial:RenderResource & {finalUrl:string}):Promise<RenderNetworkGuard>;
  installObserver:typeof installRenderErrorObserver;
  allContents():{id:number;pid:number}[];processes():ProcessIdentity[];
}
export interface RenderedArticle {rawBytes:Buffer;finalUrl:string;capturedAt:string;domBytes:Buffer;renderedDomHash:string;warnings:string[];deadline:number}
/** 看门狗在主进程；窗口进程身份不明确或清理失败时阻断新任务。 */
export class RestrictedWebRenderer {
  private active=false;
  private blocked=false;
  constructor(private readonly dependencies:Dependencies){}
  private identity(context:Context):ProcessIdentity {
    const contents=context.window.webContents,pid=contents.getOSProcessId();
    const identity=this.dependencies.processes().find(item=>item.pid===pid);
    if(pid<=0 || !identity || this.dependencies.allContents().some(item=>item.id!==contents.id && item.pid===pid)) throw new Error('无法确认网页渲染进程独立于作者界面。');
    return identity;
  }
  async render(url:string,signal:AbortSignal):Promise<RenderedArticle>{
    if(this.blocked) throw new Error('上次网页清理未完成，请重启应用后再试。');
    if(this.active) throw new Error('已有网页任务正在进行。');
    signal.throwIfAborted(); this.active=true;
    const controller=new AbortController(),deadline=Date.now()+renderLimits.totalTimeoutMs;
    const abort=()=>controller.abort(new Error('网页渲染已取消。'));
    signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new Error('网页渲染超过总期限。')),renderLimits.totalTimeoutMs);
    let context:Context|undefined,guard:RenderNetworkGuard|undefined,observer:RenderErrorObserver|undefined,identity:ProcessIdentity|undefined;
    let broker:Broker|undefined,installation:Promise<RenderNetworkGuard>|undefined,observation:Promise<RenderErrorObserver>|undefined;
    let cleaning=false,result:RenderedArticle|undefined,failure:unknown,cleanupFailure=false;
    const wait=async<T>(operation:Promise<T>):Promise<T>=>{
      let cancel!:()=>void;
      const cancelled=new Promise<never>((_,reject)=>{cancel=()=>reject(controller.signal.reason);if(controller.signal.aborted)cancel();else controller.signal.addEventListener('abort',cancel,{once:true});});
      try{return await Promise.race([operation,cancelled]);}finally{controller.signal.removeEventListener('abort',cancel);}
    };
    const crash=()=>controller.abort(new Error('网页渲染进程已中断。'));
    try{
      broker=this.dependencies.createBroker(url,deadline,controller.signal);
      const initial=await wait(broker.initialize()); controller.signal.throwIfAborted();
      context=this.dependencies.createContext();
      if(context.initialize) await wait(context.initialize());
      identity=this.identity(context);
      context.window.webContents.on('render-process-gone',crash);
      installation=this.dependencies.installGuard(context.session,broker,controller.signal,initial).then(async value=>{if(cleaning)await value.close();return value;});
      // 取消时迟到安装也必须清理，不能让后台通道存活。
      void installation.catch(()=>{if(cleaning)this.blocked=true;});
      guard=await wait(installation);guard.attachWebContents(context.window.webContents);
      observation=this.dependencies.installObserver(context.window.webContents,guard).then(async value=>{if(cleaning)await value.close();return value;});
      void observation.catch(()=>{if(cleaning)this.blocked=true;});
      observer=await wait(observation);
      await wait(context.window.loadURL(initial.finalUrl));identity=this.identity(context);
      await wait(guard.waitForQuiet(deadline,controller.signal));guard.assertHealthy();broker.assertHealthy();
      const source=`(${captureBoundedDom.toString()})(document,${JSON.stringify({maxDomNodes:renderLimits.maxDomNodes,maxDomBytes:renderLimits.maxDomBytes})})`;
      const html:unknown=await wait(context.window.webContents.executeJavaScriptInIsolatedWorld(999,[{code:source}]));
      if(typeof html!=='string' || html.length>renderLimits.maxDomBytes)throw new Error('网页DOM捕获结果无效。');
      const domBytes=Buffer.from(html,'utf8');if(domBytes.length>renderLimits.maxDomBytes)throw new Error('网页DOM容量超限。');
      identity=this.identity(context);guard.assertHealthy();broker.assertHealthy();controller.signal.throwIfAborted();
      result={rawBytes:initial.bytes,finalUrl:initial.finalUrl,capturedAt:new Date().toISOString(),domBytes,
        renderedDomHash:createHash('sha256').update(domBytes).digest('hex'),warnings:[...guard.warnings],deadline};
    }catch(reason){failure=reason;}finally{
      cleaning=true;
      clearTimeout(timer);signal.removeEventListener('abort',abort);
      const cleanup=async(operation:()=>Promise<void>)=>{
        let timeout:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([operation(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('清理超时。')),1000);})]);}catch{cleanupFailure=true;}finally{clearTimeout(timeout);}
      };
      if(context){
        // about:blank尚未完成也可能已有renderer；未知/共享身份不能强杀或放行重试。
        if(!identity){try{identity=this.identity(context);}catch{cleanupFailure=true;}}
        context.window.webContents.removeListener('render-process-gone',crash);
        const currentObserver=observer;if(currentObserver)await cleanup(()=>currentObserver.close(controller.signal.aborted?'terminate':undefined));
        if(identity&&!context.window.isDestroyed()){
          // 最后一次核对后结束任务renderer，窗口销毁本身不能证明进程已退出。
          try{const current=this.identity(context);if(identity.pid===current.pid&&identity.creationTime===current.creationTime)context.window.webContents.forcefullyCrashRenderer();else cleanupFailure=true;}catch{cleanupFailure=true;}
        }
        try{context.window.destroy();}catch{cleanupFailure=true;}
      }
      controller.abort();const currentBroker=broker;if(currentBroker)await cleanup(()=>currentBroker.close());
      if(installation&&!guard)await cleanup(async()=>{await installation!.catch(()=>undefined);});
      if(observation&&!observer)await cleanup(async()=>{await observation!.catch(()=>undefined);});
      const currentGuard=guard;if(currentGuard)await cleanup(()=>currentGuard.close());
      if(context&&!context.window.isDestroyed())cleanupFailure=true;
      const exitedIdentity=identity;
      if(exitedIdentity)await cleanup(async()=>{
        const end=Date.now()+950;
        while(this.dependencies.processes().some(item=>item.pid===exitedIdentity.pid&&item.creationTime===exitedIdentity.creationTime)){
          if(Date.now()>=end)throw new Error('渲染进程未退出。');
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      });
      this.active=false;if(cleanupFailure)this.blocked=true;
    }
    if(cleanupFailure)throw new Error('网页任务清理失败，后续渲染已阻断。');
    if(failure)throw failure;
    if(!result)throw new Error('网页捕获未完成。');
    return result;
  }
}
let production:RestrictedWebRenderer|undefined;
export async function renderPublicArticle(url:string,signal:AbortSignal):Promise<RenderedArticle>{
  if(!production){
    const electron=await import('electron');
    production=new RestrictedWebRenderer({
      createBroker:(initialUrl,deadline,taskSignal)=>new RenderResourceBroker({initialUrl,deadline,signal:taskSignal}),
      createContext:()=>{
        const session=electron.session.fromPartition('rainsoul-render-'+randomUUID(),{cache:false});
        const window=new electron.BrowserWindow({show:false,webPreferences:{session,sandbox:true,contextIsolation:true,webSecurity:true,
          nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,devTools:false,backgroundThrottling:false}});
        window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        return {window,session,initialize:()=>window.loadURL('about:blank')};
      },
      installGuard:installRenderNetworkGuard,installObserver:installRenderErrorObserver,
      allContents:()=>electron.webContents.getAllWebContents().map(contents=>({id:contents.id,pid:contents.getOSProcessId()})),
      processes:()=>electron.app.getAppMetrics().map(({pid,creationTime})=>({pid,creationTime})),
    });
  }
  return production.render(url,signal);
}
