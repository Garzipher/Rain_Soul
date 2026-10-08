import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileService } from '../../src/main/profile-service';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('本机作者个人资料', () => {
  let directory: string;
  let service: ProfileService;
  const png = readFileSync(join(process.cwd(), 'assets', 'rainsoul.png'));
  const file = () => join(directory, 'author-profile.json');
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'rainsoul-profile-')); service = new ProfileService(directory); });
  afterEach(() => { vi.mocked(fs.renameSync).mockReset(); vi.mocked(fs.renameSync).mockImplementation((source, target) => {
    const actual = process.getBuiltinModule('fs'); actual.renameSync(source, target);
  }); rmSync(directory, { recursive: true, force: true }); });

  it('未设置时名称为空，头像为空，不写入作品目录', () => {
    expect(service.get()).toEqual({ penName: '', avatarDataUrl: null });
    expect(readdirSync(directory)).toEqual([]);
  });
  it('名称去除首尾空白并独立持久化，重启仍可读取', () => {
    expect(service.setPenName('  雨魂  ')).toEqual({ penName: '雨魂', avatarDataUrl: null });
    expect(new ProfileService(directory).get().penName).toBe('雨魂');
    expect(readdirSync(directory)).toEqual(['author-profile.json']);
    expect(service.setPenName('')).toEqual({ penName: '', avatarDataUrl: null });
  });
  it.each([null, 5, {}, '雨'.repeat(81)])('非法名称拒绝并保留旧资料：%j', value => {
    service.setPenName('原笔名');
    expect(() => service.setPenName(value)).toThrow();
    expect(service.get().penName).toBe('原笔名');
  });
  it('规范 PNG 本地保存为 dataURL，修改名称不清空头像，清空头像不清空名称', () => {
    service.setAvatarPng(png);
    expect(service.setPenName('雨魂')).toEqual({ penName: '雨魂', avatarDataUrl: `data:image/png;base64,${png.toString('base64')}` });
    expect(new ProfileService(directory).get()).toEqual(service.get());
    expect(service.clearAvatar()).toEqual({ penName: '雨魂', avatarDataUrl: null });
  });
  it.each([Buffer.from('<svg/>'), Buffer.alloc(1_048_577), png.subarray(0, 30), Buffer.concat([png, Buffer.from('尾部')])])('拒绝错误格式、超限、截断和附加内容，保留头像', bytes => {
    service.setAvatarPng(png);
    expect(() => service.setAvatarPng(bytes)).toThrow(/头像/);
    expect(service.get().avatarDataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });
  it('拒绝 PNG 校验和损坏，保留已有资料', () => {
    service.setPenName('原笔名');
    const broken = Buffer.from(png); broken[45] ^= 1;
    expect(() => service.setAvatarPng(broken)).toThrow(/头像/);
    expect(service.get()).toEqual({ penName: '原笔名', avatarDataUrl: null });
  });
  it('规范化头像尺寸不能超过 256，有效 IHDR 校验和仍须拒绝超限图', () => {
    const huge = Buffer.from(png); huge.writeUInt32BE(512, 16); huge.writeUInt32BE(512, 20);
    let crc = 0xffffffff;
    for (const byte of huge.subarray(12, 29)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    huge.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
    service.setPenName('原作者');
    expect(() => service.setAvatarPng(huge)).toThrow(/头像/);
    expect(service.get()).toEqual({ penName: '原作者', avatarDataUrl: null });
    writeFileSync(file(), JSON.stringify({ penName: '原作者', avatarDataUrl: `data:image/png;base64,${huge.toString('base64')}` }));
    const prior = readFileSync(file(), 'utf8');
    expect(() => service.get()).toThrow(/个人资料/);
    expect(readFileSync(file(), 'utf8')).toBe(prior);
  });
  it.each(['{', JSON.stringify({ penName: '雨', avatarDataUrl: null, injected: true }), JSON.stringify({ penName: '雨', avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })])('损坏或非法资料读取报错，更新不覆盖原文件', contents => {
    writeFileSync(file(), contents);
    expect(() => service.get()).toThrow(/个人资料/);
    expect(() => service.setPenName('新名字')).toThrow(/个人资料/);
    expect(readFileSync(file(), 'utf8')).toBe(contents);
  });
  it('文件保存失败保留原 JSON 并清理临时文件', () => {
    service.setPenName('旧名字');
    const original = readFileSync(file(), 'utf8');
    // 只在操作系统提交边界注入拒绝，真实执行临时写入、落盘和清理。
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('EPERM'); });
    expect(() => service.setPenName('新名字')).toThrow(/个人资料/);
    expect(readFileSync(file(), 'utf8')).toBe(original);
    expect(service.get().penName).toBe('旧名字');
    expect(readdirSync(directory)).toEqual(['author-profile.json']);
  });
  it('拒绝指向其他目录的 junction，不读写链接目标', () => {
    const target = join(directory, 'target'); mkdirSync(target);
    const link = join(directory, 'link'); symlinkSync(target, link, 'junction');
    expect(() => new ProfileService(link).setPenName('错误')).toThrow(/链接/);
    expect(readdirSync(target)).toEqual([]);
  });
  it('读取的可变对象不会改变已经持久化的资料', () => {
    service.setPenName('原笔名');
    const profile = service.get(); profile.penName = '擅改';
    expect(service.get().penName).toBe('原笔名');
  });
});
