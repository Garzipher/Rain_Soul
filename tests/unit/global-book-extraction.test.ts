import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GlobalBookExtractionCommands } from '../../src/main/global-book-extraction-commands';
import { GlobalExtractionDraftStore } from '../../src/main/global-extraction-draft-store';
import type { GlobalExtractionPreview } from '../../src/shared/global-book-extraction';
import type { GlobalExtractionCommit } from '../../src/shared/global-knowledge';

describe('全局拆书的独立目标及入库恢复', () => {
  async function setup() {
    const directory = await mkdtemp(join(tmpdir(), 'rainsoul-global-extraction-'));
    const global = { request: vi.fn().mockResolvedValue({ revision: 2 }) };
    const commands = new GlobalBookExtractionCommands({ choose: async () => null }, global, directory);
    const preview = await commands.execute('previewGlobalPastedExtraction', { title: '原创教学样稿', text: '雨落在岸边。船鸣从远方传来。\n这一段不应进入正式库。' }) as GlobalExtractionPreview;
    const request = { token: preview.token, expectedRevision: 1, operationId: randomUUID(), sourceTitle: '原创教学样稿', sourceAuthor: '测试作者',
      chapter: '第一章', rightsBasis: 'owned', permissionConfirmed: true,
      items: [{ segmentId: preview.segments[0].id, body: '雨落在岸边。', categoryId: randomUUID(), tagIds: [] }] };
    return { directory, global, commands, preview, request };
  }
  it('全局来源没有伪造workId，正式提交只携带审核短句', async () => {
    const { directory, commands, global, preview, request } = await setup();
    try {
      expect(preview.target).toEqual({ kind: 'global' }); expect(preview).not.toHaveProperty('workId');
      await commands.execute('confirmGlobalBookExtraction', request);
      const commit = global.request.mock.calls[0][1] as GlobalExtractionCommit;
      expect(commit.sourceDocument.segments.map(item => item.text)).toEqual(['雨落在岸边。']);
      expect(commit.sourceDocument.rawHash).toBe(preview.fileHash);
      expect(commit.items[0].source).toContain('第一章');
      const saved = await new GlobalExtractionDraftStore(directory).read();
      expect(saved?.reviews[0].status).toBe('committed'); expect(saved?.committing).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('伪造原句和过期预览均拒绝，不接触正式库', async () => {
    const { directory, commands, global, request } = await setup();
    try {
      await expect(commands.execute('confirmGlobalBookExtraction', { ...request, token: randomUUID() })).rejects.toThrow(/失效/);
      await expect(commands.execute('confirmGlobalBookExtraction', { ...request, items: [{ ...request.items[0], body: '不存在的原句' }] })).rejects.toThrow(/原文/);
      expect(global.request).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('失败保留同一操作回执，重开草稿重放原操作，不覆盖未核对来源', async () => {
    const { directory, commands, global, request } = await setup();
    try {
      global.request.mockRejectedValueOnce(new Error('暂时不可用'));
      await expect(commands.execute('confirmGlobalBookExtraction', request)).rejects.toThrow('暂时不可用');
      await expect(commands.execute('previewGlobalPastedExtraction', { title: '替换', text: '新内容' })).rejects.toThrow(/回执待核对/);
      const reopened = new GlobalBookExtractionCommands({ choose: async () => null }, global, directory);
      await reopened.execute('readGlobalExtractionDraft', undefined);
      expect(global.request.mock.calls[1][1]).toEqual(global.request.mock.calls[0][1]);
      expect((await new GlobalExtractionDraftStore(directory).read())?.committing).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
