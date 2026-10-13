import { connect } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createRenderDenyProxy, type RenderDenyProxy } from '../../src/main/render-deny-proxy';

const proxies: RenderDenyProxy[] = [];
afterEach(async () => { await Promise.all(proxies.splice(0).map(proxy => proxy.close())); });
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
