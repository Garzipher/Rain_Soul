// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookExtractionWorkspace } from '../../src/renderer/components/book-extraction-workspace';
import type { WorkDetail } from '../../src/shared/contracts';
import type { BookExtractionApi, BookExtractionPreview } from '../../src/shared/book-extraction';
import type { BookExtractionAiApi } from '../../src/shared/book-extraction-ai';
afterEach(cleanup);
function setup(extraSegments = 0) {
  const categoryId = crypto.randomUUID(), work: WorkDetail = { id: crypto.randomUUID(), title: '当前作品', revision: 1, chapters: [], volumes: [], deletedItems: [],
    assets: { categories: [{ id: categoryId, name: '景物描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }], tags: [], knowledge: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null } };
  const preview: BookExtractionPreview = { token: crypto.randomUUID(), workId: work.id, filename: '优秀作品.txt', fileHash: 'a'.repeat(64), format: 'txt', warnings: [], segments: [
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 1, text: '<script>优美的雨景</script>' },
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 2, text: '没有审核的内容' },
  ] };
  for (let index = 0; index < extraSegments; index++) preview.segments.push({ id: crypto.randomUUID(), chapterTitle: '后章', chapterIndex: 2, paragraphIndex: index + 1, text: `后章第${index + 1}段` });
  const aiPrepared = { confirmationToken: crypto.randomUUID(), requestHash: 'a'.repeat(64), expiresAt: Date.now() + 10000, service: '测试云服务', model: '测试模型', scopeLabel: '所选素材', previewText: '原始段落', paragraphIds: [preview.segments[0].id], billingHint: '可能产生费用', estimatedInputTokens: 80, maxOutputTokens: 4096 };
  const api: BookExtractionApi & BookExtractionAiApi = {
    prepareBookExtractionAi: vi.fn(async () => aiPrepared),
    executeBookExtractionAi: vi.fn(async () => ({ workId: work.id, previewToken: preview.token, requestHash: aiPrepared.requestHash, rawText: '原始回答', suggestions: [{ segmentId: preview.segments[0].id, excerpt: '优美的雨景', categoryId, tagIds: [], technique: '声音与景物结合', usage: '适合夜景', exercise: '用三句话描写雨夜' }] })),
    getBookExtractionAiResult: vi.fn(async () => ({ status: 'missing' as const })), cancelBookExtractionAi: vi.fn(async () => {}),
    chooseBookExtraction: vi.fn(async () => preview), confirmBookExtraction: vi.fn(async () => ({ ...work, revision: 2 })), cancelBookExtraction: vi.fn(async () => {}) };
  const onClose = vi.fn(), onCommitted = vi.fn(), onDirtyChange = vi.fn();
  render(<BookExtractionWorkspace work={work} api={api} onClose={onClose} onCommitted={onCommitted} onDirtyChange={onDirtyChange} />);
  return { api, work, preview, onClose, onCommitted, onDirtyChange };
}
it('默认零选择；只审核选中段落和权限后入库，正文纯文本展示，编辑后须重新审核', async () => {
  const { api, work, onCommitted, onDirtyChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  expect(screen.getByRole('button', { name: '确认入库（0）' })).toHaveProperty('disabled', true);
  expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 1' }), { target: { value: '自己的仿写笔记' } });
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  expect(screen.getByRole('button', { name: '确认入库（1）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 })));
  expect(api.confirmBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ workId: work.id, permissionConfirmed: true, items: [expect.objectContaining({ body: '自己的仿写笔记' })] }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});
async function generateAiSuggestion() {
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  await screen.findByRole('dialog', { name: '确认 AI 辅助拆书' });
  fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
  await screen.findByRole('button', { name: '带入审核' });
}
it('AI分析选择不预选入库，作者采纳后带入摘录与写法，仍须重新审核', async () => {
  const { api } = setup();
  await generateAiSuggestion();
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false);
  expect(api.confirmBookExtraction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '原文摘录：\n优美的雨景\n\n写作手法：\n声音与景物结合\n\n适用场景：\n适合夜景\n\n仿写练习：\n用三句话描写雨夜');
  expect(screen.getByRole('button', { name: '确认入库（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledTimes(1));
});
it('AI建议不会静默覆盖手工编辑，取消替换保留原稿，确认后清除审核勾选', async () => {
  setup(); await generateAiSuggestion();
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 1' }), { target: { value: '我的手工学习笔记' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  await screen.findByRole('dialog', { name: '替换本段审核内容？' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '我的手工学习笔记');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  fireEvent.click(screen.getByRole('button', { name: '替换并重新审核' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false));
});
it('失败保留审核并用原操作ID重试；取消退出需确认且不入库', async () => {
  const { api, onClose } = setup(); vi.mocked(api.confirmBookExtraction).mockRejectedValueOnce(new Error('磁盘空间不足'));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '磁盘空间不足');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  await screen.findByRole('dialog'); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.confirmBookExtraction).mock.calls[0][0].operationId).toBe(vi.mocked(api.confirmBookExtraction).mock.calls[1][0].operationId);
});
it('取消退出令预览作废，不写库', async () => {
  const { api, onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃摘选并返回' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(api.cancelBookExtraction).toHaveBeenCalledTimes(1); expect(api.confirmBookExtraction).not.toHaveBeenCalled();
});
it('取消文件选择不改状态；选择失败显示原因且可重试，未预览时可直接返回', async () => {
  const { api, onClose } = setup();
  vi.mocked(api.chooseBookExtraction).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('文件无效'));
  fireEvent.change(screen.getByRole('combobox', { name: 'TXT 编码' }), { target: { value: 'gb18030' } });
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '选择 TXT / DOCX' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '文件无效');
  expect(api.chooseBookExtraction).toHaveBeenLastCalledWith(expect.any(String), 'gb18030');
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled()); expect(api.cancelBookExtraction).not.toHaveBeenCalled();
});
it('分页保持审核选择；取消失败保留内容，来源更改带入确认请求', async () => {
  const { api, onClose } = setup(22);
  vi.mocked(api.cancelBookExtraction).mockRejectedValueOnce(new Error('取消失败'));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.queryByRole('textbox', { name: '摘选内容 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.change(screen.getByRole('textbox', { name: '来源作品名' }), { target: { value: '准确作品名' } });
  fireEvent.change(screen.getByRole('textbox', { name: '来源作者' }), { target: { value: '准确作者' } });
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃摘选并返回' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveProperty('textContent', '取消失败'));
  expect(onClose).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '<script>优美的雨景</script>');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ sourceTitle: '准确作品名', sourceAuthor: '准确作者' })));
});
it('文件选择解析尚未返回时同步通知脏保护，取消选择完成后解除', async () => {
  const { api, onDirtyChange } = setup();
  let resolve!: (value: null) => void;
  vi.mocked(api.chooseBookExtraction).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  onDirtyChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  expect(screen.getByRole('button', { name: '返回知识库' })).toHaveProperty('disabled', true);
  resolve(null);
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});
