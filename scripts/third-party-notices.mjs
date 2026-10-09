import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

function dependencyDirectory(directory, name) {
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error('生产依赖名称无效。');
  let cursor = directory;
  while (true) {
    const candidate = join(cursor, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`缺少生产依赖：${name}`);
    cursor = parent;
  }
}

/** 仅构建时读取已安装生产依赖，为分发包保留第三方版权与许可原文。 */
export function collectThirdPartyNotices(directory) {
  const root = resolve(directory), visited = new Set(), notices = [];
  const lockFile = join(root, 'package-lock.json');
  const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')).packages : null;
  function visit(packageDirectory) {
    const path = realpathSync(packageDirectory);
    if (visited.has(path)) return;
    visited.add(path);
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    if (path !== root) {
      if (lock?.[relative(root, path).split(sep).join('/')]?.version !== manifest.version && lock) {
        throw new Error(`生产依赖不符合锁定版本：${manifest.name}@${manifest.version}`);
      }
      const files = readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(entry.name))
        .map(entry => entry.name).sort();
      let text = files.map(file => `${file}\n${readFileSync(join(path, file), 'utf8')}`).join('\n\n');
      if (!text) {
        const readme = readdirSync(path).find(name => /^readme\.md$/i.test(name));
        const body = readme ? readFileSync(join(path, readme), 'utf8') : '';
        const section = /^#{1,6}\s+(?:LICENSE|LICENCE|COPYING)\s*$/im.exec(body);
        if (section) text = body.slice(section.index).trim();
      }
      if (!text) {
        const fallback = join(root, 'assets', 'third-party', `${encodeURIComponent(manifest.name)}@${encodeURIComponent(manifest.version)}.txt`);
        if (existsSync(fallback)) text = readFileSync(fallback, 'utf8');
      }
      if (!text) throw new Error(`缺少许可证原文：${manifest.name}`);
      notices.push({ name: `${manifest.name}@${manifest.version}`, text: `${manifest.name}@${manifest.version}\n许可声明：${manifest.license ?? '见原文'}\n${text}` });
    }
    for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
      visit(dependencyDirectory(path, name));
    }
    for (const name of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
      try { visit(dependencyDirectory(path, name)); }
      catch (error) { if (!String(error.message).startsWith('缺少生产依赖：')) throw error; }
    }
  }
  if (root === parse(root).root) throw new Error('许可证收集必须从项目目录运行。');
  visit(root);
  return `RainSoul 第三方软件声明\n以下依赖版权及许可属于各自权利人。多许可依赖保留上游全部声明。\n\n${notices.sort((a, b) => a.name.localeCompare(b.name, 'en')).map(item => item.text).join('\n\n========================================\n\n')}\n`;
}
