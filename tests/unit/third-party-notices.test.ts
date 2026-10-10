import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { collectThirdPartyNotices } from '../../scripts/third-party-notices.mjs';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rainsoul-license-')); temporary.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { alpha: '1', beta: '1' } }));
  for (const name of ['alpha', 'beta', 'shared']) {
    const directory = join(root, 'node_modules', name); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', dependencies: name === 'shared' ? {} : { shared: '1' } }));
    writeFileSync(join(directory, 'LICENSE'), `${name} copyright and permission`);
  }
  return root;
}
it('递归保留共享依赖的许可证全文且不重复', () => {
  const result = collectThirdPartyNotices(fixture());
  expect(result).toContain('alpha@1.0.0');
  expect(result).toContain('beta copyright and permission');
  expect(result.match(/shared@1.0.0/g)).toHaveLength(1);
});
it('缺少必需生产依赖时拒绝交付不完整声明', () => {
  const root = fixture(); rmSync(join(root, 'node_modules', 'shared'), { recursive: true });
  expect(() => collectThirdPartyNotices(root)).toThrow(/依赖/);
});
it('只有SPDX声明而缺少版权许可原文时阻止构建', () => {
  const root = fixture(); rmSync(join(root, 'node_modules', 'alpha', 'LICENSE'));
  expect(() => collectThirdPartyNotices(root)).toThrow(/许可证/);
});
it('上游把完整许可证放在README专节时保留该节', () => {
  const root = fixture(), directory = join(root, 'node_modules', 'alpha');
  rmSync(join(directory, 'LICENSE'));
  writeFileSync(join(directory, 'README.md'), '# 使用方法\n非许可正文\n\n## LICENSE\nCopyright Alpha\n完整许可原文\n');
  const result = collectThirdPartyNotices(root);
  expect(result).toContain('Copyright Alpha\n完整许可原文');
  expect(result).not.toContain('非许可正文');
});
it('npm包漏发许可文件时只使用与名称版本对应的仓库原文', () => {
  const root = fixture(); rmSync(join(root, 'node_modules', 'alpha', 'LICENSE'));
  const fallback = join(root, 'assets', 'third-party'); mkdirSync(fallback, { recursive: true });
  writeFileSync(join(fallback, 'alpha@1.0.0.txt'), '从已核对版本上游取得的版权原文');
  expect(collectThirdPartyNotices(root)).toContain('从已核对版本上游取得的版权原文');
});
it('安装文件版本与锁文件不一致时拒绝打包声明', () => {
  const root = fixture();
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/alpha': { version: '1.0.1' }, 'node_modules/beta': { version: '1.0.0' }, 'node_modules/shared': { version: '1.0.0' },
  } }));
  expect(() => collectThirdPartyNotices(root)).toThrow(/锁定版本/);
});
it('只收集构建显式列出的已打包模块，不把未打包可选后端算入运行时', () => {
  const root = fixture();
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { alpha: '1', beta: '1' } }));
  const result = collectThirdPartyNotices(root, { bundledDependencies: ['alpha'] });
  expect(result).toContain('alpha@1.0.0');
  expect(result).not.toContain('beta@1.0.0');
  expect(result).not.toContain('shared@1.0.0');
});
it('额外上游NOTICE原文分片须完整且哈希正确，不能漏发或改写', () => {
  const root = fixture(), directory = join(root, 'assets/third-party/alpha@1.0.0.notices');
  mkdirSync(directory, { recursive: true });
  const body = '上游版权第一部分\n第二部分';
  writeFileSync(join(directory, 'part-001.txt'), '上游版权第一部分\n');
  writeFileSync(join(directory, 'part-002.txt'), '第二部分');
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), parts: ['part-001.txt', 'part-002.txt'] }));
  expect(collectThirdPartyNotices(root)).toContain(body);
  writeFileSync(join(directory, 'part-002.txt'), '错误改写');
  expect(() => collectThirdPartyNotices(root)).toThrow(/NOTICE/);
});
