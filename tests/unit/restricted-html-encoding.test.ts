import { expect, it } from 'vitest';
import { normalizeRestrictedHtml } from '../../src/main/restricted-html-encoding';

const gbk = (prefix = '<meta charset="GBK"><p>', suffix = '</p>') => Buffer.concat([Buffer.from(prefix), Buffer.from('d6d0cec4', 'hex'), Buffer.from(suffix)]);
it('GBK原文规范为UTF8，同时重写真实meta并保留原输入', () => {
  const original = gbk(), snapshot = Buffer.from(original);
  const result = normalizeRestrictedHtml(original, 'text/html; charset=gb2312', 1024);
  expect(result.bytes.toString()).toBe('<meta charset="utf-8"><p>中文</p>');
  expect(result.contentType).toBe('text/html; charset=utf-8'); expect(original).toEqual(snapshot);
});
it('UTF8 BOM与同义声明允许，http-equiv以及XHTML声明同步规范', () => {
  const source = '<meta http-equiv="Content-Type" content="text/html; charset=UTF8"><p>正文</p>';
  const result = normalizeRestrictedHtml(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]), 'text/html; charset=utf-8', 1024);
  expect(result.bytes.toString()).toBe(source.replace('UTF8', 'utf-8'));
  const xml = normalizeRestrictedHtml(Buffer.from('<?xml version="1.0" encoding="UTF8"?><html/>'), 'application/xhtml+xml', 1024);
  expect(xml.bytes.toString()).toContain('encoding="utf-8"'); expect(xml.contentType).toBe('application/xhtml+xml; charset=utf-8');
});
it.each([
  [Buffer.from('<meta charset=gbk>'), 'text/html; charset=utf-8'],
  [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), gbk()]), 'text/html; charset=gbk'],
  [Buffer.from('<meta charset=utf-8><meta charset=gbk>'), 'text/html'],
  [Buffer.from('<p>正文</p>'), 'text/html; charset=utf-8; charset=gbk'],
])('HTTP、BOM、多个meta或重复HTTP编码相互冲突时拒绝', (bytes, contentType) => {
  expect(() => normalizeRestrictedHtml(bytes, contentType, 1024)).toThrow(/编码.*冲突/);
});
it.each([
  [Buffer.from('<meta charset=shift_jis>'), 'text/html'],
  [Buffer.from('<p>正文</p>'), 'text/html; charset=unknown'],
  [Buffer.from('<meta charset="">'), 'text/html'],
  [Buffer.from('<p>正文</p>'), 'text/html; charset=""'],
  [Buffer.from([0xc3, 0x28]), 'text/html; charset=utf-8'],
  [Buffer.from([0x81]), 'text/html; charset=gbk'],
  [Buffer.from([0xff, 0xfe, 0x3c, 0]), 'text/html'],
  [Buffer.from('<p>\u0000正文</p>'), 'text/html'],
])('未知、无效编码或不支持BOM拒绝，不能静默替换乱码', (bytes, contentType) => {
  expect(() => normalizeRestrictedHtml(bytes, contentType, 1024)).toThrow(/编码/);
});
it('注释和脚本样式内的伪meta不参与声明或修改，后部真实meta仍受检查', () => {
  const html = '<!-- <meta charset=gbk> --><script>const text="<meta charset=gbk>";</script><style>x::after{content:"<meta charset=gbk>"}</style><meta charset=UTF8><p>正文</p>';
  expect(normalizeRestrictedHtml(Buffer.from(html), 'text/html; charset=utf8', 1024).bytes.toString()).toBe(html.replace('charset=UTF8', 'charset=utf-8'));
  expect(() => normalizeRestrictedHtml(Buffer.from('<p>' + 'a'.repeat(4096) + '</p><meta charset=gbk>'), 'text/html; charset=utf8', 5000)).toThrow(/冲突/);
});
it('转码后的真实UTF8字节和meta增长都受预算约束，输入超限也拒绝', () => {
  const input = gbk('<p>', '</p>');
  expect(input.length).toBe(11); expect(normalizeRestrictedHtml(input, 'text/html; charset=gbk', 13).bytes.length).toBe(13);
  expect(() => normalizeRestrictedHtml(input, 'text/html; charset=gbk', 12)).toThrow(/容量|预算/);
  expect(() => normalizeRestrictedHtml(Buffer.from('<meta charset=utf8>'), 'text/html', 19)).toThrow(/容量|预算/);
  expect(() => normalizeRestrictedHtml(Buffer.alloc(21), 'text/html', 20)).toThrow(/容量|预算/);
});
it('限额与MIME必须有效，无声明时固定UTF8而非浏览器猜测', () => {
  expect(normalizeRestrictedHtml(Buffer.from('<p>正文</p>'), 'text/html', 1024).contentType).toBe('text/html; charset=utf-8');
  expect(() => normalizeRestrictedHtml(Buffer.from('abc'), 'text/plain', 1024)).toThrow(/HTML/);
  for (const limit of [0, -1, NaN, Infinity, 1.5, 6 * 1024 * 1024]) expect(() => normalizeRestrictedHtml(Buffer.alloc(0), 'text/html', limit)).toThrow(/限额/);
});
it('大量独立meta及单标签重复声明均有数量上限，不展开无界数组', () => {
  for (const html of ['<meta charset=utf8>'.repeat(20001), '<meta ' + 'charset=utf8 '.repeat(20001) + '>']) {
    expect(() => normalizeRestrictedHtml(Buffer.from(html), 'text/html', 1024 * 1024)).toThrow(/声明数量/);
  }
});
