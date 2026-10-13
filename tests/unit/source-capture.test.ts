import { describe, expect, it } from 'vitest';
import { webImportRequestSchema } from '../../src/shared/book-extraction';
import { sourceCaptureSchema } from '../../src/shared/source-capture';
import { frozenSourceDocumentSchema } from '../../src/shared/source-document';

const sourceId = '11111111-1111-4111-8111-111111111111';
const capturedAt = '2026-10-13T01:02:03.000Z';
const capture = { sourceId, captureMethod: 'static', capturedAt, policyVersion: 1 };
const web = { id: sourceId, kind: 'web', hashVersion: 1, originalUrl: 'https://example.com/article', finalUrl: 'https://example.com/article',
  title: '文章', fetchedAt: capturedAt, rawHash: 'a'.repeat(64), bodyHash: 'b'.repeat(64),
  segments: [{ id: '22222222-2222-4222-8222-222222222222', ordinal: 1, chapterTitle: '', text: '原文', textHash: 'c'.repeat(64) }] };

describe('网页请求模式', () => {
  const request = { workId: sourceId, operationId: '33333333-3333-4333-8333-333333333333', url: 'https://example.com/article' };
  it('省略模式仍走静态路径，显式渲染模式可保留', () => {
    expect(webImportRequestSchema.parse(request).mode).toBe('static');
    expect(webImportRequestSchema.parse({ ...request, mode: 'restricted-browser' }).mode).toBe('restricted-browser');
  });
  it.each([{ mode: 'browser' }, { bypass: true }, { mode: null }, { workId: 'invalid' }, { operationId: 'invalid' }, { url: '' }, { url: 'a'.repeat(2049) }])('拒绝非法模式、身份与未知请求字段 %j', change => {
    expect(webImportRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
});

describe('来源捕获证据', () => {
  it('接受静态证据和含 DOM 哈希的受限证据', () => {
    expect(sourceCaptureSchema.parse(capture)).toEqual(capture);
    const restricted = { ...capture, captureMethod: 'restricted-browser', renderedDomHash: 'd'.repeat(64) };
    expect(sourceCaptureSchema.parse(restricted)).toEqual(restricted);
    expect(frozenSourceDocumentSchema.parse({ ...web, capture: restricted }).capture).toEqual(restricted);
  });
  it.each([
    { captureMethod: 'restricted-browser' }, { capturedAt: '昨天' }, { capturedAt: null },
    { sourceId: 'invalid' }, { policyVersion: 2 }, { captureMethod: 'unknown' },
    { renderedDomHash: 'd'.repeat(64) }, { extra: true },
    { captureMethod: 'restricted-browser', renderedDomHash: 'bad' },
  ])('拒绝缺失或混合捕获证据 %j', change => {
    expect(sourceCaptureSchema.safeParse({ ...capture, ...change }).success).toBe(false);
  });
  it('旧网页记录不生成捕获方式或推断历史时间', () => {
    const old = frozenSourceDocumentSchema.parse(web);
    expect(old).not.toHaveProperty('capture');
    expect(old.fetchedAt).toBe(capturedAt);
  });
  it('来源身份不一致时拒绝捕获关联', () => {
    expect(frozenSourceDocumentSchema.safeParse({ ...web, capture: { ...capture, sourceId: '44444444-4444-4444-8444-444444444444' } }).success).toBe(false);
  });
  it.each(['txt', 'docx', 'paste'])('非网页 %s 不能携带捕获证据', kind => {
    const source = { ...web, kind, originalUrl: null, finalUrl: null, fetchedAt: null };
    expect(frozenSourceDocumentSchema.safeParse(source).success).toBe(true);
    expect(frozenSourceDocumentSchema.safeParse({ ...source, capture }).success).toBe(false);
  });
});
