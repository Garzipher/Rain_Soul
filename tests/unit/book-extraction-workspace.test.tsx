// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookExtractionWorkspace } from '../../src/renderer/components/book-extraction-workspace';
import type { WorkDetail } from '../../src/shared/contracts';
import type { BookExtractionApi, BookExtractionPreview } from '../../src/shared/book-extraction';
afterEach(cleanup);
function setup() {
  const categoryId = crypto.randomUUID(), work: WorkDetail = { id: crypto.randomUUID(), title: '当前作品', revision: 1, chapters: [], volumes: [], deletedItems: [],
    assets: { categories: [{ id: categoryId, name: '景物描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }], tags: [], knowledge: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null } };
  const preview: BookExtractionPreview = { token: crypto.randomUUID(), workId: work.id, filename: '优秀作品.txt', fileHash: 'a'.repeat(64), format: 'txt', warnings: [], segments: [
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 1, text: '<script>优美的雨景</script>' },
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 2, text: '没有审核的内容' },
  ] };
  const api: BookExtractionApi = { chooseBookExtraction: vi.fn(async () => preview), confirmBookExtraction: vi.fn(async () => ({ ...work, revision: 2 })), cancelBookExtraction: vi.fn(async () => {}) };
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
