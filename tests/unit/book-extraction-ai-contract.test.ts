import { describe, expect, it } from 'vitest';
import { bookExtractionAiPrepareRequestSchema as schema } from '../../src/shared/book-extraction-ai';

describe('拆书 AI 请求边界', () => {
  it('仅接受已授权的作品预览及唯一段落，不接收原文或模型配置', () => {
    const request = { workId: crypto.randomUUID(), token: crypto.randomUUID(), segmentIds: [crypto.randomUUID()], permissionConfirmed: true };
    expect(schema.safeParse(request).success).toBe(true);
    for (const invalid of [{ ...request, permissionConfirmed: false }, { ...request, segmentIds: [] }, { ...request, segmentIds: Array(21).fill(request.segmentIds[0]) }, { ...request, segmentIds: [request.segmentIds[0], request.segmentIds[0]] }, { ...request, text: '伪造原文' }]) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });
});
