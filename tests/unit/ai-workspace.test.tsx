// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AiWorkspace } from '../../src/renderer/components/ai-workspace';
import { AiSettingsPanel } from '../../src/renderer/components/ai-settings-panel';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
import { emptyDocument } from '../../src/shared/document';
import type { WorkDetail } from '../../src/shared/contracts';
import type { AiCandidate, AiPreparedRequest } from '../../src/shared/ai';
afterEach(cleanup);
it('AI生成和候选审核向写作区报告暂停状态，放弃候选后解除', async () => {
  const { props, view } = setup();
  const onActivityChange = vi.fn();
  view.rerender(<AiWorkspace {...props} onActivityChange={onActivityChange} />);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  await waitFor(() => expect(onActivityChange).toHaveBeenLastCalledWith(true));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('润色候选', { selector: 'pre[aria-label="候选全文"]' });
  expect(onActivityChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃此候选' }));
  await waitFor(() => expect(onActivityChange).toHaveBeenLastCalledWith(false));
});
it('候选差异可阅读，返回工具时恢复原文与候选，过期版本禁止写入', async () => {
  const { props, view } = setup();
  const onReviewChange = vi.fn();
  view.rerender(<AiWorkspace {...props} onReviewChange={onReviewChange} />);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('润色候选', { selector: 'pre[aria-label="候选全文"]' });
  expect(screen.getByLabelText('增删差异')).toHaveTextContent('原文雨夜');
  expect(screen.getByLabelText('增删差异').querySelector('del')).not.toBeNull();
  expect(screen.getByLabelText('增删差异').querySelector('ins')).not.toBeNull();
  await waitFor(() => expect(onReviewChange).toHaveBeenLastCalledWith(expect.objectContaining({ candidate: expect.objectContaining({ id: 'candidate' }), original: '原文雨夜' })));
  const review = onReviewChange.mock.calls.at(-1)![0]; view.unmount();
  render(<AiWorkspace {...props} work={{ ...props.work, revision: 4 }} initialReview={review} />);
  expect(screen.getByText('润色候选', { selector: 'pre[aria-label="候选全文"]' })).toBeVisible();
  expect(screen.getByLabelText('原文对比')).toHaveTextContent('原文雨夜');
  expect(screen.getByRole('button', { name: '确认写入正文' })).toBeDisabled();
});
it('正文右键带入重复单句真实选区，预览发送目标偏移且不自动联网', async () => {
  const { props, view } = setup();
  props.work.chapters[0].document.content[0].content = [{ type: 'text', text: '雨落。雨落。' }];
  const paragraphId = props.work.chapters[0].document.content[0].attrs.id;
  view.rerender(<AiWorkspace {...props} selectionRequest={{ operation: 'sentencePolish', token: 1, paragraphIds: [paragraphId], text: '雨落。', sentenceFrom: 3 }} />);
  await waitFor(() => expect(screen.getByLabelText('目标单句')).toHaveValue('雨落。'));
  expect(props.onPrepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  await screen.findByRole('dialog');
  expect(props.onPrepare).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sentencePolish', targetParagraphIds: [paragraphId], sentenceText: '雨落。', sentenceFrom: 3 }));
  expect(props.onExecute).not.toHaveBeenCalled();
});
it('切换章节清除旧选区，避免上一章偏移误用于新章', async () => {
  const { props, view } = setup();
  view.rerender(<AiWorkspace {...props} selectionRequest={{ operation: 'sentencePolish', token: 1, paragraphIds: [props.work.chapters[0].document.content[0].attrs.id], text: '原文', sentenceFrom: 0 }} />);
  await waitFor(() => expect(screen.getByLabelText('AI 操作')).toHaveValue('sentencePolish'));
  const work = { ...props.work, chapters: [...props.work.chapters, { ...props.work.chapters[0], id: 'second', document: emptyDocument() }] };
  view.rerender(<AiWorkspace {...props} work={work} chapterId="second" />);
  await waitFor(() => expect(screen.getByLabelText('AI 操作')).toHaveValue('paragraphPolish'));
  expect(screen.queryByLabelText('目标单句')).toBeNull();
});
it('同章前插重复句后从右上重开清除旧偏移，候选和原文仍配对保留', async () => {
  const { props, view } = setup();
  props.work.chapters[0].document.content[0].content = [{ type: 'text', text: '雨落。雨落。' }];
  view.rerender(<AiWorkspace {...props} entryToken={1} selectionRequest={{ operation: 'sentencePolish', token: 1, paragraphIds: [props.work.chapters[0].document.content[0].attrs.id], text: '雨落。', sentenceFrom: 3 }} />);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('润色候选', { selector: 'pre[aria-label="候选全文"]' });
  const work = structuredClone(props.work); work.revision++;
  work.chapters[0].document.content[0].content = [{ type: 'text', text: '雨落。雨落。雨落。' }];
  view.rerender(<AiWorkspace {...props} work={work} entryToken={2} />);
  await waitFor(() => expect(screen.getByLabelText('AI 操作')).toHaveValue('paragraphPolish'));
  expect(screen.queryByLabelText('目标单句')).toBeNull();
  expect(screen.getByText('润色候选', { selector: 'pre[aria-label="候选全文"]' })).toBeVisible();
  expect(screen.getByLabelText('原文对比')).toHaveTextContent('雨落。');
  expect(screen.getByText(/结果已过期/)).toBeVisible();
});
function setup() {
  const document = emptyDocument(); document.content[0].content = [{ type: 'text', text: '原文雨夜' }];
  const work: WorkDetail = { id: 'work', title: '雨夜', revision: 3, chapters: [{ id: 'chapter', title: '第一章', document, wordCount: 4, volumeId: null }], volumes: [], deletedItems: [] };
  const prepared: AiPreparedRequest = { confirmationToken: 'token', requestHash: 'hash', expiresAt: Date.now() + 100000, service: '自选云', model: 'model', scopeLabel: '当前章', previewText: '完整发送内容', paragraphIds: [document.content[0].attrs.id], billingHint: '本次按服务计费', estimatedInputTokens: 100, maxOutputTokens: 2048 };
  const candidate: AiCandidate = { id: 'candidate', operation: 'paragraphPolish', workId: 'work', baselineRevision: 3, paragraphIds: prepared.paragraphIds, text: '润色候选', requestHash: 'hash', createdAt: '' };
  const props = { work, chapterId: 'chapter', busy: false, onPrepare: vi.fn(async () => prepared), onExecute: vi.fn(async () => candidate), onCancel: vi.fn(), onApply: vi.fn(async () => true), onExtract: vi.fn(async () => true) };
  return { props, prepared, candidate, view: render(<AiWorkspace {...props} />) };
}
it('预览完整发送范围与计费后明确确认才执行，候选必须再次确认写入', async () => {
  const { props } = setup();
  expect(screen.getByRole('option', { name: '当前章节' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('完整发送内容'); expect(dialog).toHaveTextContent('本次按服务计费');
  expect(within(dialog).getByRole('button', { name: '确认发送' })).toHaveClass('primary');
  expect(props.onExecute).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByText('润色候选', { selector: 'pre[aria-label="候选全文"]' })).toBeInTheDocument();
  expect(props.onApply).not.toHaveBeenCalled();
  expect(screen.getByLabelText('原文对比')).toHaveTextContent('原文雨夜');
  props.onApply.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '确认写入正文' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/变化|未写入/);
  expect(screen.getByText('润色候选', { selector: 'pre[aria-label="候选全文"]' })).toBeInTheDocument();
});
it('知识参考显示内容出处，作者逐条选用后才进入请求', async () => {
  const { props, view } = setup();
  const work = { ...props.work, assets: { outlines: [], foreshadows: [], evidence: [], categories: [], tags: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
    knowledge: [{ id: 'ref', body: '雨夜，窗外的灯光渐暗。', source: '参考书第2章', categoryId: 'category', tagIds: [], origin: null, revision: 1, deletedAt: null }] } };
  view.rerender(<AiWorkspace {...props} work={work} />);
  fireEvent.click(screen.getByText('知识参考 · 作者选用'));
  const choice = screen.getByRole('checkbox', { name: /雨夜，窗外的灯光渐暗/ });
  expect(choice).not.toBeChecked(); expect(screen.getByText('参考书第2章')).toBeVisible();
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  await screen.findByRole('dialog');
  expect(props.onPrepare).toHaveBeenCalledWith(expect.objectContaining({ referenceKnowledgeIds: ['ref'] }));
});
it('分析只给真实证据定位入口，原文变化后明确过期并撤销定位', async () => {
  const { props, candidate, view } = setup(); const chapterId = crypto.randomUUID();
  const work = structuredClone(props.work); work.chapters[0].id = chapterId;
  const onLocate = vi.fn();
  candidate.operation = 'consistency'; candidate.referenceChapterIds = [chapterId];
  candidate.text = JSON.stringify({ findings: [{ dimension: '时间', message: '时间衔接需要核对', uncertainty: '可能是倒叙', evidence: [{ chapterId, paragraphId: work.chapters[0].document.content[0].attrs.id, excerpt: '原文雨夜' }] }] });
  view.rerender(<AiWorkspace {...props} work={work} chapterId={chapterId} onLocate={onLocate} />);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('时间衔接需要核对'); expect(screen.getByText('不确定性：可能是倒叙')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '定位正文证据' }));
  expect(onLocate).toHaveBeenCalledWith(chapterId, work.chapters[0].document.content[0].attrs.id);
  work.revision++;
  view.rerender(<AiWorkspace {...props} work={work} chapterId={chapterId} onLocate={onLocate} />);
  expect(screen.getByText(/结果已过期/)).toBeVisible(); expect(screen.queryByRole('button', { name: '定位正文证据' })).toBeNull();
});
it('新的预览取消或发送失败时，旧候选仍与生成时的原文正确配对', async () => {
  const { props, view } = setup();
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('润色候选', { selector: 'pre[aria-label="候选全文"]' });
  const changed = structuredClone(props.work); changed.revision++; changed.chapters[0].document.content[0].content = [{ type: 'text', text: '后来修改的正文' }];
  view.rerender(<AiWorkspace {...props} work={changed} />);
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(screen.getByLabelText('原文对比')).toHaveTextContent('原文雨夜');
  expect(screen.getByLabelText('原文对比')).not.toHaveTextContent('后来修改的正文');
  props.onExecute.mockRejectedValueOnce(new Error('额度不足'));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('额度不足'); expect(screen.getByLabelText('原文对比')).toHaveTextContent('原文雨夜');
  expect(screen.getByText('润色候选', { selector: 'pre[aria-label="候选全文"]' })).toBeInTheDocument();
  props.onPrepare.mockRejectedValueOnce(new Error('预览失败'));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  await screen.findByText('预览失败'); expect(screen.getByLabelText('原文对比')).toHaveTextContent('原文雨夜');
});
it('云模型设置报告草稿与异步保存中的离开保护，失败后保留密钥直到作者放弃', async () => {
  let fail!: (reason: Error) => void;
  const onSave = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; })), onDirtyChange = vi.fn();
  render(<AiSettingsPanel value={{ provider: { id: 'cloud', name: '作者云', baseUrl: 'https://api.example.com/v1', model: 'model' }, hasCredential: true }} onSave={onSave} onClear={vi.fn(async () => undefined)} onDirtyChange={onDirtyChange} busy={false} />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-secret' } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '保存云端模型配置' }));
  expect(screen.getByRole('button', { name: '放弃模型设置更改' })).toBeDisabled();
  fail(new Error('不可写')); await screen.findByText('不可写');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true); expect(screen.getByLabelText('API Key')).toHaveValue('new-secret');
  fireEvent.click(screen.getByRole('button', { name: '放弃模型设置更改' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText('API Key')).toHaveValue('');
});
it('保存成功提示可见的同一提交阶段已解除设置离开保护', async () => {
  let blocked = false;
  const observations: boolean[] = [];
  render(<Profiler id="settings" onRender={() => {
    if (document.querySelector('[role="status"]')?.textContent?.includes('云端模型配置已保存')) observations.push(blocked);
  }}><AiSettingsPanel value={{ provider: { id: 'cloud', name: '作者云', baseUrl: 'https://api.example.com/v1', model: 'model' }, hasCredential: true }} onSave={async () => undefined} onClear={async () => undefined} onDirtyChange={value => { blocked = value; }} busy={false} /></Profiler>);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-test-key' } });
  expect(blocked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存云端模型配置' }));
  await screen.findByText('云端模型配置已保存，密钥不会在界面回显。');
  expect(observations.length).toBeGreaterThan(0);
  expect(observations).not.toContain(true);
});
it('设置页待保存密钥及失败草稿阻止页面离开，作者放弃后恢复导航', async () => {
  const adapter = createStructureAdapter(); let fail!: (reason: Error) => void;
  adapter.api.getAiSettings = async () => ({ provider: { id: 'cloud', name: '作者云', baseUrl: 'https://api.example.com/v1', model: 'model' }, hasCredential: true });
  adapter.api.saveAiSettings = () => new Promise((_resolve, reject) => { fail = reject; });
  const view = render(<App api={adapter.api} />);
  try {
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.change(await screen.findByLabelText('API Key'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '作品集' }));
    expect(screen.getByLabelText('API Key')).toHaveValue('new-secret');
    fireEvent.click(screen.getByRole('button', { name: '保存云端模型配置' }));
    await act(async () => { await expect(adapter.close()).rejects.toThrow(/资产编辑/); });
    await act(async () => { fail(new Error('配置不可写')); }); await screen.findByText('配置不可写');
    fireEvent.click(screen.getByRole('button', { name: '作品集' })); expect(screen.getByLabelText('API Key')).toHaveValue('new-secret');
    fireEvent.click(screen.getByRole('button', { name: '放弃模型设置更改' }));
    fireEvent.click(screen.getByRole('button', { name: '作品集' })); expect(await screen.findByRole('heading', { name: '作品集' })).toBeInTheDocument();
  } finally { view.unmount(); adapter.dispose(); }
});
it('可取消授权预览；失败保留正文且不自动重发', async () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
  expect(props.onCancel).toHaveBeenCalledWith('token'); expect(props.onExecute).not.toHaveBeenCalled();
  props.onExecute.mockRejectedValueOnce(new Error('额度不足'));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('额度不足'); expect(props.onExecute).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '预览 AI 请求' })).toBeEnabled();
});
it('知识提取逐项可编辑且未审核不可入库，分析结果不显示正文写入', async () => {
  const { props, candidate } = setup(); candidate.operation = 'extractKnowledge'; candidate.text = JSON.stringify({ items: [{ body: '第一条知识' }, { body: '第二条知识' }] });
  fireEvent.change(screen.getByLabelText('AI 操作'), { target: { value: 'extractKnowledge' } });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByLabelText('知识候选 1')).toHaveValue('第一条知识');
  expect(screen.queryByRole('button', { name: '确认写入正文' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认入库已审核条目' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('知识候选 1'), { target: { value: '作者修订第一条' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库已审核条目' }));
  await waitFor(() => expect(props.onExtract).toHaveBeenCalledWith('candidate', [{ body: '作者修订第一条', source: '雨夜 / 第一章' }]));
});
it('知识更新必须显式选目标并对比旧内容，改变目标撤销审核；失败保留候选和选择', async () => {
  const { props, candidate, view } = setup();
  const entry = { id: 'existing', body: '原有角色资料', source: '旧出处', categoryId: 'category', tagIds: ['tag'], origin: null, revision: 1, deletedAt: null };
  view.rerender(<AiWorkspace {...props} work={{ ...props.work, assets: { outlines: [], foreshadows: [], evidence: [], knowledge: [entry, { ...entry, id: 'deleted', deletedAt: '已删除' }], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
    categories: [{ id: 'category', name: '人物', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }], tags: [{ id: 'tag', name: '角色', deletedAt: null }] } }} />);
  candidate.operation = 'extractKnowledge'; candidate.text = JSON.stringify({ items: [{ body: '修订角色资料' }] });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByLabelText('知识入库方式 1')).toHaveValue('create');
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  fireEvent.change(screen.getByLabelText('知识入库方式 1'), { target: { value: 'update' } });
  expect(screen.getByRole('checkbox', { name: '审核通过条目 1' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: '审核通过条目 1' })).toBeDisabled();
  expect(within(screen.getByLabelText('更新知识目标 1')).queryByRole('option', { name: /已删除/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('更新知识目标 1'), { target: { value: 'existing' } });
  expect(screen.getByLabelText('更新前知识 1')).toHaveTextContent('原有角色资料');
  expect(screen.getByLabelText('更新前知识 1')).toHaveTextContent('旧出处');
  expect(screen.getByLabelText('知识候选 1')).toHaveValue('修订角色资料');
  expect(screen.getByLabelText('知识分类 1')).toHaveValue('category');
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  props.onExtract.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: '确认入库已审核条目' }));
  await screen.findByRole('alert');
  expect(props.onExtract).toHaveBeenCalledWith('candidate', [{ body: '修订角色资料', source: '雨夜 / 第一章', categoryId: 'category', tagIds: ['tag'], mode: 'update', targetId: 'existing' }]);
  expect(screen.getByLabelText('更新知识目标 1')).toHaveValue('existing');
  expect(screen.getByLabelText('知识候选 1')).toHaveValue('修订角色资料');
  fireEvent.click(screen.getByRole('checkbox', { name: /^角色$/ }));
  expect(screen.getByRole('checkbox', { name: '审核通过条目 1' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库已审核条目' }));
  await waitFor(() => expect(props.onExtract).toHaveBeenLastCalledWith('candidate', [expect.objectContaining({ mode: 'update', tagIds: [] })]));
});
it('更新模式切回新建撤销审核并移除旧目标', async () => {
  const { candidate } = setup(); candidate.operation = 'extractKnowledge'; candidate.text = JSON.stringify({ items: [{ body: '新资料' }] });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByLabelText('知识入库方式 1');
  fireEvent.change(screen.getByLabelText('知识入库方式 1'), { target: { value: 'update' } });
  fireEvent.change(screen.getByLabelText('知识入库方式 1'), { target: { value: 'create' } });
  expect(screen.getByRole('checkbox', { name: '审核通过条目 1' })).not.toBeChecked();
  expect(screen.queryByLabelText('更新知识目标 1')).toBeNull();
});
it('模型分类标签建议必须显式审核，改分类会撤销审核且仅提交所选作品内字典', async () => {
  const { props, candidate, view } = setup();
  const work = { ...props.work, assets: { outlines: [], foreshadows: [], evidence: [], knowledge: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
    categories: [{ id: 'category', name: '人物描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }], tags: [{ id: 'tag', name: '雨夜', deletedAt: null }] } };
  view.rerender(<AiWorkspace {...props} work={work} />);
  candidate.operation = 'extractKnowledge'; candidate.text = JSON.stringify({ items: [{ body: '旅人', type: '角色', category: '人物描写', tags: ['雨夜'] }] });
  fireEvent.change(screen.getByLabelText('AI 操作'), { target: { value: 'extractKnowledge' } });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByLabelText('知识分类 1')).toHaveValue('category');
  expect(screen.getByRole('button', { name: '确认入库已审核条目' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  fireEvent.change(screen.getByLabelText('知识分类 1'), { target: { value: '' } });
  expect(screen.getByRole('checkbox', { name: '审核通过条目 1' })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText('知识分类 1'), { target: { value: 'category' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过条目 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库已审核条目' }));
  await waitFor(() => expect(props.onExtract).toHaveBeenCalledWith('candidate', [{ body: '旅人', source: '雨夜 / 第一章', categoryId: 'category', tagIds: ['tag'] }]));
});
it('层级同名分类不自动选第一个，下拉展示完整路径供作者选择', async () => {
  const { props, candidate, view } = setup();
  const categories = [
    { id: 'people', name: '人物', parentId: null }, { id: 'landscape', name: '景物', parentId: null },
    { id: 'people-text', name: '描写', parentId: 'people' }, { id: 'landscape-text', name: '描写', parentId: 'landscape' },
  ].map((item, sortOrder) => ({ ...item, sortOrder, systemKey: null, deletedAt: null }));
  view.rerender(<AiWorkspace {...props} work={{ ...props.work, assets: { outlines: [], foreshadows: [], evidence: [], knowledge: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null, categories, tags: [] } }} />);
  candidate.operation = 'extractKnowledge'; candidate.text = JSON.stringify({ items: [{ body: '一段描写', category: '描写' }] });
  fireEvent.change(screen.getByLabelText('AI 操作'), { target: { value: 'extractKnowledge' } });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByLabelText('知识分类 1')).toHaveValue('');
  expect(screen.getByRole('option', { name: /^人物 \/ 描写$/ })).toHaveValue('people-text');
  expect(screen.getByRole('option', { name: /^景物 \/ 描写$/ })).toHaveValue('landscape-text');
});
it('单句润色必须选择单个段落并填写唯一目标句才预览发送', async () => {
  const { props } = setup();
  fireEvent.change(screen.getByLabelText('AI 操作'), { target: { value: 'sentencePolish' } });
  fireEvent.change(screen.getByLabelText('目标单句'), { target: { value: '雨夜' } });
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/单个段落/);
  fireEvent.click(screen.getByRole('checkbox', { name: /第 1 段/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  await screen.findByRole('dialog');
  expect(props.onPrepare).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sentencePolish', sentenceText: '雨夜', targetParagraphIds: [props.work.chapters[0].document.content[0].attrs.id] }));
});
it('正文替换候选提前提示书签位置变化，非连续目标不产生付费请求预览', async () => {
  const { props, view } = setup(), document = structuredClone(props.work.chapters[0].document);
  document.content[0].content!.push({ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: crypto.randomUUID() } });
  document.content.push(...['第二段', '第三段'].map(text => ({ type: 'paragraph' as const, attrs: { id: crypto.randomUUID() }, content: [{ type: 'text' as const, text }] })));
  view.rerender(<AiWorkspace {...props} work={{ ...props.work, chapters: [{ ...props.work.chapters[0], document }] }} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /第 1 段/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /第 3 段/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('连续'); expect(props.onPrepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /第 3 段/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  expect(await screen.findByText(/1 个书签.*首段末尾/)).toBeInTheDocument();
});
it('云模型设置不回显已保存密钥，保存失败保留新输入，清除由作者触发', async () => {
  const onSave = vi.fn(async () => { throw new Error('配置不可写'); }), onClear = vi.fn(async () => undefined);
  render(<AiSettingsPanel value={{ provider: { id: 'cloud', name: '作者云', baseUrl: 'https://api.example.com/v1', model: 'model' }, hasCredential: true }} onSave={onSave} onClear={onClear} busy={false} />);
  expect(screen.getByLabelText('API Key')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存云端模型配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('配置不可写'); expect(screen.getByLabelText('API Key')).toHaveValue('new-secret');
  fireEvent.click(screen.getByRole('button', { name: '清除云端模型配置' })); expect(onClear).toHaveBeenCalledOnce();
});
