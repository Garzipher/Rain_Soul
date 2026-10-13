import { createServer } from 'node:http';
import type { Socket } from 'node:net';

export interface RenderDenyProxy { port: number; proxyRules: string; assertHealthy(): void; close(): Promise<void> }
/** 仅在随机环回端口拒绝请求，不解析目标、不建立任何上游连接。 */
export async function createRenderDenyProxy(): Promise<RenderDenyProxy> {
  const sockets = new Set<Socket>();
  let failure: Error | undefined;
  const server = createServer({ maxHeaderSize: 8192 }, (_request, response) => {
    response.writeHead(403, { Connection: 'close', 'Content-Length': '0' }); response.end();
  });
  server.maxConnections = 16;
  server.on('connect', (_request, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connection', socket => {
    sockets.add(socket); socket.setTimeout(1000, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('拒绝代理未取得环回地址。');
  let closed: Promise<void> | undefined;
  server.on('error', error => { failure = error; for (const socket of sockets) socket.destroy(); server.close(); });
  return { port: address.port, proxyRules: `http=127.0.0.1:${address.port};https=127.0.0.1:${address.port}`,
    assertHealthy() { if (failure || closed || !server.listening) throw new Error('受限拒绝代理已失效。', { cause: failure }); },
    close() {
      closed ??= new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        for (const socket of sockets) socket.destroy();
      }); return closed;
    },
  };
}
