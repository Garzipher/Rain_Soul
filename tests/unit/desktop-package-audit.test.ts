import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPackageWithOptions } from '@electron/asar';
import { afterEach, expect, it } from 'vitest';
import { auditDesktopPackage, checkDesktopBuild } from '../../scripts/desktop-package-audit.mjs';

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'rainsoul-members-')); roots.push(root); return root; };
const put = (root: string, path: string, body = '构建资源') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
const build = () => {
  const root = fixture(); put(root, 'desktop/main.cjs'); put(root, 'desktop/preload.cjs'); put(root, 'renderer/index.html');
  put(root, 'desktop/retrieval-wasm/ort-wasm-simd-threaded.wasm'); put(root, 'renderer/assets/index-A1b2c3d4.js');
  put(root, `renderer/learning/${'a'.repeat(64)}.png`); return root;
};
async function pack(input: string, additions: string[] = []) {
  const root = fixture(), stage = join(root, 'stage'), resources = join(root, 'resources'); mkdirSync(resources);
  const { cpSync } = await import('node:fs'); cpSync(input, join(stage, 'dist'), { recursive: true }); put(stage, 'package.json', '{"main":"dist/desktop/main.cjs"}');
  put(stage, 'node_modules/better-sqlite3/prebuilds/test.node');
  for (const path of additions) put(stage, path);
  await createPackageWithOptions(stage, join(resources, 'app.asar'), { unpack: '{**/*.wasm,**/*.node}' }); return resources;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('只接受已知构建成员，摘要稳定且记录每个文件内容', async () => {
  const root = build(), first = await checkDesktopBuild(root); expect(first.files).toHaveLength(6);
  expect(first.membersSha256).toMatch(/^[a-f0-9]{64}$/); expect(await checkDesktopBuild(root)).toEqual(first);
  put(root, 'desktop/main.cjs', '改动'); expect((await checkDesktopBuild(root)).membersSha256).not.toBe(first.membersSha256);
});
it.each(['Projects/project.sqlite', 'research.log', 'desktop/project.db', 'desktop/research.log', 'desktop/作者素材.txt', 'renderer/作者.docx', 'renderer/assets/author.js', 'renderer/learning/作者.png', 'renderer/assets/index-A1b2c3d4.js/正文.txt'])('拒绝构建输入中的意外成员 %s', async path => {
  const root = build(); if (path.includes('.js/')) rmSync(join(root, 'renderer/assets/index-A1b2c3d4.js'));
  put(root, path); await expect(checkDesktopBuild(root)).rejects.toThrow(/构建|成员|目录/);
});
it('拒绝空未知目录、目录大小写歧义及junction，不读取作者库内容', async () => {
  for (const directory of ['unknown', 'Desktop']) { const root = fixture(); mkdirSync(join(root, directory)); await expect(checkDesktopBuild(root)).rejects.toThrow(); }
  const root = build(), outside = fixture(); put(outside, '作者.sqlite'); symlinkSync(outside, join(root, 'desktop', 'linked'), 'junction');
  await expect(checkDesktopBuild(root)).rejects.toThrow(/链接|目录|成员/);
});
it('研究构建可保留旧模型输入，但模型必须由独立策略核验且不进入构建成员', async () => {
  const root = build(); put(root, 'retrieval-model/old/weights/model.onnx'); expect((await checkDesktopBuild(root)).files).toHaveLength(6);
});
it('实际ASAR审计绑定字节摘要，核对构建内容和解包旁树', async () => {
  const input = build(), resources = await pack(input), expected = await checkDesktopBuild(input);
  const audit = await auditDesktopPackage(resources, expected);
  expect(audit.asarSha256).toBe(createHash('sha256').update(readFileSync(join(resources, 'app.asar'))).digest('hex'));
  expect(audit.buildMembersSha256).toBe(expected.membersSha256); expect(audit.unpackedFiles).toBe(2); expect(audit.memberCount).toBe(8);
});
it.each(['Projects/project.sqlite', 'dist/desktop/research.log', 'dist/renderer/作者.docx', 'dist/retrieval-model/revision/model.onnx', 'node_modules/valid/research.log', 'node_modules/valid/project.sqlite-wal', 'node_modules/valid/project.db-shm', 'node_modules/valid/research.log.1', 'credentials.json'])('实际ASAR拒绝未授权成员 %s', async addition => {
  const input = build(), resources = await pack(input, [addition]); await expect(auditDesktopPackage(resources, await checkDesktopBuild(input))).rejects.toThrow();
});
it('拒绝遗漏构建成员、打包期间内容变化以及外加解包数据库', async () => {
  const input = build(), expected = await checkDesktopBuild(input); put(input, 'desktop/main.cjs', '打包期间更改');
  let resources = await pack(input); await expect(auditDesktopPackage(resources, expected)).rejects.toThrow(/内容|摘要/);
  rmSync(join(input, 'desktop/preload.cjs')); resources = await pack(input); await expect(auditDesktopPackage(resources, expected)).rejects.toThrow(/缺失|成员/);
  resources = await pack(input); put(join(resources, 'app.asar.unpacked'), 'Projects/project.sqlite');
  await expect(auditDesktopPackage(resources, await checkDesktopBuild(input))).rejects.toThrow(/解包|成员/);
});
it('解包WASM被篡改或替换为junction时拒绝，不依赖ASAR头内声明', async () => {
  const input = build(), expected = await checkDesktopBuild(input); let resources = await pack(input);
  put(join(resources, 'app.asar.unpacked'), 'dist/desktop/retrieval-wasm/ort-wasm-simd-threaded.wasm', '篡改');
  await expect(auditDesktopPackage(resources, expected)).rejects.toThrow(/摘要|内容|解包/);
  resources = await pack(input); const side = join(resources, 'app.asar.unpacked'); rmSync(side, { recursive: true });
  const outside = fixture(); symlinkSync(outside, side, 'junction'); await expect(auditDesktopPackage(resources, expected)).rejects.toThrow(/链接/);
});
it.each(['project.sqlite', 'research.log', '作者素材.txt', 'default_app.asar', 'retrieval-model/旧模型.onnx'])('resources外层拒绝额外或未经核验的资源 %s', async addition => {
  const input = build(), resources = await pack(input); put(resources, addition);
  await expect(auditDesktopPackage(resources, await checkDesktopBuild(input))).rejects.toThrow();
});
it('资源版权声明及Electron默认归档只允许与既定输入字节一致', async () => {
  const input = build(); put(input, 'desktop/THIRD_PARTY_NOTICES.txt', '版权');
  const resources = await pack(input), vendor = fixture(); put(resources, 'THIRD_PARTY_NOTICES.txt', '版权');
  put(vendor, 'default_app.asar', '官方默认归档'); put(resources, 'default_app.asar', '官方默认归档');
  const expected = await checkDesktopBuild(input), options = { vendorDefaultAsar: join(vendor, 'default_app.asar') };
  await expect(auditDesktopPackage(resources, expected, options)).resolves.toMatchObject({ schemaVersion: 1 });
  put(resources, 'THIRD_PARTY_NOTICES.txt', '额外作者正文'); await expect(auditDesktopPackage(resources, expected, options)).rejects.toThrow(/资源|内容/);
  put(resources, 'THIRD_PARTY_NOTICES.txt', '版权'); put(resources, 'default_app.asar', '额外作者素材');
  await expect(auditDesktopPackage(resources, expected, options)).rejects.toThrow(/资源|归档/);
});
