// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookExtractionAiPanel } from '../../src/renderer/components/book-extraction-ai-panel';
import type { WorkDetail } from '../../src/shared/contracts';
import type { BookExtractionPreview } from '../../src/shared/book-extraction';
import type { AiPreparedRequest } from '../../src/shared/ai';
import type { BookExtractionAiApi, BookExtractionAiResult } from '../../src/shared/book-extraction-ai';

afterEach(cleanup);
function setup(permission = true, count = 2) {
  const categoryId = crypto.randomUUID(), tagId = crypto.randomUUID();
  const work: WorkDetail = { id: crypto.randomUUID(), title: '当前作品', revision: 1, chapters: [], volumes: [], deletedItems: [], assets: {
    categories: [{ id: categoryId, name: '景物描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }],
    tags: [{ id: tagId, name: '雨景', deletedAt: null }], knowledge: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  } };
  const preview: BookExtractionPreview = { token: crypto.randomUUID(), workId: work.id, filename: '原作.txt', fileHash: 'a'.repeat(64), format: 'txt', warnings: [],
    segments: Array.from({ length: count }, (_, index) => ({ id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: index + 1, text: `原文第${index + 1}段` })) };
  const prepared: AiPreparedRequest = { confirmationToken: crypto.randomUUID(), requestHash: 'b'.repeat(64), expiresAt: Date.now() + 100000,
    service: '自选云服务', model: '写作模型', scopeLabel: '仅所选原文第1段', previewText: '完整发送内容：原文第1段', paragraphIds: [preview.segments[0].id], billingHint: '本次按服务商价格计费', estimatedInputTokens: 80, maxOutputTokens: 2048 };
  const result: BookExtractionAiResult = { workId: work.id, previewToken: preview.token, requestHash: prepared.requestHash,
    suggestions: [{ segmentId: preview.segments[0].id, excerpt: '原文第1段', categoryId, tagIds: [tagId], technique: '用声音刻画雨景', usage: '用于紧张场面', exercise: '以三句话仿写骤雨' }], rawText: '原始推荐' };
  const api: BookExtractionAiApi = { prepareBookExtractionAi: vi.fn(async () => prepared), executeBookExtractionAi: vi.fn(async () => result),
    getBookExtractionAiResult: vi.fn(async () => ({ status: 'ready' as const, result })), cancelBookExtractionAi: vi.fn(async () => {}) };
  const onUse = vi.fn(), onBusyChange = vi.fn();
  const props = { work, preview, api, permission, onUse, onBusyChange };
  const view = render(<BookExtractionAiPanel {...props} />);
  return { ...props, prepared, result, view };
}
async function prepare() {
  const checkbox = screen.getByRole('checkbox', { name: 'AI 分析段落 1' });
  if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
  screen.getByRole('button', { name: '准备 AI 推荐' }).focus();
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  return screen.findByRole('dialog', { name: '确认 AI 辅助拆书' });
}
async function execute() { const dialog = await prepare(); fireEvent.click(within(dialog).getByRole('button', { name: '确认发送' })); }

it('未确认原文使用许可或未选择段落时禁止准备，AI选择默认清空', () => {
  const { api } = setup(false);
  const checkbox = screen.getByRole('checkbox', { name: 'AI 分析段落 1' });
  expect(checkbox).toHaveProperty('checked', false);
  fireEvent.click(checkbox);
  expect(screen.getByRole('button', { name: '准备 AI 推荐' })).toHaveProperty('disabled', true);
  expect(api.prepareBookExtractionAi).not.toHaveBeenCalled(); expect(api.executeBookExtractionAi).not.toHaveBeenCalled();
});
it('发送前显示服务、范围、完整材料和费用；Escape取消授权并恢复焦点，零云执行', async () => {
  const { api, preview, work, onBusyChange } = setup();
  const dialog = await prepare();
  for (const text of ['自选云服务 · 写作模型 · 仅所选原文第1段', '完整发送内容：原文第1段', '本次按服务商价格计费', '预计输入 80 token；输出上限 2048 token。']) expect(within(dialog).getByText(text)).toBeVisible();
  expect(api.prepareBookExtractionAi).toHaveBeenCalledWith({ workId: work.id, token: preview.token, segmentIds: [preview.segments[0].id], permissionConfirmed: true });
  expect(api.executeBookExtractionAi).not.toHaveBeenCalled(); expect(onBusyChange).toHaveBeenCalledWith(true);
  expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.cancelBookExtractionAi).toHaveBeenCalledTimes(1); expect(api.executeBookExtractionAi).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '准备 AI 推荐' })).toHaveFocus(); expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
