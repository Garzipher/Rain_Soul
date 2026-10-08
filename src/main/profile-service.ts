import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { authorProfileSchema, penNameInputSchema, type AuthorProfile } from '../shared/profile';
import { validateAvatarHeader } from './avatar-header';

const avatarLimit = 1_048_576;
const invalidAvatar = () => new Error('头像必须是完整 PNG 图片，且规范化后不超过 1 MiB。');

function assertPng(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || bytes.length > avatarLimit
    || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalidAvatar();
  validateAvatarHeader(bytes);
  let offset = 8;
  let imageData = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) throw invalidAvatar();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let checksum = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index++) {
      checksum ^= bytes[index];
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
    if (((checksum ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw invalidAvatar();
    if (offset === 8) {
      if (type !== 'IHDR' || size !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) throw invalidAvatar();
      if (bytes.readUInt32BE(offset + 8) > 256 || bytes.readUInt32BE(offset + 12) > 256) throw invalidAvatar();
    } else if (type === 'IHDR') throw invalidAvatar();
    if (type === 'IDAT' && size > 0) imageData = true;
    if (type === 'IEND') {
      if (size !== 0 || !imageData || end !== bytes.length) throw invalidAvatar();
      return;
    }
    offset = end;
  }
  throw invalidAvatar();
}

export class ProfileService {
  private readonly directory: string;
  private readonly file: string;
  constructor(directory: string) { this.directory = resolve(directory); this.file = join(this.directory, 'author-profile.json'); }

  private assertPath() {
    let current = this.file;
    while (true) {
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('个人资料路径不允许链接，请检查本机数据目录。');
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }

  get(): AuthorProfile {
    this.assertPath();
    const stat = lstatSync(this.file, { throwIfNoEntry: false });
    if (!stat) return { penName: '', avatarDataUrl: null };
    try {
      if (!stat.isFile() || stat.size > 1_400_000) throw new Error('文件类型或大小无效');
      const profile = authorProfileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      if (profile.avatarDataUrl !== null) {
        const bytes = Buffer.from(profile.avatarDataUrl.slice(22), 'base64');
        assertPng(bytes);
        if (`data:image/png;base64,${bytes.toString('base64')}` !== profile.avatarDataUrl) throw invalidAvatar();
      }
      return profile;
    } catch { throw new Error('个人资料文件损坏或格式无效，请修复 author-profile.json 后重试；原文件已保留。'); }
  }

  private save(profile: AuthorProfile): AuthorProfile {
    this.assertPath();
    mkdirSync(this.directory, { recursive: true });
    const temporary = join(this.directory, `.author-profile-${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(profile));
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, this.file);
      return profile;
    } catch { throw new Error('个人资料保存失败，原资料已保留，请检查磁盘空间和目录权限后重试。'); }
    finally { if (descriptor !== undefined) closeSync(descriptor); rmSync(temporary, { force: true }); }
  }

  setPenName(value: unknown): AuthorProfile {
    const parsed = penNameInputSchema.safeParse(value);
    if (!parsed.success) throw new Error('名称必须是文本，且最多 80 个字符。');
    return this.save({ ...this.get(), penName: parsed.data });
  }
  setAvatarPng(bytes: Buffer): AuthorProfile {
    assertPng(bytes);
    return this.save({ ...this.get(), avatarDataUrl: `data:image/png;base64,${bytes.toString('base64')}` });
  }
  clearAvatar(): AuthorProfile { return this.save({ ...this.get(), avatarDataUrl: null }); }
}
