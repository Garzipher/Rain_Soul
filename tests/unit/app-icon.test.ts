import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encodeWindowsIcon } from '../../scripts/windows-icon.mjs';

describe('Windows 图标编码', () => {
  it('保留每张 PNG 原始字节，并按正确偏移写入多尺寸目录', () => {
    const small = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const large = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
    const icon = encodeWindowsIcon([{ size: 16, png: small }, { size: 256, png: large }]);
    expect([...icon.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
    expect([...icon.subarray(6, 14)]).toEqual([16, 16, 0, 0, 1, 0, 32, 0]);
    expect(icon.readUInt32LE(14)).toBe(8);
    expect(icon.readUInt32LE(18)).toBe(38);
    expect([...icon.subarray(22, 26)]).toEqual([0, 0, 0, 0]);
    expect(icon.readUInt32LE(30)).toBe(10);
    expect(icon.readUInt32LE(34)).toBe(46);
    expect(icon.subarray(38, 46)).toEqual(small);
    expect(icon.subarray(46)).toEqual(large);
  });

  it('交付多尺寸 Demo 同源图标并配置 Windows 程序使用', () => {
    const svg = readFileSync('assets/rainsoul.svg', 'utf8');
    expect(svg).toContain('rotate(-9 13.5 13.5)');
    expect(svg).toContain('r="3"');
    const icon = readFileSync('assets/rainsoul.ico');
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBe(7);
    for (let index = 0; index < 7; index++) {
      const offset = icon.readUInt32LE(18 + index * 16);
      expect([...icon.subarray(offset, offset + 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    }
    const configuration = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(configuration.build.win.icon).toBe('assets/rainsoul.ico');
  });
});
