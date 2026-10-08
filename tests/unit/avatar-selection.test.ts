import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileService } from '../../src/main/profile-service';
import { selectAuthorAvatar } from '../../src/main/avatar-selection';

describe('受控本地头像选择', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rainsoul-avatar-'));
  const imageFile = join(directory, 'image.png');
  const bytes = readFileSync('assets/rainsoul.png');
  const service = new ProfileService(directory);
  const resized = { isEmpty: () => false, getSize: () => ({ width: 256, height: 128 }), resize: vi.fn(), toPNG: () => bytes };
  const image = { isEmpty: () => false, getSize: () => ({ width: 800, height: 400 }), resize: vi.fn(() => resized), toPNG: () => bytes };
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); mkdirSync(directory); vi.clearAllMocks(); });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('取消文件选择不解码、不写配置，返回原作者资料', async () => {
    service.setPenName('原名'); const decode = vi.fn(() => image);
    expect(await selectAuthorAvatar(service, async () => ({ canceled: true, filePaths: [] }), decode)).toEqual(service.get());
    expect(decode).not.toHaveBeenCalled();
  });
  it('仅解码系统选择的图片，按比例缩放并保存规范PNG', async () => {
    writeFileSync(imageFile, bytes); const decode = vi.fn(() => image);
    const result = await selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), decode);
    expect(decode).toHaveBeenCalledWith(bytes);
    expect(image.resize).toHaveBeenCalledWith({ width: 256, height: 128, quality: 'best' });
    expect(result.avatarDataUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  });
  it('压缩体积很小但像素超限的 PNG 在调用原生解码前拒绝', async () => {
    const huge = Buffer.from(bytes);
    huge.writeUInt32BE(10000, 16); huge.writeUInt32BE(10000, 20);
    writeFileSync(imageFile, huge); service.setPenName('原作者');
    const decode = vi.fn(() => image);
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), decode)).rejects.toThrow(/头像/);
    expect(decode).not.toHaveBeenCalled();
    expect(service.get()).toEqual({ penName: '原作者', avatarDataUrl: null });
  });
  it('仅支持批准的静态 PNG/JPEG/WebP，伪装图片不调用解码器', async () => {
    writeFileSync(imageFile, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const decode = vi.fn(() => image);
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), decode)).rejects.toThrow(/头像/);
    expect(decode).not.toHaveBeenCalled();
  });
  it.each([{ width: 0, height: 20 }, { width: 10000, height: 10000 }])('拒绝无效与过大像素尺寸，旧头像仍保留', async size => {
    writeFileSync(imageFile, bytes); service.setAvatarPng(bytes);
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), () => ({ ...image, getSize: () => size }))).rejects.toThrow(/头像/);
    expect(service.get().avatarDataUrl).not.toBeNull();
  });
  it('解码为空和超限原文件不写资料', async () => {
    writeFileSync(imageFile, bytes);
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), () => ({ ...image, isEmpty: () => true }))).rejects.toThrow(/头像/);
    writeFileSync(imageFile, Buffer.alloc(16 * 1024 * 1024 + 1));
    const decode = vi.fn(() => image);
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [imageFile] }), decode)).rejects.toThrow(/头像/);
    expect(decode).not.toHaveBeenCalled();
  });
  it('拒绝选择目录或链接图片', async () => {
    const linked = join(directory, 'linked'); symlinkSync(directory, linked, 'junction');
    await expect(selectAuthorAvatar(service, async () => ({ canceled: false, filePaths: [linked] }), () => image)).rejects.toThrow(/头像/);
  });
});
