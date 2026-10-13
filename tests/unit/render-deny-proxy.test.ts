import { connect } from 'node:net';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createRenderDenyProxy, type RenderDenyProxy } from '../../src/main/render-deny-proxy';
const servers=vi.hoisted(()=>({last:null as Server|null}));
vi.mock('node:http',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:http')>();
  return {...actual,createServer:vi.fn((...args:Parameters<typeof actual.createServer>)=>{servers.last=actual.createServer(...args);return servers.last;})};
});

const proxies: RenderDenyProxy[] = [];
afterEach(async () => { await Promise.all(proxies.splice(0).map(proxy => proxy.close())); vi.restoreAllMocks(); });
async function proxy() { const value = await createRenderDenyProxy(); proxies.push(value); return value; }
function exchange(port: number, bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1'); let response = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('测试代理响应超时')));
    socket.on('error', reject); socket.on('data', data => { response += data.toString(); });
    socket.on('end', () => resolve(response)); socket.on('connect', () => socket.write(bytes));
  });
}
it.each([
  'GET http://127.0.0.1:9/private HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n',
  'CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com:443\r\n\r\n',
  'POST http://public.example.com/upload HTTP/1.1\r\nHost: public.example.com\r\nContent-Length: 6\r\n\r\nsecret',
])('真实 loopback 代理拒绝请求并关闭连接 %s', async request => {
  const value = await proxy();
  expect(await exchange(value.port, request)).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
  expect(value.proxyRules).toBe(`http=127.0.0.1:${value.port};https=127.0.0.1:${value.port}`);
});
it('随机端口相互独立，关闭后拒绝新连接且销毁挂起客户端', async () => {
  const first = await proxy(), second = await proxy(); expect(first.port).not.toBe(second.port);
  const socket = connect(first.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const ended = new Promise<void>(resolve => socket.once('close', () => resolve()));
  await first.close(); await ended; await first.close();
  await expect(exchange(first.port, 'GET / HTTP/1.1\r\n\r\n')).rejects.toThrow();
  expect(await exchange(second.port, 'CONNECT public.example.com:443 HTTP/1.1\r\n\r\n')).toContain('403');
});
it('第17条未完成连接被立即拒绝，已有客户端仍能得到拒绝响应', async () => {
  const value = await proxy(), sockets = [];
  try {
    for (let i = 0; i < 16; i++) {
      const socket = connect(value.port, '127.0.0.1'); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    }
    const excess = connect(value.port, '127.0.0.1'); sockets.push(excess);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('超限连接未被及时拒绝')), 250);
      excess.once('close', () => { clearTimeout(timeout); resolve(); }); excess.once('error', () => undefined);
    });
    value.assertHealthy();
  } finally { for (const socket of sockets) socket.destroy(); }
});
it.each([
  'GET / HTTP/1.1\r\nHost: public.example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
  '无效HTTP请求\r\n\r\n',
])('升级与损坏请求立即关闭，不产生可用隧道：%s', async bytes => {
  const value=await proxy(); expect(await exchange(value.port,bytes)).toBe(''); value.assertHealthy();
});
it('闲置连接超时关闭，关闭幂等并立即失去健康状态', async () => {
  const value=await proxy(), socket=connect(value.port,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  await new Promise<void>(resolve=>socket.once('close',()=>resolve()));
  value.assertHealthy(); const first=value.close(), second=value.close(); expect(first).toBe(second);
  expect(()=>value.assertHealthy()).toThrow(/失效/); await first;
});
it('运行中的服务错误关闭全部连接并撤销健康状态，清理错误传给调用方', async () => {
  const value=await createRenderDenyProxy(), server=servers.last!, socket=connect(value.port,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  const ended=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
  server.emit('error',new Error('模拟监听故障')); await ended;
  expect(()=>value.assertHealthy()).toThrow(/失效/); await expect(value.close()).rejects.toThrow();
});
it('绑定失败拒绝创建代理，不能报告就绪或留下监听端口', async () => {
  vi.mocked(createServer).mockImplementationOnce((...args:Parameters<typeof createServer>)=>{
    const server=servers.last=createServer(...args);
    vi.spyOn(server,'listen').mockImplementation(()=>{queueMicrotask(()=>server.emit('error',new Error('模拟端口绑定失败')));return server;});
    return server;
  });
  await expect(createRenderDenyProxy()).rejects.toThrow('模拟端口绑定失败'); expect(servers.last!.listening).toBe(false);
});
