import { isAbsolute, relative, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { compileTextbook } from './build-textbook.mjs';

/** 构建和开发服务器都只提供编译器批准的教材资源。 */
export function textbookPlugin(directory = resolve('learning/项目全流程开发学习')) {
  const virtualId = 'virtual:rainsoul-textbook';
  const resolvedId = `\0${virtualId}`;
  let compiled;
  let compilationError;
  function compile() {
    try { compiled = compileTextbook(directory); compilationError = undefined; }
    catch (error) { compiled = undefined; compilationError = error; throw error; }
  }
  return {
    name: 'rainsoul-textbook',
    buildStart() {
      compile();
      for (const name of readdirSync(directory, { recursive: true })) this.addWatchFile(resolve(directory, name));
    },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      if (compilationError) throw compilationError;
      return `export default ${JSON.stringify(compiled.book)};`;
    },
    generateBundle() {
      for (const asset of compiled.assets) this.emitFile({ type: 'asset', fileName: asset.name, source: asset.bytes });
    },
    configureServer(server) {
      // 仅关注教材目录内的源文与图片；实际读取仍由编译器清单与路径校验限定。
      const refresh = (file) => {
        const local = relative(resolve(directory), resolve(file));
        if (!local || local.startsWith('..') || isAbsolute(local) ||
            !(/\.(md|png)$/i.test(local) || local === 'course.json')) return;
        try { compile(); } catch { /* 清空旧教材，后续模块请求返回构建错误。 */ }
        const module = server.moduleGraph.getModuleById(resolvedId);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload', path: '*' });
      };
      server.watcher.on('change', refresh).on('add', refresh).on('unlink', refresh);
      server.httpServer?.once('close', () => {
        server.watcher.off('change', refresh).off('add', refresh).off('unlink', refresh);
      });
      server.middlewares.use((request, response, next) => {
        if (compilationError && request.url?.startsWith('/learning/')) {
          response.statusCode = 503;
          response.end('教材资源校验失败，请修复源文件。');
          return;
        }
        const asset = compiled?.assets.find((item) => `/${item.name}` === request.url?.split('?')[0]);
        if (!asset) return next();
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(asset.bytes);
      });
    },
  };
}
