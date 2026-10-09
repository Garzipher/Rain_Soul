import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAvatarHeader } from '../../src/main/avatar-header';

function jpeg(width = 800, height = 400, marker = 0xc0) {
  const frame = Buffer.from([0xff, marker, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x45, 0xff, 0, 0x22, 0xff, 0xd9])]);
}
function chunk(type: string, bytes: Buffer) {
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]);
}
function webp(chunks: Buffer[]) {
  const content = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8); header.write('RIFF'); header.writeUInt32LE(content.length, 4);
  return Buffer.concat([header, content]);
}
function lossless(width = 800, height = 400) {
  const payload = Buffer.alloc(5); payload[0] = 0x2f;
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return chunk('VP8L', payload);
}

describe('原生解码前头像头部校验', () => {
  const png = readFileSync('assets/rainsoul.png');
  it('接受真实 PNG 的完整结构', () => expect(() => validateAvatarHeader(png)).not.toThrow());
  it.each(['jpg', 'webp'])('接受 Chromium canvas 编码的真实静态 %s', extension => {
    expect(() => validateAvatarHeader(readFileSync(`tests/unit/fixtures/avatar-valid.${extension}`))).not.toThrow();
  });
  it.each([0xc0, 0xc1, 0xc2])('接受批准 JPEG 帧类型 %i', marker => expect(() => validateAvatarHeader(jpeg(800, 400, marker))).not.toThrow());
  it('JPEG 多个尺寸声明不能被较小首帧绕过', () => {
    const safe = jpeg(), huge = jpeg(10000, 10000);
    expect(() => validateAvatarHeader(Buffer.concat([safe.subarray(0, -2), huge.subarray(2)]))).toThrow(/头像/);
  });
  it.each([jpeg(0, 1), jpeg(10000, 10000), jpeg(800, 400, 0xc3), jpeg().subarray(0, -2)])('拒绝零尺寸、超限、不支持帧或缺失尾标 JPEG', bytes => expect(() => validateAvatarHeader(bytes)).toThrow(/头像/));
  it('JPEG 头段截断和缺少图像帧时失败', () => {
    expect(() => validateAvatarHeader(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/头像/);
  });
  it('接受静态有损及无损 WebP，检查扩展画布与真实位流', () => {
    const lossy = Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 0x20, 3, 0x90, 1]);
    expect(() => validateAvatarHeader(webp([chunk('VP8 ', lossy)]))).not.toThrow();
    expect(() => validateAvatarHeader(webp([lossless()]))).not.toThrow();
    const extended = Buffer.alloc(10); extended.writeUIntLE(799, 4, 3); extended.writeUIntLE(399, 7, 3);
    expect(() => validateAvatarHeader(webp([chunk('VP8X', extended), lossless()]))).not.toThrow();
    expect(() => validateAvatarHeader(webp([chunk('VP8X', extended), lossless(10000, 10000)]))).toThrow(/头像/);
  });
  it('拒绝动画、重复图像、不一致画布和截断 WebP', () => {
    const animated = Buffer.alloc(10); animated[0] = 2;
    expect(() => validateAvatarHeader(webp([chunk('VP8X', animated), lossless()]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(webp([lossless(), lossless()]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(webp([chunk('ANMF', Buffer.alloc(16)), lossless()]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(webp([chunk('VP8X', Buffer.alloc(10)), lossless()]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(webp([lossless()]).subarray(0, -1))).toThrow(/头像/);
  });
  it('PNG 重复 IHDR、动画块、截断和超限尺寸在解码前失败', () => {
    const huge = Buffer.from(png); huge.writeUInt32BE(10000, 16); huge.writeUInt32BE(10000, 20);
    expect(() => validateAvatarHeader(huge)).toThrow(/头像/);
    expect(() => validateAvatarHeader(Buffer.concat([png.subarray(0, 33), png.subarray(8)]))).toThrow(/头像/);
    const animation = Buffer.alloc(20); animation.writeUInt32BE(8); animation.write('acTL', 4);
    expect(() => validateAvatarHeader(Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]))).toThrow(/头像/);
    expect(() => validateAvatarHeader(png.subarray(0, -1))).toThrow(/头像/);
  });
  it.each([Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.alloc(40)])('拒绝非批准格式 %j', bytes => expect(() => validateAvatarHeader(bytes)).toThrow(/头像/));
});
