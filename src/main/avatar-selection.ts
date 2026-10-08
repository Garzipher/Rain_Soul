import { lstatSync, readFileSync } from 'node:fs';
import type { AuthorProfile } from '../shared/profile';
import type { ProfileService } from './profile-service';
import { validateAvatarHeader } from './avatar-header';

interface Image {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number; quality: 'best' }): Image;
  toPNG(): Buffer;
}
export async function selectAuthorAvatar(service: ProfileService,
  select: () => Promise<{ canceled: boolean; filePaths: string[] }>, decode: (bytes: Buffer) => Image): Promise<AuthorProfile> {
  const chosen = await select();
  if (chosen.canceled || chosen.filePaths.length === 0) return service.get();
  const path = chosen.filePaths[0];
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('头像文件无效或超过 16 MiB，请选择较小的本地图片。');
  const bytes = readFileSync(path);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('头像文件超过 16 MiB。');
  validateAvatarHeader(bytes);
  const image = decode(bytes);
  const { width, height } = image.getSize();
  if (image.isEmpty() || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width * height > 40_000_000) throw new Error('头像无法解码或像素尺寸过大，请选择其他图片。');
  const scale = Math.min(1, 256 / Math.max(width, height));
  return service.setAvatarPng(image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }).toPNG());
}
