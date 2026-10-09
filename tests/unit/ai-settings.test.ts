import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSettingsStore, type AiSafeStorage } from '../../src/main/ai-settings';
import type { AiProvider } from '../../src/shared/ai';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('云端 AI 配置和加密凭据', () => {
  let directory: string, store: AiSettingsStore, encryption: AiSafeStorage;
  const provider: AiProvider = { id: 'cloud-default', name: '云端模型', baseUrl: 'https://example.com/v1', model: 'author-model' };
  const secret = 'sk-不可出现在文件或错误中的秘密';
  const file = () => join(directory, 'ai-settings.json');
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'rainsoul-ai-settings-'));
    const key = randomBytes(32);
    encryption = {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'dpapi',
      encryptString: value => { const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); return Buffer.concat([nonce, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
      decryptString: bytes => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'); },
    };
    store = new AiSettingsStore(directory, encryption);
  });
  afterEach(() => {
    vi.mocked(fs.renameSync).mockReset();
    vi.mocked(fs.renameSync).mockImplementation((source, target) => process.getBuiltinModule('fs').renameSync(source, target));
    rmSync(directory, { recursive: true, force: true });
  });
  it('未配置不创建文件，加密保存、重启读取，公开配置永不包含密钥', async () => {
    expect(store.get()).toEqual({ provider: null, hasCredential: false });
    expect(await store.read(provider.id)).toBeNull(); expect(readdirSync(directory)).toEqual([]);
    expect(store.save(provider, secret)).toEqual({ provider, hasCredential: true });
    expect(readFileSync(file(), 'utf8')).not.toContain(secret);
    expect(readFileSync(file(), 'utf8')).not.toContain(Buffer.from(secret).toString('base64'));
    expect(await new AiSettingsStore(directory, encryption).read(provider.id)).toBe(secret);
    expect(await store.read(randomUUID())).toBeNull();
    const exposed = store.get(); exposed.provider!.name = '修改副本'; expect(store.get().provider!.name).toBe(provider.name);
  });
  it('同服务修改配置保留密钥，换地址或ID清除旧凭据，清除操作幂等', async () => {
    store.save(provider, secret); store.save({ ...provider, model: 'next-model' });
    expect(await store.read(provider.id)).toBe(secret);
    expect(store.save({ ...provider, baseUrl: 'https://other.example/v1' }).hasCredential).toBe(false);
    store.save(provider, secret); store.save({ ...provider, id: randomUUID() });
    expect(await store.read(provider.id)).toBeNull();
    store.clear(); store.clear(); expect(store.get()).toEqual({ provider: null, hasCredential: false });
  });
  it.each([false, 'basic_text'])('系统加密不可用或明文后端时拒绝存储，原配置保持', available => {
    store.save(provider, secret); const before = readFileSync(file(), 'utf8');
    encryption.isEncryptionAvailable = () => available !== false;
    encryption.getSelectedStorageBackend = () => available === 'basic_text' ? 'basic_text' : 'dpapi';
    expect(() => store.save(provider, '新秘密')).toThrow(/加密/);
    expect(readFileSync(file(), 'utf8')).toBe(before);
  });
  it.each([{ ...provider, id: '../escape' }, { ...provider, extra: secret }, { ...provider, model: '' }, { ...provider, baseUrl: 'http://example.com/v1' }, { ...provider, baseUrl: 'https://user:secret@example.com' }])('非法provider不改变文件', value => {
    store.save(provider, secret); const before = readFileSync(file(), 'utf8');
    expect(() => store.save(value)).toThrow(/配置/); expect(readFileSync(file(), 'utf8')).toBe(before);
  });
  it.each(['', 'x\nAuthorization: injected', 'x'.repeat(8193)])('拒绝空、控制字符及超限密钥', key => {
    expect(() => store.save(provider, key)).toThrow(/凭据/); expect(readdirSync(directory)).toEqual([]);
  });
  it('读取配置损坏、超限或未知字段时提示并保留原文件', () => {
    for (const raw of ['{', 'x'.repeat(65537), JSON.stringify({ version: 1, provider, credential: null, secret })]) {
      writeFileSync(file(), raw);
      expect(() => store.get()).toThrow(/损坏/); expect(() => store.save(provider, secret)).toThrow(/损坏/);
      expect(readFileSync(file(), 'utf8')).toBe(raw);
    }
  });
  it('加解密异常不泄露密钥、底层错误或密文，读取篡改凭据明确失败', async () => {
    encryption.encryptString = () => { throw new Error(secret); };
    expect(() => store.save(provider, secret)).toThrow('系统凭据加密失败，请检查系统加密服务后重试。');
    writeFileSync(file(), JSON.stringify({ version: 1, provider, credential: Buffer.from('损坏密文').toString('base64') }));
    encryption.decryptString = () => { throw new Error(secret); };
    await expect(store.read(provider.id)).rejects.toThrow('系统凭据无法解密，请重新配置；原文件已保留。');
  });
  it('拒绝返回原文的伪加密，非法base64和解密后的控制字符', async () => {
    encryption.encryptString = value => Buffer.from(value);
    expect(() => store.save(provider, secret)).toThrow(/加密失败/);
    expect(readdirSync(directory)).toEqual([]);
    writeFileSync(file(), JSON.stringify({ version: 1, provider, credential: '%%%not-base64' }));
    expect(() => store.get()).toThrow(/损坏/);
    writeFileSync(file(), JSON.stringify({ version: 1, provider, credential: 'c2VjcmV0' }));
    encryption.decryptString = () => 'secret\nheader';
    await expect(store.read(provider.id)).rejects.toThrow(/无法解密/);
  });
  it('缺失凭据可独立维护配置，加密不可用时读取已有密钥拒绝明文降级', async () => {
    expect(store.save(provider)).toEqual({ provider, hasCredential: false });
    expect(await store.read(provider.id)).toBeNull();
    store.save(provider, secret); encryption.isEncryptionAvailable = () => false;
    await expect(store.read(provider.id)).rejects.toThrow(/加密/);
    expect(store.get()).toEqual({ provider, hasCredential: true });
  });
  it('发送前严格绑定冻结provider，地址、ID或模型变化不得读取新服务密钥', async () => {
    store.save(provider, secret);
    for (const changed of [{ ...provider, baseUrl: 'https://changed.example.com/v1' }, { ...provider, id: randomUUID() }, { ...provider, model: 'changed-model' }]) {
      const spy = vi.spyOn(encryption, 'decryptString');
      await expect(store.read(provider.id, changed)).rejects.toThrow(/配置已变化/);
      expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
    }
    expect(await store.read(provider.id, provider)).toBe(secret);
    const changed = { ...provider, baseUrl: 'https://changed.example.com/v1' };
    store.save(changed, '新服务秘密');
    await expect(store.read(provider.id, provider)).rejects.toThrow(/配置已变化/);
    expect(await store.read(provider.id, changed)).toBe('新服务秘密');
  });
  it('原子替换失败保留旧凭据，并删除临时文件', async () => {
    store.save(provider, secret); const before = readFileSync(file(), 'utf8');
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error(secret); });
    expect(() => store.save(provider, '新密钥')).toThrow(/保存失败/);
    expect(readFileSync(file(), 'utf8')).toBe(before); expect(await store.read(provider.id)).toBe(secret);
    expect(readdirSync(directory)).toEqual(['ai-settings.json']);
  });
  it('拒绝目录及祖先junction，禁止凭据存入Projects，不读写链接目标', () => {
    const target = join(directory, 'target'); mkdirSync(target);
    const link = join(directory, 'link'); symlinkSync(target, link, 'junction');
    for (const path of [link, join(link, 'nested'), join(directory, 'Projects', 'credentials')]) {
      const unsafe = new AiSettingsStore(path, encryption);
      expect(() => unsafe.save(provider, secret)).toThrow(/链接|作品目录/);
      expect(() => unsafe.get()).toThrow(/链接|作品目录/);
    }
    expect(readdirSync(target)).toEqual([]);
  });
});
