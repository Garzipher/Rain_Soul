import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createProjectArchive, parseProjectArchive } from '../../src/main/project-archive';

const metadata = { projectId: '0d7bf6a9-067b-42d2-87df-c8cdcc741cd9', schemaVersion: 3 };
// 只模拟 SQLite 文件头；业务关系校验由隔离暂存库的集成测试负责。
function database(size = 512): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write('SQLite format 3\0', 'ascii');
  return bytes;
}
const manifest = (bytes: Buffer) => ({ formatVersion: 1, ...metadata, databaseSha256: createHash('sha256').update(bytes).digest('hex') });
async function zipWith(files: Record<string, Buffer | string>, compression: 'STORE' | 'DEFLATE' = 'STORE'): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression });
}
async function fixture(overrides: Record<string, unknown> = {}, db = database()): Promise<Buffer> {
  return zipWith({ 'manifest.json': JSON.stringify({ ...manifest(db), ...overrides }), 'project.sqlite': db });
}

describe('.rainsoul 受限项目归档', () => {
  it('真实 ZIP 仅包含固定 manifest/database，纯内存往返不改变传入字节', async () => {
    const db = database(), before = Buffer.from(db);
    const bytes = await createProjectArchive(db, metadata);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(['manifest.json', 'project.sqlite']);
    const parsed = await parseProjectArchive(bytes);
    expect(parsed.manifest).toEqual(manifest(db));
    expect(parsed.database).toEqual(db);
    expect(db).toEqual(before);
  });
  it('生成必须拒绝无效 SQLite、无效项目ID/schema及包含密钥或作者资料的metadata', async () => {
    await expect(createProjectArchive(Buffer.from('不是数据库'), metadata)).rejects.toThrow(/SQLite/);
    await expect(createProjectArchive(database(), { ...metadata, projectId: '../其他作品' })).rejects.toThrow(/清单/);
    await expect(createProjectArchive(database(), { ...metadata, schemaVersion: 0 })).rejects.toThrow(/清单/);
    await expect(createProjectArchive(database(), { ...metadata, apiKey: '不应进入归档' } as typeof metadata)).rejects.toThrow(/清单/);
    await expect(createProjectArchive(database(), { ...metadata, authorProfile: { penName: '作者' } } as typeof metadata)).rejects.toThrow(/清单/);
  });
  it('哈希不匹配、错误文件头和缺失固定条目全部拒绝', async () => {
    await expect(parseProjectArchive(await fixture({ databaseSha256: '0'.repeat(64) }))).rejects.toThrow(/哈希/);
    await expect(parseProjectArchive(await fixture({}, Buffer.alloc(512)))).rejects.toThrow(/SQLite/);
    await expect(parseProjectArchive(await zipWith({ 'project.sqlite': database() }))).rejects.toThrow(/条目/);
    await expect(parseProjectArchive(await zipWith({ 'manifest.json': JSON.stringify(manifest(database())) }))).rejects.toThrow(/条目/);
  });
  it('格式版本/清单字段严格验证，JSON或UTF-8损坏不可导入', async () => {
    for (const fields of [{ formatVersion: 2 }, { schemaVersion: -1 }, { apiKey: '不应入包' }, { databaseSha256: '坏哈希' }]) {
      await expect(parseProjectArchive(await fixture(fields))).rejects.toThrow(/清单/);
    }
    await expect(parseProjectArchive(await zipWith({ 'manifest.json': '{', 'project.sqlite': database() }))).rejects.toThrow(/清单/);
    await expect(parseProjectArchive(await zipWith({ 'manifest.json': Buffer.from([0xff]), 'project.sqlite': database() }))).rejects.toThrow(/清单/);
  });
  it('路径穿越、绝对路径、Windows ADS与额外全局资料条目拒绝', async () => {
    for (const name of ['../project.sqlite', '/project.sqlite', 'C:/project.sqlite', 'project.sqlite:secret', 'author-profile.json']) {
      const bytes = await zipWith({ 'manifest.json': JSON.stringify(manifest(database())), [name]: database() });
      await expect(parseProjectArchive(bytes)).rejects.toThrow();
    }
    const extra = await zipWith({ 'manifest.json': '{}', 'project.sqlite': database(), 'key.json': 'secret' });
    await expect(parseProjectArchive(extra)).rejects.toThrow(/条目/);
  });
  it('重复路径、符号链接、加密ZIP和CRC损坏拒绝', async () => {
    const duplicate = await zipWith({ 'manifest.json': '{}', 'manifest.jsoX': '{}' });
    let offset = duplicate.indexOf('manifest.jsoX');
    while (offset !== -1) { duplicate.write('manifest.json', offset, 'ascii'); offset = duplicate.indexOf('manifest.jsoX'); }
    await expect(parseProjectArchive(duplicate)).rejects.toThrow(/条目|重复/);
    const symlink = new JSZip();
    symlink.file('manifest.json', JSON.stringify(manifest(database())));
    symlink.file('project.sqlite', database(), { unixPermissions: 0o120777 });
    await expect(parseProjectArchive(await symlink.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))).rejects.toThrow(/链接/);
    const encrypted = await zipWith({ 'manifest.json': JSON.stringify(manifest(database())), 'project.sqlite': database() }, 'DEFLATE');
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    await expect(parseProjectArchive(encrypted)).rejects.toThrow(/加密/);
    const corrupt = await fixture();
    const payload = corrupt.indexOf('SQLite format 3'); corrupt[payload + 20] ^= 1;
    await expect(parseProjectArchive(corrupt)).rejects.toThrow(/校验|哈希/);
  });
  it('截断/非ZIP文件拒绝；输入、条目、解压和清单体积门槛有效', async () => {
    const bytes = await fixture();
    await expect(parseProjectArchive(Buffer.from('不是ZIP'))).rejects.toThrow();
    await expect(parseProjectArchive(bytes.subarray(0, bytes.length - 10))).rejects.toThrow();
    await expect(parseProjectArchive(bytes, { maxInputBytes: 3 })).rejects.toThrow(/大小/);
    await expect(parseProjectArchive(bytes, { maxEntries: 1 })).rejects.toThrow(/条目/);
    await expect(parseProjectArchive(bytes, { maxExpandedBytes: 100 })).rejects.toThrow(/展开/);
    await expect(parseProjectArchive(bytes, { maxManifestBytes: 3 })).rejects.toThrow(/清单.*大小/);
  });
  it('压缩炸弹必须在展开前拒绝；正常DEFLATE包可用', async () => {
    const db = database(1024 * 1024);
    const bomb = await zipWith({ 'manifest.json': JSON.stringify(manifest(db)), 'project.sqlite': db }, 'DEFLATE');
    await expect(parseProjectArchive(bomb)).rejects.toThrow(/压缩比/);
    const normal = database();
    await expect(parseProjectArchive(await zipWith({ 'manifest.json': JSON.stringify(manifest(normal)), 'project.sqlite': normal }, 'DEFLATE'))).resolves.toMatchObject({ database: normal });
  });
  it('隐藏ZIP注释、unsupported压缩算法与本地/中央名称不一致拒绝', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest(database())), { comment: '不应包含附加资料' });
    zip.file('project.sqlite', database());
    await expect(parseProjectArchive(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/注释/);
    zip.file('manifest.json', JSON.stringify(manifest(database())));
    await expect(parseProjectArchive(await zip.generateAsync({ type: 'nodebuffer', comment: '不应包含附加资料' }))).rejects.toThrow(/注释/);
    const invalidMethod = await fixture();
    const central = invalidMethod.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    invalidMethod.writeUInt16LE(99, central + 10);
    await expect(parseProjectArchive(invalidMethod)).rejects.toThrow(/压缩/);
    const inconsistent = await fixture();
    inconsistent.write('manifest.jsoX', inconsistent.indexOf('manifest.json'), 'ascii');
    await expect(parseProjectArchive(inconsistent)).rejects.toThrow(/不一致/);
  });
  it('生成时冻结数据库，后续外部修改不会污染当前归档', async () => {
    const db = database();
    const bytesPromise = createProjectArchive(db, metadata);
    db.fill(0);
    const parsed = await parseProjectArchive(await bytesPromise);
    expect(parsed.database.subarray(0, 16).toString('ascii')).toBe('SQLite format 3\0');
  });
  it.each([0, -1, NaN, Infinity, 1.5])('非法限额 %s 不可绕过防护', async limit => {
    const bytes = await fixture();
    for (const key of ['maxInputBytes', 'maxEntries', 'maxExpandedBytes', 'maxManifestBytes', 'maxCompressionRatio']) {
      await expect(parseProjectArchive(bytes, { [key]: limit })).rejects.toThrow(/限额/);
    }
  });
});
