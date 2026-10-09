import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { aiPrepareRequestSchema, type AiProvider } from '../shared/ai';

export interface AiSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
interface StoredSettings { version: 1; provider: AiProvider; credential: string | null }
export interface AiSettings { provider: AiProvider | null; hasCredential: boolean }
const settingsSchema = z.object({ version: z.literal(1), provider: z.unknown(), credential: z.string().min(1).max(32768).nullable() }).strict();
const invalidConfiguration = () => new Error('云端 AI 配置无效，请检查服务、地址和模型。');

function validateProvider(value: unknown): AiProvider {
  const parsed = aiPrepareRequestSchema.safeParse({ provider: value, operation: 'correct', context: {
    workId: '00000000-0000-4000-8000-000000000001', baselineRevision: 1,
    paragraphIds: ['00000000-0000-4000-8000-000000000002'], scopeLabel: '配置校验', text: '配置校验',
  } });
  if (!parsed.success) throw invalidConfiguration();
  const provider = parsed.data.provider;
  if (provider.id !== 'cloud-default' && !z.uuid().safeParse(provider.id).success) throw invalidConfiguration();
  let url: URL;
  try { url = new URL(provider.baseUrl); } catch { throw invalidConfiguration(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !provider.name.trim() || !provider.model.trim()) throw invalidConfiguration();
  return provider;
}
function validKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 8192 || Array.from(value).some(char => char.codePointAt(0)! < 32 || char === '\u007f')) {
    throw new Error('云端服务凭据无效，不能为空、包含控制字符或超过 8 KiB。');
  }
  return value.trim();
}

/** 凭据独立于作品保存；仅由系统加密服务保护，禁止明文后端和错误信息泄露。 */
export class AiSettingsStore {
  private readonly directory: string;
  private readonly file: string;
  constructor(directory: string, private readonly storage: AiSafeStorage) {
    this.directory = resolve(directory); this.file = join(this.directory, 'ai-settings.json');
  }
  private assertPath() {
    let current = this.file;
    while (true) {
      if (basename(current).toLocaleLowerCase() === 'projects') throw new Error('AI 凭据不能存放在作品目录中。');
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('AI 配置路径不允许链接，请检查本机数据目录。');
      const parent = dirname(current); if (parent === current) return; current = parent;
    }
  }
  private assertEncryption() {
    try {
      if (this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text') return;
    } catch { /* 系统异常统一转换，不暴露底层错误。 */ }
    throw new Error('系统安全加密不可用，不能保存或读取云端凭据；不支持明文降级。');
  }
  private load(): StoredSettings | null {
    this.assertPath();
    const stat = lstatSync(this.file, { throwIfNoEntry: false }); if (!stat) return null;
    try {
      if (!stat.isFile() || stat.size > 65536) throw new Error();
      const parsed = settingsSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      const provider = validateProvider(parsed.provider);
      if (parsed.credential && Buffer.from(parsed.credential, 'base64').toString('base64') !== parsed.credential) throw new Error();
      return { ...parsed, provider };
    } catch { throw new Error('AI 配置文件损坏或格式无效，请修复 ai-settings.json 后重试；原文件已保留。'); }
  }
  get(): AiSettings {
    const current = this.load(); return { provider: current?.provider ?? null, hasCredential: !!current?.credential };
  }
  save(value: unknown, key?: string): AiSettings {
    const provider = validateProvider(value), previous = this.load();
    let credential = previous?.provider.id === provider.id && previous.provider.baseUrl === provider.baseUrl ? previous.credential : null;
    if (key !== undefined) {
      const normalized = validKey(key); this.assertEncryption();
      try {
        const encrypted = this.storage.encryptString(normalized);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > 24576 || encrypted.equals(Buffer.from(normalized))) throw new Error();
        credential = encrypted.toString('base64');
      } catch { throw new Error('系统凭据加密失败，请检查系统加密服务后重试。'); }
    }
    const settings: StoredSettings = { version: 1, provider, credential };
    this.assertPath();
    let descriptor: number | undefined, temporary: string | undefined;
    try {
      mkdirSync(this.directory, { recursive: true }); this.assertPath();
      temporary = join(this.directory, `.ai-settings-${randomUUID()}.tmp`);
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(settings)); fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      this.assertPath(); renameSync(temporary, this.file);
      return { provider, hasCredential: !!credential };
    } catch { throw new Error('AI 配置保存失败，原配置和凭据已保留，请检查磁盘空间和目录权限后重试。'); }
    finally { if (descriptor !== undefined) closeSync(descriptor); if (temporary) rmSync(temporary, { force: true }); }
  }
  async read(providerId: string, expectedProvider?: AiProvider): Promise<string | null> {
    const current = this.load();
    // load、匹配和解密之间没有异步间隙；新配置的密钥不能发送到旧冻结服务。
    if (expectedProvider && JSON.stringify(current?.provider ?? null) !== JSON.stringify(expectedProvider)) throw new Error('模型配置已变化，请重新预览确认后发送。');
    if (!current?.credential || current.provider.id !== providerId || current.provider.enabled === false) return null;
    this.assertEncryption();
    try { return validKey(this.storage.decryptString(Buffer.from(current.credential, 'base64'))); }
    catch { throw new Error('系统凭据无法解密，请重新配置；原文件已保留。'); }
  }
  clear(): void {
    this.assertPath();
    try { rmSync(this.file, { force: true }); }
    catch { throw new Error('AI 配置清除失败，原配置已保留，请检查目录权限后重试。'); }
  }
}
