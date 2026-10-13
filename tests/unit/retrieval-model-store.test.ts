import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RetrievalModelStore, validateModelDirectory } from '../../src/main/retrieval-model-store';
import { fixedManifest, modelFingerprint, retrievalModelManifestSchema } from '../../src/shared/retrieval-model';

const roots: string[] = [];
const directory = () => { const value = mkdtempSync(join(tmpdir(), 'rainsoul-model-')); roots.push(value); return value; };
const bytes = Buffer.from('公开测试权重');
function fixture(qualified = true) {
  const manifest = structuredClone(fixedManifest);
  for (const key of Object.keys(manifest.qualification) as (keyof typeof manifest.qualification)[]) manifest.qualification[key] = qualified;
  manifest.files = [{ path: 'onnx/model_quantized.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  const source = directory(); mkdirSync(join(source, 'onnx')); writeFileSync(join(source, manifest.files[0].path), bytes);
  return { manifest, source, target: directory() };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('未资格夹具显式关闭所有必需记录，不依赖产品发布清单', () => {
  const { manifest } = fixture(false);
  expect(manifest.qualification).toMatchObject({ publicSourceRecorded: false, networkAuditPassed: false, packagedRuntimePassed: false, qualityCalibrated: false });
});
it('固定清单拒绝未知字段、穿越/重复/容量；指纹包含tokenizer与池化配置', () => {
  expect(() => retrievalModelManifestSchema.parse({ ...fixedManifest, script: '执行' })).toThrow();
  for (const path of ['../outside', 'C:/outside', 'onnx/../model', 'onnx\\model', 'name:ads', '.', '..']) expect(() => retrievalModelManifestSchema.parse({ ...fixedManifest, files: [{ ...fixedManifest.files[0], path }] })).toThrow();
  expect(() => retrievalModelManifestSchema.parse({ ...fixedManifest, files: [fixedManifest.files[0], fixedManifest.files[0]] })).toThrow();
  const altered = structuredClone(fixedManifest); altered.files[1].sha256 = 'a'.repeat(64);
  expect(modelFingerprint(altered)).not.toBe(modelFingerprint());
});
it('离线校验安装原子激活、重启读取、禁用仍保留文件，资格通过后可用', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest });
  expect((await store.getStatus()).state).toBe('absent');
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'ready', installed: true, qualified: true, bytes: bytes.length });
  const active = await store.getActiveDirectory(); expect(active).toBeTruthy();
  expect(readFileSync(join(active!, manifest.files[0].path))).toEqual(bytes);
  expect((await new RetrievalModelStore(target, { manifest }).getStatus()).installed).toBe(true);
  await store.setEnabled(false); expect((await store.getStatus()).state).toBe('disabled');
  expect(await store.getActiveDirectory()).toBeNull();
  await store.setEnabled(true); expect(await store.getActiveDirectory()).toBe(active);
});
it('精确转换链作为记录项，不阻断已通过来源与运行门禁的固定模型', async () => {
  const { manifest, source, target } = fixture();
  Object.assign(manifest.qualification, { publicSourceRecorded: true, officialSourceVerified: false });
  manifest.qualification.conversionRevisionVerified = false;
  const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'ready', installed: true, qualified: true });
  expect(await store.getActiveDirectory()).toBeTruthy();
  await store.setEnabled(false); await store.setEnabled(true);
  expect((await store.getStatus()).state).toBe('ready');
});
it.each(['publicSourceRecorded', 'networkAuditPassed', 'packagedRuntimePassed', 'qualityCalibrated'] as const)('%s未验收仍阻断实际推理', async missing => {
  const { manifest, source, target } = fixture(); manifest.qualification[missing] = false;
  const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ installed: true, qualified: false, state: 'disabled' });
  expect(await store.getActiveDirectory()).toBeNull();
  await expect(store.setEnabled(true)).rejects.toThrow(/资格/);
});
it('质量阈值未确定时即使各验收记录通过也不启用模型', async () => {
  const { manifest, source, target } = fixture(); manifest.similarityThreshold = null;
  const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ installed: true, state: 'disabled', qualified: false });
  expect(await store.getActiveDirectory()).toBeNull();
});
it('错误SHA、长度、未知文件与符号链接不替换旧模型', async () => {
  const { manifest, source, target } = fixture(); const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source }); const active = await store.getActiveDirectory();
  writeFileSync(join(source, manifest.files[0].path), Buffer.alloc(bytes.length));
  await expect(store.install({ operationId: randomUUID(), source: 'local', directory: source })).rejects.toThrow(/校验/);
  expect(await store.getActiveDirectory()).toBe(active);
  writeFileSync(join(source, manifest.files[0].path), bytes); writeFileSync(join(source, 'extra.js'), '未知');
  await expect(validateModelDirectory(source, manifest)).rejects.toThrow(/未知/); rmSync(join(source, 'extra.js'));
  rmSync(join(source, 'onnx'), { recursive: true }); symlinkSync(join(active!, 'onnx'), join(source, 'onnx'), 'junction');
  await expect(validateModelDirectory(source, manifest)).rejects.toThrow(/链接/);
});
it('取消下载保留旧模型，下载URL仅来自固定HTTPS修订清单，拒绝并发', async () => {
  const { manifest, source, target } = fixture(); const urls: string[] = [];
  const controller = new AbortController(); let resume!: () => void;
  const store = new RetrievalModelStore(target, { manifest, download: async function* (url) {
    urls.push(url); await new Promise<void>(resolve => { resume = resolve; }); yield bytes;
  } });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source }); const active = await store.getActiveDirectory();
  const pending = store.install({ operationId: randomUUID(), source: 'download' }, controller.signal);
  while (!resume) await new Promise(resolve => setTimeout(resolve, 1));
  expect((await store.getStatus()).state).toBe('installing');
  await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow(/进行/);
  controller.abort(); resume(); await expect(pending).rejects.toThrow(/取消/);
  expect(urls).toEqual([`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${manifest.files[0].path}`]);
  expect(await store.getActiveDirectory()).toBe(active);
});
it('超限流、已取消、非法身份与作品目录拒绝，原文件保持', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, download: async function* () { yield Buffer.alloc(bytes.length + 1); } });
  await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow(/大小/);
  const aborted = new AbortController(); aborted.abort();
  await expect(store.install({ operationId: randomUUID(), source: 'local', directory: source }, aborted.signal)).rejects.toThrow(/取消/);
  await expect(store.install({ operationId: '../outside', source: 'local', directory: source })).rejects.toThrow();
  expect(() => new RetrievalModelStore(join(target, 'Projects'), { manifest })).toThrow(/作品/);
});
it('外部篡改激活身份或权重时状态失败并保留原文件，不向模型加载器暴露路径', async () => {
  const { manifest, source, target } = fixture(); const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source }); const active = await store.getActiveDirectory();
  writeFileSync(join(active!, manifest.files[0].path), '损坏');
  expect((await store.getStatus()).state).toBe('error'); expect(await store.getActiveDirectory()).toBeNull();
  writeFileSync(join(target, 'selection.json'), JSON.stringify({ schemaVersion: 1, source: 'user', userGeneration: '../outside', fingerprint: modelFingerprint(manifest), enabled: true }));
  expect((await store.getStatus()).state).toBe('error'); expect(await store.getActiveDirectory()).toBeNull();
});
it('完整固定下载可激活，断流和短流保留旧模型，不自动重试', async () => {
  const { manifest, target } = fixture(); let mode = 'ok', attempts = 0;
  const store = new RetrievalModelStore(target, { manifest, download: async function* () {
    attempts++; if (mode === 'throw') throw new Error('下载失败');
    yield mode === 'short' ? bytes.subarray(1) : bytes;
  } });
  await store.install({ operationId: randomUUID(), source: 'download' }); const active = await store.getActiveDirectory();
  mode = 'throw'; await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow(/下载/);
  mode = 'short'; await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow(/大小/);
  expect(attempts).toBe(3); expect(await store.getActiveDirectory()).toBe(active);
});
it('受信下载器停滞时取消立即结束，不等待下一块响应', async () => {
  const { manifest, target } = fixture(); const controller = new AbortController();
  const store = new RetrievalModelStore(target, { manifest, download: async function* () { await new Promise(() => undefined); yield bytes; } });
  const pending = store.install({ operationId: randomUUID(), source: 'download' }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await expect(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('取消未及时结束')), 2000))])).rejects.toThrow('模型安装已取消');
});
it('预检可用空间不足时不访问下载器、不替换旧模型，状态说明所需空间', async () => {
  const { manifest, target } = fixture(); let attempts = 0;
  const store = new RetrievalModelStore(target, { manifest, freeSpace: async () => 1, download: async function* () { attempts++; yield bytes; } });
  await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow(/空间不足/);
  expect(attempts).toBe(0); expect(await store.getStatus()).toMatchObject({ installed: false, availableSpaceBytes: 1 });
});
it.each([true, false])('首次内置来源存在=%s时未资格安装保留默认开启偏好且不暴露推理目录', async bundledPresent => {
  const { manifest, source, target } = fixture(false);
  const store = new RetrievalModelStore(target, { manifest, ...(bundledPresent ? { bundledDirectory: source } : {}) });
  expect(readdirSync(target)).toEqual([]);
  expect(await store.getStatus()).toMatchObject({ source: 'bundled', enabled: true, qualified: false });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ source: 'user', enabled: true, state: 'disabled', qualified: false, installed: true });
  expect(await store.getActiveDirectory()).toBeNull();
  expect(await new RetrievalModelStore(target, { manifest }).getStatus()).toMatchObject({ source: 'user', enabled: true, qualified: false });
});
it('安装进度绑定操作身份与准确字节，可取消本地导入，未资格新模型不能推理', async () => {
  const { manifest, source, target } = fixture(false), operationId = randomUUID();
  const store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId, source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'disabled', installed: true, qualified: false });
  expect(store.getProgress()).toBeNull();
  await expect(store.setEnabled(true)).rejects.toThrow(/资格/); expect(await store.getActiveDirectory()).toBeNull();
});
it('旧激活记录声称启用但资格未通过时，状态与模型目录仍保持停用', async () => {
  const { manifest, source, target } = fixture(false), store = new RetrievalModelStore(target, { manifest });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  const selection = JSON.parse(readFileSync(join(target, 'selection.json'), 'utf8')); selection.enabled = true;
  writeFileSync(join(target, 'selection.json'), JSON.stringify(selection));
  expect(await store.getStatus()).toMatchObject({ installed: true, state: 'disabled', qualified: false });
  expect(await store.getActiveDirectory()).toBeNull();
});
it('分块下载报告已写入字节且状态副本不能篡改安装进度', async () => {
  const { manifest, target } = fixture(), operationId = randomUUID(); let resume!: () => void;
  const store = new RetrievalModelStore(target, { manifest, download: async function* () {
    yield bytes.subarray(0, 3); await new Promise<void>(resolve => { resume = resolve; }); yield bytes.subarray(3);
  } });
  const pending = store.install({ operationId, source: 'download' });
  while (!resume) await new Promise(resolve => setTimeout(resolve, 1));
  const status = await store.getStatus(); expect(status).toMatchObject({ state: 'installing', progress: { operationId, phase: 'downloading', receivedBytes: 3, totalBytes: bytes.length } });
  status.progress!.receivedBytes = 999; expect(store.getProgress()?.receivedBytes).toBe(3);
  resume(); await pending; expect(store.getProgress()).toBeNull();
});
it('新用户默认只读使用可信内置目录，不复制权重或创建激活记录', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'ready', source: 'bundled', bundledPresent: true, enabled: true, installed: true });
  expect(await store.getActiveDirectory()).toBe(source);
  expect(readdirSync(target)).toEqual([]);
  expect(readFileSync(join(source, manifest.files[0].path))).toEqual(bytes);
});
it.each(['publicSourceRecorded', 'networkAuditPassed', 'packagedRuntimePassed', 'qualityCalibrated'] as const)('内置来源的 %s 未通过不能向推理暴露目录', async key => {
  const { manifest, source, target } = fixture(); manifest.qualification[key] = false;
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'disabled', source: 'bundled', installed: true, qualified: false, enabled: true });
  expect(await store.getActiveDirectory()).toBeNull();
});
it('内置停用跨启动保留，显式启用清除旧禁用说明', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  await store.setEnabled(false);
  const restarted = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  expect(await restarted.getStatus()).toMatchObject({ state: 'disabled', enabled: false, source: 'bundled' });
  expect(await restarted.getActiveDirectory()).toBeNull();
  await restarted.setEnabled(true); expect(await restarted.getActiveDirectory()).toBe(source);
});
it('旧 false 手动来源优先迁移，保留原记录并注明禁用来源不明确', async () => {
  const { manifest, source, target } = fixture(), generation = randomUUID();
  mkdirSync(join(target, generation, 'onnx'), { recursive: true }); writeFileSync(join(target, generation, manifest.files[0].path), bytes);
  const original = JSON.stringify({ generation, fingerprint: modelFingerprint(manifest), enabled: false });
  writeFileSync(join(target, 'active.json'), original);
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'disabled', source: 'user', enabled: false, legacyDisabled: true });
  expect(readFileSync(join(target, 'active.json'), 'utf8')).toBe(original);
  await store.setEnabled(true);
  expect(await store.getStatus()).toMatchObject({ legacyDisabled: false, enabled: true });
  expect(await store.getActiveDirectory()).toBe(join(target, generation));
});
it('手动来源损坏不暗换，作者显式换回内置后可恢复并保留手动身份', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  const userDirectory = (await store.getActiveDirectory())!;
  writeFileSync(join(userDirectory, manifest.files[0].path), '损坏');
  expect(await store.getStatus()).toMatchObject({ state: 'error', source: 'user', bundledPresent: true });
  expect(await store.getActiveDirectory()).toBeNull();
  await store.selectSource('bundled'); expect(await store.getActiveDirectory()).toBe(source);
  await expect(store.selectSource('user')).rejects.toThrow(/校验/);
  expect(await store.getActiveDirectory()).toBe(source);
  writeFileSync(join(userDirectory, manifest.files[0].path), bytes);
  await store.selectSource('user'); expect(await store.getActiveDirectory()).toBe(userDirectory);
});
it('内置缺失、错误 hash 或未知文件不可用且不会联网修复', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  writeFileSync(join(source, manifest.files[0].path), Buffer.alloc(bytes.length));
  expect(await store.getStatus()).toMatchObject({ state: 'error', source: 'bundled', bundledPresent: true });
  expect(await store.getActiveDirectory()).toBeNull();
  writeFileSync(join(source, manifest.files[0].path), bytes); writeFileSync(join(source, 'extra'), '额外文件');
  expect((await store.getStatus()).state).toBe('error');
  rmSync(source, { recursive: true });
  expect(await store.getStatus()).toMatchObject({ state: 'absent', bundledPresent: false });
  await expect(store.selectSource('bundled')).rejects.toThrow();
});
it('坏选择原样保留，不能偷偷使用有效内置模型', async () => {
  const { manifest, source, target } = fixture();
  for (const original of ['损坏']) {
    writeFileSync(join(target, 'selection.json'), original);
    const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
    expect((await store.getStatus()).state).toBe('error'); expect(await store.getActiveDirectory()).toBeNull();
    await expect(store.setEnabled(true)).rejects.toThrow();
    await expect(store.selectSource('bundled')).rejects.toThrow();
    expect(readFileSync(join(target, 'selection.json'), 'utf8')).toBe(original);
  }
});
it('停用偏好在换源和重新导入后保持，不因安装成功偷偷开启', async () => {
  const { manifest, source, target } = fixture();
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  await store.setEnabled(false);
  await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'disabled', source: 'user', enabled: false });
  await store.selectSource('bundled');
  expect(await store.getStatus()).toMatchObject({ state: 'disabled', source: 'bundled', enabled: false });
  expect(await store.getActiveDirectory()).toBeNull();
});
it.each([
  { record: 'selection', enabled: true, action: 'install' }, { record: 'selection', enabled: false, action: 'install' },
  { record: 'selection', enabled: true, action: 'bundled' }, { record: 'selection', enabled: false, action: 'bundled' },
  { record: 'active', enabled: true, action: 'install' }, { record: 'active', enabled: false, action: 'install' },
  { record: 'active', enabled: true, action: 'bundled' }, { record: 'active', enabled: false, action: 'bundled' },
])('旧 $record 指纹仅显式 $action 修复，enabled=$enabled 保持且旧记录不丢', async ({ record, enabled, action }) => {
  const { manifest, source, target } = fixture(), generation = randomUUID();
  const original = JSON.stringify(record === 'selection'
    ? { schemaVersion: 1, source: 'user', userGeneration: generation, fingerprint: '旧版本', enabled }
    : { generation, fingerprint: '旧版本', enabled }, null, 2);
  writeFileSync(join(target, `${record}.json`), original);
  const store = new RetrievalModelStore(target, { manifest, bundledDirectory: source });
  expect(await store.getStatus()).toMatchObject({ state: 'error', source: 'user', enabled, message: expect.stringMatching(/版本/) });
  expect(await store.getActiveDirectory()).toBeNull();
  expect(readFileSync(join(target, `${record}.json`), 'utf8')).toBe(original);
  if (action === 'install') await store.install({ operationId: randomUUID(), source: 'local', directory: source });
  else await store.selectSource('bundled');
  expect(await store.getStatus()).toMatchObject({ source: action === 'install' ? 'user' : 'bundled', enabled, installed: true });
  expect(JSON.parse(readFileSync(join(target, 'selection.json'), 'utf8')).fingerprint).toBe(modelFingerprint(manifest));
  if (record === 'active') expect(readFileSync(join(target, 'active.json'), 'utf8')).toBe(original);
  else {
    const backups = readdirSync(target).filter(name => name.startsWith('.selection-backup-'));
    expect(backups).toHaveLength(1); expect(readFileSync(join(target, backups[0]), 'utf8')).toBe(original);
  }
  expect(await new RetrievalModelStore(target, { manifest, bundledDirectory: source }).getStatus()).toMatchObject({ enabled });
  if (!enabled) expect(await store.getActiveDirectory()).toBeNull();
});
it('坏选择记录不能借显式安装猜测偏好，原文件和下载器保持不变', async () => {
  const { manifest, target } = fixture(); let downloads = 0;
  writeFileSync(join(target, 'selection.json'), '损坏原记录');
  const store = new RetrievalModelStore(target, { manifest, download: async function* () { downloads++; yield bytes; } });
  await expect(store.install({ operationId: randomUUID(), source: 'download' })).rejects.toThrow();
  expect(downloads).toBe(0); expect(readFileSync(join(target, 'selection.json'), 'utf8')).toBe('损坏原记录');
  expect(readdirSync(target)).toEqual(['selection.json']);
});