it('跨页保持独立分析选择且最多20段，发送原文范围与顺序明确', async () => {
  const { api, preview } = setup(true, 21);
  for (let index = 1; index <= 20; index++) fireEvent.click(screen.getByRole('checkbox', { name: `AI 分析段落 ${index}` }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 下一页' }));
  expect(screen.getByRole('checkbox', { name: 'AI 分析段落 21' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'AI 上一页' }));
  expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 下一页' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 21' }));
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  await screen.findByRole('dialog');
  expect(api.prepareBookExtractionAi).toHaveBeenCalledWith(expect.objectContaining({ segmentIds: preview.segments.slice(1).map(segment => segment.id) }));
});
it('推荐展示写法、场景、练习和分类标签，点击带入审核才回调，不直接入库', async () => {
  const { onUse, api, result } = setup();
  await execute();
  expect(await screen.findByText('用声音刻画雨景')).toBeVisible();
  for (const text of ['用于紧张场面', '以三句话仿写骤雨', '景物描写', '雨景']) expect(screen.getByText(text)).toBeVisible();
  expect(onUse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  expect(onUse).toHaveBeenCalledWith(result.suggestions[0]);
  expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
  expect(api.executeBookExtractionAi).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
});
it('结构校验失败只展示可复制纯文本，含脚本字符串也不能带入审核', async () => {
  const { api, result, onUse } = setup();
  const rawText = '<script>window.bad = true</script>模型原始响应';
  vi.mocked(api.executeBookExtractionAi).mockResolvedValueOnce({ ...result, rawText, validationError: '摘录未匹配原文' });
  const copy = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  await execute();
  expect(await screen.findByText(rawText)).toBeVisible(); expect(screen.getByRole('alert')).toHaveTextContent('摘录未匹配原文');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByRole('button', { name: '带入审核' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '复制原始响应' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(rawText)); expect(onUse).not.toHaveBeenCalled();
});
it('执行回执不明保持退出保护，仅按冻结哈希核对本机；进行中不解锁也不重发', async () => {
  const { api, work, preview, prepared, onBusyChange } = setup();
  vi.mocked(api.executeBookExtractionAi).mockRejectedValueOnce(new Error('IPC 回执丢失'));
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'running' });
  await execute();
  expect(await screen.findByRole('button', { name: '核对本机结果' })).toBeEnabled();
  expect(onBusyChange).toHaveBeenLastCalledWith(true); expect(screen.getByRole('button', { name: '准备 AI 推荐' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' }));
  expect(await screen.findByText('请求仍在进行中，可稍后再次核对本机结果。')).toBeVisible();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(api.getBookExtractionAiResult).toHaveBeenCalledWith({ workId: work.id, previewToken: preview.token, requestHash: prepared.requestHash });
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' }));
  expect(await screen.findByText('用声音刻画雨景')).toBeVisible();
  expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
});
it('失败与本机无回执保留上次成功推荐，核对缺失后解除保护且不自动重试', async () => {
  const { api, onBusyChange } = setup();
  await execute(); await screen.findByText('用声音刻画雨景');
  vi.mocked(api.executeBookExtractionAi).mockRejectedValueOnce(new Error('联网失败'));
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'missing' });
  await execute(); await screen.findByRole('button', { name: '核对本机结果' });
  expect(screen.getByText('用声音刻画雨景')).toBeVisible(); expect(screen.getByRole('button', { name: '带入审核' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '带入审核' })).toBeEnabled());
  expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(2);
});
it('联网期间可以明确取消，取消后的晚响应不能覆盖旧成功推荐', async () => {
  const { api, result, prepared, onBusyChange } = setup();
  await execute(); await screen.findByText('用声音刻画雨景');
  let resolve!: (value: BookExtractionAiResult) => void;
  vi.mocked(api.executeBookExtractionAi).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await execute();
  fireEvent.click(screen.getByRole('button', { name: '取消本次 AI 请求' }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(api.cancelBookExtractionAi).toHaveBeenCalledWith(prepared.confirmationToken);
  await act(async () => resolve({ ...result, suggestions: [{ ...result.suggestions[0], technique: '不应出现的晚回复' }] }));
  expect(screen.queryByText('不应出现的晚回复')).toBeNull(); expect(screen.getByText('用声音刻画雨景')).toBeVisible();
});
it('取消失败保留退出保护，可重试取消并解除', async () => {
  const { api, onBusyChange } = setup();
  vi.mocked(api.cancelBookExtractionAi).mockRejectedValueOnce(new Error('取消回执不明'));
  vi.mocked(api.executeBookExtractionAi).mockRejectedValueOnce(new Error('发送回执不明'));
  await execute(); await screen.findByRole('button', { name: '核对本机结果' });
  fireEvent.click(screen.getByRole('button', { name: '取消本次 AI 请求' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('取消回执不明'); expect(onBusyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '取消本次 AI 请求' }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});
it('许可撤销立即作废发送授权；卸载时取消所有完成缓存及未完成授权', async () => {
  const context = setup(), { view, api, prepared } = context;
  await execute(); await screen.findByText('用声音刻画雨景');
  const another = { ...prepared, confirmationToken: crypto.randomUUID() }; vi.mocked(api.prepareBookExtractionAi).mockResolvedValueOnce(another);
  await prepare();
  view.rerender(<BookExtractionAiPanel {...context} permission={false} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.cancelBookExtractionAi).toHaveBeenCalledWith(another.confirmationToken); expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
  view.unmount(); expect(api.cancelBookExtractionAi).toHaveBeenCalledWith(prepared.confirmationToken);
});
it('准备期间同步上报退出保护；卸载后的准备晚回执立即取消', async () => {
  const { api, prepared, view, onBusyChange } = setup();
  let resolve!: (value: AiPreparedRequest) => void;
  vi.mocked(api.prepareBookExtractionAi).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  view.unmount(); await act(async () => resolve(prepared));
  expect(api.cancelBookExtractionAi).toHaveBeenCalledWith(prepared.confirmationToken); expect(api.executeBookExtractionAi).not.toHaveBeenCalled();
});
