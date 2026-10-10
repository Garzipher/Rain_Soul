// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookExtractionAiPanel } from '../../src/renderer/components/book-extraction-ai-panel';
import type { WorkDetail } from '../../src/shared/contracts';
import type { BookExtractionPreview } from '../../src/shared/book-extraction';
import type { AiPreparedRequest } from '../../src/shared/ai';
import type { BookExtractionAiApi, BookExtractionAiResult } from '../../src/shared/book-extraction-ai';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup(permission = true, count = 2, disabled = false) {
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
  const props = { work, preview, api, permission, disabled, onUse, onBusyChange };
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
  await waitFor(() => expect(onUse).toHaveBeenCalledWith(result.suggestions[0], expect.any(Function)));
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
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'missing' });
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
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'missing' });
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
it('父工作区手动提交或关闭期间不能准备、改变分析选择或采纳推荐', async () => {
  const context = setup(true, 2, true), { api, view, onUse } = context;
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' }));
  expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: '准备 AI 推荐' })).toBeDisabled(); expect(api.prepareBookExtractionAi).not.toHaveBeenCalled();
  view.rerender(<BookExtractionAiPanel {...context} disabled={false} />);
  await execute(); await screen.findByText('用声音刻画雨景');
  view.rerender(<BookExtractionAiPanel {...context} disabled />);
  expect(screen.getByRole('button', { name: '带入审核' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '带入审核' })); expect(onUse).not.toHaveBeenCalled();
});
it('发送前授权已经过期时不执行，保留选择供取消后重新准备', async () => {
  const { api, prepared } = setup(); const dialog = await prepare();
  vi.spyOn(Date, 'now').mockReturnValue(prepared.expiresAt + 1);
  fireEvent.click(within(dialog).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('授权预览已过期'); expect(api.executeBookExtractionAi).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).toBeChecked();
});
it('准备返回前撤销许可，取消失败仍保留保护和取消凭证', async () => {
  const context = setup(), { api, prepared, view, onBusyChange } = context;
  let resolve!: (value: AiPreparedRequest) => void;
  vi.mocked(api.prepareBookExtractionAi).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  vi.mocked(api.cancelBookExtractionAi).mockRejectedValueOnce(new Error('无法确认取消'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })); fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  view.rerender(<BookExtractionAiPanel {...context} permission={false} />);
  await act(async () => resolve(prepared));
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('button', { name: '取消本次 AI 请求' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '取消本次 AI 请求' }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false)); expect(api.executeBookExtractionAi).not.toHaveBeenCalled();
});
it('父渲染更换API对象引用不会作废进行中的准备', async () => {
  const context = setup(), { api, prepared, view } = context;
  let resolve!: (value: AiPreparedRequest) => void;
  vi.mocked(api.prepareBookExtractionAi).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })); fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  view.rerender(<BookExtractionAiPanel {...context} api={{ ...api }} />);
  await act(async () => resolve(prepared));
  expect(screen.getByRole('dialog', { name: '确认 AI 辅助拆书' })).toBeVisible(); expect(api.cancelBookExtractionAi).not.toHaveBeenCalled();
});
it('新响应未通过校验时保留旧成功推荐，复制失败提示手工复制', async () => {
  const { api, result } = setup(); await execute(); await screen.findByText('用声音刻画雨景');
  vi.mocked(api.executeBookExtractionAi).mockResolvedValueOnce({ ...result, validationError: '原文摘录不符', rawText: '无法采纳的原始材料' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('拒绝访问剪贴板'); }) } });
  await execute(); expect(await screen.findByText('无法采纳的原始材料')).toBeVisible(); expect(screen.getByText('用声音刻画雨景')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '复制原始响应' })); expect(await screen.findByText('复制失败，请选择原始响应手动复制。')).toBeVisible();
});
it('准备失败保留选择；授权取消失败保留模态框供重试', async () => {
  const { api } = setup(); vi.mocked(api.prepareBookExtractionAi).mockRejectedValueOnce(new Error('请配置服务'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })); fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请配置服务'); expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).toBeChecked();
  const dialog = await prepare(); vi.mocked(api.cancelBookExtractionAi).mockRejectedValueOnce(new Error('取消失败'));
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消' })).toBeEnabled());
  expect(dialog).toBeVisible(); fireEvent.click(within(dialog).getByRole('button', { name: '取消' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('核对失败或跨作品回执都维持保护，之后只重试本机核对', async () => {
  const { api, result, onBusyChange } = setup(); vi.mocked(api.executeBookExtractionAi).mockRejectedValueOnce(new Error('IPC断开'));
  vi.mocked(api.getBookExtractionAiResult).mockRejectedValueOnce(new Error('本机读取失败')).mockResolvedValueOnce({ status: 'ready', result: { ...result, workId: crypto.randomUUID() } });
  await execute(); await screen.findByRole('button', { name: '核对本机结果' });
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' })); expect(await screen.findByRole('alert')).toHaveTextContent('本机读取失败');
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' })); expect(await screen.findByRole('alert')).toHaveTextContent('推荐回执不匹配');
  expect(onBusyChange).toHaveBeenLastCalledWith(true); expect(screen.queryByText('用声音刻画雨景')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' })); await screen.findByText('用声音刻画雨景'); expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
});
it('更换原文预览后清空选择和推荐，旧发送晚回执不进入新预览', async () => {
  const context = setup(), { api, result, view, preview } = context;
  let resolve!: (value: BookExtractionAiResult) => void;
  vi.mocked(api.executeBookExtractionAi).mockReturnValueOnce(new Promise(done => { resolve = done; })); await execute();
  view.rerender(<BookExtractionAiPanel {...context} preview={{ ...preview, token: crypto.randomUUID() }} />);
  await act(async () => resolve(result));
  expect(screen.queryByText('用声音刻画雨景')).toBeNull(); expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).not.toBeChecked();
});
it('授权模态框Tab与ShiftTab保持焦点边界，取消不改变已有分析范围', async () => {
  setup(); const dialog = await prepare(), cancel = within(dialog).getByRole('button', { name: '取消' }), submit = within(dialog).getByRole('button', { name: '确认发送' });
  const summary = within(dialog).getByText('完整发送内容', { selector: 'summary' });
  expect(cancel).toHaveFocus(); expect(within(dialog).getByLabelText('完整发送内容')).toHaveAttribute('tabindex', '0');
  summary.focus(); fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true }); expect(submit).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Tab' }); expect(summary).toHaveFocus(); fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByRole('checkbox', { name: 'AI 分析段落 1' })).toBeChecked();
});
it.each(['版本变化', '配置变化', '预览变化'])('采纳前本机核对发现%s时保留原始回答并禁止带入，不重新联网', async reason => {
  const { api, result, onUse } = setup(); await execute(); await screen.findByText('用声音刻画雨景');
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'ready', result: { ...result, validationError: reason } });
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(reason); expect(onUse).not.toHaveBeenCalled();
  expect(screen.getByText(result.rawText)).toBeVisible(); expect(screen.getByRole('button', { name: '带入审核' })).toBeDisabled();
  expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
});
it.each(['running', 'missing'] as const)('采纳前本机结果为%s时不能带入，保留旧回答供核对', async status => {
  const { api, result, onUse } = setup(); await execute(); await screen.findByText('用声音刻画雨景');
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status }); fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('本机'); expect(onUse).not.toHaveBeenCalled(); expect(screen.getByText(result.rawText)).toBeVisible();
});
it('采纳核对使用冻结身份，期间保护编辑退出且只能调用一次本机核对', async () => {
  const { api, result, onUse, onBusyChange } = setup(); await execute(); await screen.findByText('用声音刻画雨景');
  let resolve!: (value: { status: 'ready'; result: BookExtractionAiResult }) => void;
  vi.mocked(api.getBookExtractionAiResult).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: '带入审核' })); fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  expect(onBusyChange).toHaveBeenLastCalledWith(true); expect(onUse).not.toHaveBeenCalled();
  await act(async () => resolve({ status: 'ready', result }));
  expect(onUse).toHaveBeenCalledTimes(1); expect(api.getBookExtractionAiResult).toHaveBeenCalledWith({ workId: result.workId, previewToken: result.previewToken, requestHash: result.requestHash });
  expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(api.executeBookExtractionAi).toHaveBeenCalledTimes(1);
});
it.each(['摘录', '建议身份'])('采纳本机回执的%s与点击候选不一致时拒绝带入', async kind => {
  const { api, result, onUse } = setup(); await execute(); await screen.findByText('用声音刻画雨景');
  const changed = { ...result, ...(kind === '摘录' ? { suggestions: [{ ...result.suggestions[0], excerpt: '另一份推荐' }] } : { requestHash: 'f'.repeat(64) }) };
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'ready', result: changed });
  fireEvent.click(screen.getByRole('button', { name: '带入审核' })); expect(await screen.findByRole('alert')).toHaveTextContent('不匹配'); expect(onUse).not.toHaveBeenCalled();
});
it('采纳核对失败或核对期间撤销许可都不能回调审核', async () => {
  const context = setup(), { api, result, view, onUse } = context; await execute(); await screen.findByText('用声音刻画雨景');
  vi.mocked(api.getBookExtractionAiResult).mockRejectedValueOnce(new Error('本机核对失败'));
  fireEvent.click(screen.getByRole('button', { name: '带入审核' })); expect(await screen.findByRole('alert')).toHaveTextContent('本机核对失败'); expect(onUse).not.toHaveBeenCalled();
  let resolve!: (value: { status: 'ready'; result: BookExtractionAiResult }) => void;
  vi.mocked(api.getBookExtractionAiResult).mockReturnValueOnce(new Promise(done => { resolve = done; })); fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  view.rerender(<BookExtractionAiPanel {...context} permission={false} />); await act(async () => resolve({ status: 'ready', result })); expect(onUse).not.toHaveBeenCalled();
});
it('取消回执返回但本机仍running时继续保护，待missing核对才解除', async () => {
  const { api, onBusyChange } = setup(); vi.mocked(api.executeBookExtractionAi).mockRejectedValueOnce(new Error('发送回执丢失'));
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({ status: 'missing' });
  await execute(); await screen.findByRole('button', { name: '核对本机结果' }); fireEvent.click(screen.getByRole('button', { name: '取消本次 AI 请求' }));
  await waitFor(() => expect(api.getBookExtractionAiResult).toHaveBeenCalledTimes(1)); expect(onBusyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '核对本机结果' })); await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});
