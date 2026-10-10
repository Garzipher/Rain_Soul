import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { error, log } from 'node:console';
import process from 'node:process';

// 仅提供此次确认原型，避免将项目目录或作者数据暴露给预览服务。
const page = new URL('../docs/demos/rainsoul-source-intelligence.html', import.meta.url);
const server = createServer(async (request, response) => {
  if (!['/', '/rainsoul-source-intelligence.html'].includes(request.url)) {
    response.writeHead(404); response.end('页面不存在'); return;
  }
  try {
    const bytes = await readFile(page);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch {
    response.writeHead(500); response.end('无法读取原型页面');
  }
});
server.on('error', reason => { error('原型预览启动失败：', reason.message); process.exitCode = 1; });
server.listen(4174, '127.0.0.1', () => log('原型预览：http://127.0.0.1:4174/rainsoul-source-intelligence.html'));
