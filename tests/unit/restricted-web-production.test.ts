import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { parseArticleDocument } from '../../src/main/web-article-core';

const host=vi.hoisted(()=>({fromPartition:vi.fn(),createWindow:vi.fn(),allContents:vi.fn(),metrics:vi.fn(),broker:vi.fn(),guard:vi.fn(),observer:vi.fn()}));
vi.mock('electron',()=>({session:{fromPartition:host.fromPartition},BrowserWindow:class{constructor(options:unknown){return host.createWindow(options);}},webContents:{getAllWebContents:host.allContents},app:{getAppMetrics:host.metrics}}));
vi.mock('../../src/main/render-resource-broker',()=>({RenderResourceBroker:class{constructor(options:unknown){return host.broker(options);}}}));
vi.mock('../../src/main/render-network-guard',()=>({installRenderNetworkGuard:host.guard}));
vi.mock('../../src/main/render-error-observer',()=>({installRenderErrorObserver:host.observer}));
vi.mock('../../src/main/web-article',()=>({parseWebArticle:vi.fn(async(bytes:Buffer)=>parseArticleDocument(bytes,'text/html',20000))}));
import { renderPublicArticle } from '../../src/main/restricted-web-renderer';

it('生产适配器始终创建随机非持久session及无应用桥的独立sandbox窗口',async()=>{
  let running=true;const isolated={},contents=Object.assign(new EventEmitter(),{id:7,getOSProcessId:()=>222,setWebRTCIPHandlingPolicy:vi.fn(),forcefullyCrashRenderer:vi.fn(()=>{running=false;}),executeJavaScriptInIsolatedWorld:vi.fn(async()=>'<html><body><article>正文</article></body></html>')});
  const window={webContents:contents,loadURL:vi.fn(async()=>undefined),destroy:vi.fn(()=>{running=false;}),isDestroyed:()=>!running};
  const broker={initialize:vi.fn(async()=>({bytes:Buffer.from('原HTML'),finalUrl:'https://article.example.com/',contentType:'text/html',headers:{}})),assertHealthy:vi.fn(),close:vi.fn(async()=>undefined)};
  host.fromPartition.mockReturnValue(isolated);host.createWindow.mockReturnValue(window);host.broker.mockReturnValue(broker);
  host.allContents.mockReturnValue([{id:7,getOSProcessId:()=>222},{id:1,getOSProcessId:()=>111}]);
  host.metrics.mockImplementation(()=>running?[{pid:222,creationTime:123}]:[]);
  host.guard.mockResolvedValue({warnings:[],attachWebContents:vi.fn(),waitForQuiet:vi.fn(async()=>undefined),assertHealthy:vi.fn(),close:vi.fn(async()=>undefined)});
  host.observer.mockResolvedValue({close:vi.fn(async()=>undefined)});
  expect((await renderPublicArticle('https://article.example.com/',new AbortController().signal)).domBytes.toString()).toContain('正文');
  expect(host.fromPartition).toHaveBeenCalledWith(expect.stringMatching(/^rainsoul-render-[0-9a-f-]{36}$/),{cache:false});
  expect(host.createWindow).toHaveBeenCalledWith({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,webSecurity:true,nodeIntegration:false,nodeIntegrationInWorker:false,webviewTag:false,devTools:false,backgroundThrottling:false}});
  expect(contents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');
  expect(window.loadURL.mock.calls).toEqual([['about:blank'],['https://article.example.com/']]);
  expect(host.guard).toHaveBeenCalledWith(isolated,broker,expect.any(AbortSignal),expect.objectContaining({finalUrl:'https://article.example.com/'}));
  expect(host.observer).toHaveBeenCalledWith(contents,expect.any(Object));expect(window.destroy).toHaveBeenCalledOnce();
});
