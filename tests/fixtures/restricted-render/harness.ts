import { app, BrowserWindow, session, webContents } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { RestrictedWebRenderer } from '../../../src/main/restricted-web-renderer';
import { RenderResourceBroker } from '../../../src/main/render-resource-broker';
import { installRenderNetworkGuard } from '../../../src/main/render-network-guard';
import { installRenderErrorObserver } from '../../../src/main/render-error-observer';
import { getWebRenderCapability } from '../../../src/main/restricted-render-policy';
import { parseArticleDocument } from '../../../src/main/web-article-core';

/** 仅由测试构建打包，生产入口不引用、不读取任何环境旁路。 */
const output = process.argv[2];
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => undefined);
let tcpConnections = 0, uploadBytes = 0, udpPackets = 0;
const target = createServer(socket => { tcpConnections++; socket.on('data', bytes => { uploadBytes += bytes.length; }); socket.destroy(); });
const udp = createSocket('udp4'); udp.on('message', () => udpPackets++);
type Result = { name: string; expected: 'success' | 'rejected'; status: 'passed' | 'failed'; error?: string; elapsedMs: number; requests: string[]; stages: string[]; renderedDomHash?: string; network: { tcpConnections: number; uploadBytes: number; udpPackets: number }; remainingContents: number; remainingTaskProcess: boolean };
const results: Result[] = [];
async function main() {
await app.whenReady();
await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
await new Promise<void>(resolve => udp.bind(0, '127.0.0.1', resolve));
const address = target.address(); if (!address || typeof address === 'string') throw new Error('测试靶未建立。');
const forbidden = `https://127.0.0.1:${address.port}/private`;
const origin = 'https://capture.example.com';
const header = '<!doctype html><html><head><meta charset="utf-8"></head><body><article id="article"></article>';
const trailer = '</body></html>';
const fixtures = [
  { name: 'inline', expected: 'success' as const, html: `${header}<script>document.getElementById('article').textContent='动态文章：内联脚本完成。'</script>${trailer}`, contains: '动态文章：内联脚本完成。' },
  { name: 'delayed-article', expected: 'success' as const, html: `${header}<script>setTimeout(()=>{document.getElementById('article').textContent='延迟一秒半后渲染的正文。'},1500)</script>${trailer}`, contains: '延迟一秒半后渲染的正文。' },
  { name: 'staged-article', expected: 'success' as const, html: `${header}<script>document.getElementById('article').textContent='第一段正文。';setTimeout(()=>{document.getElementById('article').textContent+='延迟补齐的第二段正文。'},1000)</script>${trailer}`, contains: '延迟补齐的第二段正文。' },
  { name: 'same-origin-script-fetch-xhr', expected: 'success' as const, html: `${header}<script src="/article.js"></script>${trailer}`, contains: '动态正文来自fetch与XHR', script: "Promise.all([fetch('/fetch').then(r=>r.text()),new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET','/xhr');x.onload=()=>resolve(x.responseText);x.send();})]).then(parts=>{document.getElementById('article').textContent=parts.join('');});" },
  { name: 'csp-cross-origin-script', expected: 'rejected' as const, html: `${header}<script src="https://cdn.example.com/article.js"></script>${trailer}` },
  { name: 'csp-connect-caught', expected: 'rejected' as const, html: `${header}<script>fetch('https://cdn.example.com/data').catch(()=>{});document.getElementById('article').textContent='不完整文章';</script>${trailer}` },
  { name: 'private-network-upload', expected: 'rejected' as const, html: `${header}<script>fetch('${forbidden}',{method:'POST',body:'受控上传测试'}).catch(()=>{});</script>${trailer}` },
  { name: 'infinite-loop-cancel', expected: 'rejected' as const, html: `${header}<script>while(true){}</script>${trailer}`, cancelAfterMs: 1000 },
];
try {
  for (const fixture of fixtures) {
    process.stderr.write(`开始夹具：${fixture.name}\n`);
    const controller = new AbortController(), requests: string[] = [], stages: string[] = [], before = { tcpConnections, uploadBytes, udpPackets };
    const start = Date.now(); let cancelTimer: ReturnType<typeof setTimeout> | undefined, taskPid = 0;
    const renderer = new RestrictedWebRenderer({
      createBroker: (initialUrl, deadline, signal) => new RenderResourceBroker({ initialUrl, deadline, signal, dependencies: {
        resolveHost: async () => ['8.8.8.8'],
        openRequest: ((url: string, _options: unknown, receive: (response: IncomingMessage) => void) => {
          requests.push(url); const path = new URL(url).pathname;
          const raw = new PassThrough(), response = raw as unknown as IncomingMessage;
          response.statusCode = 200; response.headers = { 'content-type': path === '/article.js' ? 'text/javascript; charset=utf-8' : path === '/fetch' || path === '/xhr' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' };
          const request = new EventEmitter() as ClientRequest; request.destroy = () => { raw.destroy(); return request; };
          request.end = (() => { queueMicrotask(() => { receive(response); raw.end(path === '/article.js' ? fixture.script : path === '/fetch' ? '动态正文来自fetch' : path === '/xhr' ? '与XHR' : fixture.html); }); return request; }) as ClientRequest['end'];
          return request;
        }) as never,
      } }),
      createContext: () => {
        const isolated = session.fromPartition('qualification-' + randomUUID(), { cache: false });
        const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, webSecurity: true, nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, devTools: false, backgroundThrottling: false } });
        window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        window.webContents.on('did-start-loading', () => { stages.push('loading'); if (fixture.cancelAfterMs && stages.includes('observer-ready') && !cancelTimer) cancelTimer = setTimeout(() => controller.abort(), fixture.cancelAfterMs); });
        window.webContents.on('did-finish-load', () => stages.push('loaded'));
        return { window, session: isolated, initialize: async () => { await window.loadURL('about:blank'); taskPid = window.webContents.getOSProcessId(); stages.push('task-pid:' + taskPid); } };
      },
      installGuard: async (...args) => {
        stages.push('guard-start:httpsHandled=' + await args[0].protocol.isProtocolHandled('https'));
        try { const guard = await installRenderNetworkGuard(...args); stages.push('guard-ready'); const close = guard.close; return { ...guard, fail: type => { stages.push('guard-failed:' + type); guard.fail(type); }, close: async () => { try { await close(); stages.push('guard-closed'); } catch (reason) { stages.push('guard-close-error:' + String(reason)); throw reason; } } }; }
        catch (reason) { stages.push('guard-error:' + String(reason)); throw reason; }
      },
      installObserver: async (...args) => {
        try { const observer = await installRenderErrorObserver(...args); stages.push('observer-ready'); return { close: async mode => { try { await observer.close(mode); stages.push('observer-closed'); } catch (reason) { stages.push('observer-close-error:' + String(reason)); throw reason; } } }; }
        catch (reason) { stages.push('observer-error:' + String(reason)); throw reason; }
      },
      allContents: () => webContents.getAllWebContents().map(contents => ({ id: contents.id, pid: contents.getOSProcessId() })),
      processes: () => app.getAppMetrics().map(({ pid, creationTime }) => ({ pid, creationTime })),
      // 临时测试bundle只替代解析Worker部署，仍使用生产纯正文解析器。
      parse: async bytes => parseArticleDocument(bytes, 'text/html', 20000),
    });
    let error: string | undefined, html = '', renderedDomHash: string | undefined;
    try {
      const result = await renderer.render(origin + '/', controller.signal); html = result.domBytes.toString('utf8'); renderedDomHash = result.renderedDomHash;
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    finally { clearTimeout(cancelTimer); }
    const network = { tcpConnections: tcpConnections - before.tcpConnections, uploadBytes: uploadBytes - before.uploadBytes, udpPackets: udpPackets - before.udpPackets };
    const clean = stages.includes('observer-closed') && stages.includes('guard-closed') && !stages.some(stage => stage.includes('close-error')) && webContents.getAllWebContents().length === 0;
    const success = fixture.expected === 'success' ? !error && html.includes(fixture.contains!) : !!error && !error.includes('清理') && (fixture.cancelAfterMs ? error.includes('取消') : stages.some(stage => stage.startsWith('guard-failed:'))) && stages.includes('observer-ready') && stages.filter(stage => stage === 'loading').length >= 2;
    results.push({ name: fixture.name, expected: fixture.expected, status: success && clean && !network.tcpConnections && !network.uploadBytes && !network.udpPackets ? 'passed' : 'failed', error, elapsedMs: Date.now() - start, requests, stages, renderedDomHash, network, remainingContents: webContents.getAllWebContents().length, remainingTaskProcess: app.getAppMetrics().some(item => item.pid === taskPid) });
    process.stderr.write(`完成夹具：${JSON.stringify(results.at(-1))}\n`);
  }
  await writeFile(output, JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), electronVersion: process.versions.electron, platform: process.platform, productionCapability: getWebRenderCapability(), results,
    fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),
    qualification: { runtimeFixtures: results.every(result => result.status === 'passed') ? 'passed' : 'failed', controlledTargets: tcpConnections === 0 && uploadBytes === 0 && udpPackets === 0 ? 'passed' : 'failed', systemNetworkAudit: 'pending', realPackage: 'pending', networkIsolation: 'pending' },
  }, null, 2));
} finally { await new Promise<void>(resolve => target.close(() => resolve())); udp.close(); app.quit(); }
}
void main().catch(error => { process.stderr.write(String(error)); app.exit(1); });
