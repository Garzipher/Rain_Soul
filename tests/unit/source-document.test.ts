import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { freezeSource } from '../../src/main/freeze-source';
import { frozenSourceDocumentSchema, sourceSegmentSchema } from '../../src/shared/source-document';

const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
const input = () => ({ kind: 'txt' as const, rawBytes: Buffer.from('原始字节\r\n'), title: '书名', segments: [{ text: '  e\u0301\r\n甲\r乙  ', chapterTitle: '第一章' }, { text: '\t\r\n ' }, { text: '😀' }] });

describe('冻结来源协议', () => {
  it('仅规范换行、剔除空段并保留 Unicode 与首尾空白', () => {
    const source = freezeSource(input());
    expect(source.segments.map(segment => segment.text)).toEqual(['  e\u0301\n甲\n乙  ', '😀']);
    expect(source.segments.map(segment => segment.ordinal)).toEqual([1, 2]);
    expect(source.segments.map(segment => segment.chapterTitle)).toEqual(['第一章', '']);
    expect(source.rawHash).toBe(sha(input().rawBytes));
    expect(source.bodyHash).toBe(sha('["  é\\n甲\\n乙  ","😀"]'));
    expect(source.segments[0].textHash).toBe(sha('  e\u0301\n甲\n乙  '));
    expect(frozenSourceDocumentSchema.safeParse(source).success).toBe(true);
    expect(new Set([source.id, ...source.segments.map(segment => segment.id)]).size).toBe(3);
    expect(source.originalUrl).toBeNull();
    expect(source.fetchedAt).toBeNull();
  });
  it('不同段落边界产生不同正文哈希', () => {
    expect(freezeSource({ ...input(), segments: [{ text: 'ab' }, { text: 'c' }] }).bodyHash)
      .not.toBe(freezeSource({ ...input(), segments: [{ text: 'a' }, { text: 'bc' }] }).bodyHash);
  });
  it('允许四种来源，网页保留完整原始元信息', () => {
    for (const kind of ['txt', 'docx', 'paste'] as const) expect(freezeSource({ ...input(), kind }).kind).toBe(kind);
    const source = freezeSource({ ...input(), kind: 'web', originalUrl: 'https://example.com/article', finalUrl: 'https://example.org/final', fetchedAt: '2026-10-10T01:00:00.000Z' });
    expect(source.originalUrl).toBe('https://example.com/article');
    expect(source.finalUrl).toBe('https://example.org/final');
    expect(source.fetchedAt).toBe('2026-10-10T01:00:00.000Z');
  });
  it('按 code point 接受边界但拒绝超限，且不截断', () => {
    expect(freezeSource({ ...input(), segments: [{ text: '😀'.repeat(200000) }] }).segments[0].text.length).toBe(400000);
    expect(() => freezeSource({ ...input(), segments: [{ text: '😀'.repeat(200001) }] })).toThrow();
    expect(() => freezeSource({ ...input(), segments: [{ text: '甲'.repeat(100000) }, { text: '乙'.repeat(100001) }] })).toThrow();
    expect(freezeSource({ ...input(), segments: Array.from({ length: 2000 }, () => ({ text: '字' })) }).segments).toHaveLength(2000);
    expect(() => freezeSource({ ...input(), segments: Array.from({ length: 2001 }, () => ({ text: '字' })) })).toThrow();
    expect(() => freezeSource({ ...input(), segments: [{ text: ' '.repeat(20) }] })).toThrow();
    expect(() => freezeSource({ ...input(), title: '字'.repeat(201) })).toThrow();
    expect(freezeSource({ ...input(), title: '😀'.repeat(200) }).title).toHaveLength(400);
  });
  it('严格拒绝额外字段、无效身份及非规范段落', () => {
    const source = freezeSource(input());
    for (const change of [{ extra: true }, { id: 'invalid' }, { hashVersion: 2 }, { bodyHash: 'bad' }, { segments: [...source.segments].reverse() }, { segments: [source.segments[0], source.segments[0]] }]) {
      expect(frozenSourceDocumentSchema.safeParse({ ...source, ...change }).success).toBe(false);
    }
    for (const text of ['', ' ', 'a\rb']) expect(sourceSegmentSchema.safeParse({ ...source.segments[0], text }).success).toBe(false);
  });
  it('拒绝网页缺失来源、非公开 HTTPS 基本格式和非网页 URL 元信息', () => {
    expect(() => freezeSource({ ...input(), kind: 'web' })).toThrow();
    expect(() => freezeSource({ ...input(), originalUrl: 'https://example.com' })).toThrow();
    for (const url of ['http://example.com', 'https://a:b@example.com', 'https://example.com:444', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', `https://example.com/${'a'.repeat(2048)}`]) {
      expect(() => freezeSource({ ...input(), kind: 'web', originalUrl: url, finalUrl: url, fetchedAt: '2026-10-10T01:00:00Z' })).toThrow();
    }
    expect(() => freezeSource({ ...input(), kind: 'web', originalUrl: 'https://example.com', finalUrl: 'https://example.com', fetchedAt: '昨天' })).toThrow();
  });
});
