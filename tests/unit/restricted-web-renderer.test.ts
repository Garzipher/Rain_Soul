import { EventEmitter } from 'node:events';
import type { BrowserWindow, Session, WebContents } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { RestrictedWebRenderer } from '../../src/main/restricted-web-renderer';

afterEach(()=>vi.useRealTimers());
function fixture(){
  let destroyed=false, running=true;
  const contents=Object.assign(new EventEmitter(),{id:7,getOSProcessId:()=>222,isDestroyed:()=>destroyed,
    forcefullyCrashRenderer:vi.fn(()=>{running=false;}),executeJavaScriptInIsolatedWorld:vi.fn(async()=>'<html><body><article>动态正文</article></body></html>')});
  const window={webContents:contents as unknown as WebContents,loadURL:vi.fn(async()=>undefined),destroy:vi.fn(()=>{destroyed=true;running=false;}),isDestroyed:()=>destroyed} as unknown as BrowserWindow;
  const broker={initialize:vi.fn(async()=>({bytes:Buffer.from('原始HTML'),finalUrl:'https://article.example.com/page',contentType:'text/html',headers:{}})),fetch:vi.fn(async()=>({bytes:Buffer.alloc(0),contentType:'text/plain',headers:{}})),assertHealthy:vi.fn(),close:vi.fn(async()=>undefined)};
  const guard={warnings:['图片已限制'],attachWebContents:vi.fn(),assertHealthy:vi.fn(),fail:vi.fn(),markObserverReady:vi.fn(),waitForQuiet:vi.fn(async()=>undefined),close:vi.fn(async()=>undefined)};
  const observer={close:vi.fn(async()=>undefined)};
  const dependencies={createBroker:()=>broker,createContext:()=>({window,session:{} as Session}),installGuard:vi.fn(async()=>guard),installObserver:vi.fn(async()=>observer),
    allContents:()=>[{id:7,pid:222},{id:1,pid:111}],processes:()=>running?[{pid:222,creationTime:123}]:[]};
  const renderer=new RestrictedWebRenderer(dependencies);
  return {renderer,dependencies,window,contents,broker,guard,observer};
}
it('捕获前建立观察与独立进程核对，等待安静；保留原HTML和独立DOM哈希并清理',async()=>{
  const f=fixture(),result=await f.renderer.render('https://article.example.com/page',new AbortController().signal);
  expect(result.rawBytes.toString()).toBe('原始HTML');expect(result.domBytes.toString()).toContain('动态正文');
  expect(result.renderedDomHash).toMatch(/^[a-f0-9]{64}$/);expect(result.warnings).toEqual(['图片已限制']);
  expect(f.dependencies.installObserver.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.window.loadURL).mock.invocationCallOrder[0]);
  expect(f.guard.waitForQuiet).toHaveBeenCalledOnce();expect(f.window.destroy).toHaveBeenCalledOnce();expect(f.broker.close).toHaveBeenCalled();expect(f.guard.close).toHaveBeenCalled();
});
it('与作者界面共享进程时拒绝导航且绝不强制结束作者进程',async()=>{
  const f=fixture();f.dependencies.allContents=()=>[{id:7,pid:222},{id:1,pid:222}];
  await expect(f.renderer.render('https://article.example.com/page',new AbortController().signal)).rejects.toThrow(/独立/);
  expect(f.window.loadURL).not.toHaveBeenCalled();expect(f.contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
});
it('正文脚本死循环不会阻塞主进程期限，取消只终止已核对的任务进程',async()=>{
  vi.useFakeTimers();const f=fixture();f.contents.executeJavaScriptInIsolatedWorld.mockImplementation(()=>new Promise(()=>{}));
  const result=f.renderer.render('https://article.example.com/page',new AbortController().signal).catch(e=>e);
  await vi.advanceTimersByTimeAsync(40001);expect(await result).toBeInstanceOf(Error);
  expect(f.contents.forcefullyCrashRenderer).toHaveBeenCalledOnce();expect(f.window.destroy).toHaveBeenCalled();
});
it('进程身份改变时不按旧PID终止；清理失败阻断下一任务',async()=>{
  const f=fixture();f.guard.close.mockRejectedValue(new Error('连接清理失败'));
  await expect(f.renderer.render('https://article.example.com/page',new AbortController().signal)).rejects.toThrow(/清理/);
  await expect(f.renderer.render('https://article.example.com/page',new AbortController().signal)).rejects.toThrow(/清理/);
  expect(f.broker.initialize).toHaveBeenCalledOnce();
});
it('一个实例同时只允许一个任务，取消获取不会导航或产生晚结果',async()=>{
  const f=fixture(),controller=new AbortController();let release!:()=>void;
  f.broker.initialize.mockImplementation(()=>new Promise(resolve=>{release=()=>resolve({bytes:Buffer.from('晚HTML'),finalUrl:'https://article.example.com/page',contentType:'text/html',headers:{}});}));
  const result=f.renderer.render('https://article.example.com/page',controller.signal).catch(e=>e);
  await expect(f.renderer.render('https://article.example.com/page',new AbortController().signal)).rejects.toThrow(/正在/);
  controller.abort();expect(await result).toBeInstanceOf(Error);release();await Promise.resolve();expect(f.window.loadURL).not.toHaveBeenCalled();
});
it('捕获错误或进程崩溃均拒绝结果并走统一清理',async()=>{
  const f=fixture();f.contents.executeJavaScriptInIsolatedWorld.mockRejectedValue(new Error('DOM超限'));
  await expect(f.renderer.render('https://article.example.com/page',new AbortController().signal)).rejects.toThrow(/DOM/);
  expect(f.window.destroy).toHaveBeenCalled();expect(f.observer.close).toHaveBeenCalled();
});
it('取消尚未完成的防护安装会阻断下一任务，不允许迟到通道与新任务重叠',async()=>{
  vi.useFakeTimers();const f=fixture(),controller=new AbortController();let release!:()=>void;
  f.dependencies.installGuard.mockImplementation(()=>new Promise(resolve=>{release=()=>resolve(f.guard);}));
  const first=f.renderer.render('https://article.example.com/page',controller.signal).catch(e=>e);
  await vi.advanceTimersByTimeAsync(0);controller.abort();await vi.advanceTimersByTimeAsync(1001);expect(await first).toBeInstanceOf(Error);
  const retry=f.renderer.render('https://article.example.com/page',new AbortController().signal).catch(e=>e);
  await vi.advanceTimersByTimeAsync(40001);expect((await retry).message).toMatch(/清理/);
  expect(f.broker.initialize).toHaveBeenCalledOnce();release();await vi.advanceTimersByTimeAsync(0);
});
it('销毁后允许进程指标异步移除，正常成功不会误判永久清理失败',async()=>{
  vi.useFakeTimers();const f=fixture();let exited=false;
  f.dependencies.processes=()=>exited?[]:[{pid:222,creationTime:123}];
  vi.mocked(f.window.destroy).mockImplementation(()=>{setTimeout(()=>{exited=true;},100);});
  f.window.isDestroyed=()=>vi.mocked(f.window.destroy).mock.calls.length>0;
  const result=f.renderer.render('https://article.example.com/page',new AbortController().signal).catch(e=>e);
  await vi.advanceTimersByTimeAsync(1001);expect((await result).domBytes?.toString()).toContain('动态正文');
});
