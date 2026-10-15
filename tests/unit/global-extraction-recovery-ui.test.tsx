// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { GlobalBookExtractionWorkspace } from '../../src/renderer/components/global-book-extraction-workspace';
import type { GlobalBookExtractionAiPanel } from '../../src/renderer/components/global-book-extraction-ai-panel';
import type { SelectField } from '../../src/renderer/components/select-field';
import type { GlobalExtractionRecovery, GlobalExtractionPreview } from '../../src/shared/global-book-extraction';
import type { GlobalKnowledgePage } from '../../src/shared/global-knowledge';

// 此处只验证工作区审核状态；AI 回执校验、Radix 键盘行为由各自组件测试覆盖。
vi.mock('../../src/renderer/components/select-field', () => ({ SelectField: ({ children, onChange, ...props }: ComponentProps<typeof SelectField>) =>
  <select value={props.value ?? ''} disabled={props.disabled} onChange={event => onChange?.({ target: event.target, currentTarget: event.currentTarget })}>{children}</select> }));
vi.mock('../../src/renderer/components/global-book-extraction-ai-panel', () => ({ GlobalBookExtractionAiPanel: ({ preview, library, onUse }: ComponentProps<typeof GlobalBookExtractionAiPanel>) =>
  <button onClick={() => onUse({ segmentId: preview.segments[0].id, excerpt: preview.segments[0].text,
    categoryId: library.categories[0].id, tagIds: [], technique: 'test手法', usage: 'test场景', exercise: 'test练习' })}>test带入已验证AI建议</button> }));
afterEach(cleanup);

function fixture() {
  const page: GlobalKnowledgePage = { libraryId: crypto.randomUUID(), revision: 1, entries: [], annotations: [], total: 0, offset: 0, limit: 20,
    categories: [{ id: crypto.randomUUID(), name: 'test未分类', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null },
      { id: crypto.randomUUID(), name: 'test人物', parentId: null, sortOrder: 1, systemKey: 'character', deletedAt: null }],
    tags: [{ id: crypto.randomUUID(), name: 'test雨', deletedAt: null }] };
  const preview: GlobalExtractionPreview = { target: { kind: 'global' }, token: crypto.randomUUID(), filename: 'test本地来源',
    fileHash: 'a'.repeat(64), format: 'paste', warnings: [], segments: [
      { id: crypto.randomUUID(), chapterTitle: 'test章', chapterIndex: 1, paragraphIndex: 1, text: 'test雨落在檐下。' },
    ] };
  type Api = ComponentProps<typeof GlobalBookExtractionWorkspace>['api'];
  const api: Api = { readGlobalExtractionDraft: vi.fn(async () => null), chooseGlobalBookExtraction: vi.fn(async () => preview),
    previewGlobalPastedExtraction: vi.fn(async () => preview), fetchGlobalWebExtraction: vi.fn(async () => preview),
    cancelGlobalWebExtraction: vi.fn(async () => {}), saveGlobalExtractionReview: vi.fn(async () => {}),
    confirmGlobalBookExtraction: vi.fn(async () => ({ ...page, revision: 2 })), cancelGlobalBookExtraction: vi.fn(async () => {}),
    discardGlobalExtractionDraft: vi.fn(async () => {}),
    getWebRenderCapability: vi.fn(async () => ({ enabled: true, policyVersion: 1 as const, message: 'test后台能力' })) };
  const onClose = vi.fn(), onCommitted = vi.fn(), onDirtyChange = vi.fn();
  function recovery(status: 'pending' | 'committed' = 'pending', metadata = true): GlobalExtractionRecovery {
    return { preview, page: { ...page, revision: 3 }, draft: { schemaVersion: 1, target: { kind: 'global' }, taskId: crypto.randomUUID(),
      previewToken: preview.token, batches: [], committing: null, source: { id: crypto.randomUUID(), kind: 'paste', hashVersion: 1,
        originalUrl: null, finalUrl: null, fetchedAt: null, title: preview.filename, rawHash: preview.fileHash, bodyHash: preview.fileHash,
        segments: preview.segments.map((segment, index) => ({ ...segment, ordinal: index + 1, textHash: preview.fileHash })) },
      reviews: [{ segmentId: preview.segments[0].id, body: preview.segments[0].text, categoryId: page.categories[0].id, tagIds: [], status }],
      ...(metadata ? { metadata: { sourceTitle: 'test恢复名', sourceAuthor: 'test恢复作者', chapter: 'test恢复章', rightsBasis: 'owned' as const,
        metrics: [{ label: 'test指标', value: '1', observedAt: '2026-10-15T10:06:37Z' }] } } : {}),
    } };
  }
  const mount = () => render(<LazyMotion features={domAnimation}><MotionConfig reducedMotion="always">
    <GlobalBookExtractionWorkspace page={page} api={api} onClose={onClose} onCommitted={onCommitted} onDirtyChange={onDirtyChange} />
  </MotionConfig></LazyMotion>);
  return { page, preview, api, onClose, onCommitted, onDirtyChange, recovery, mount };
}
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿并返回' })).toBeEnabled()); }
async function load() {
  await ready(); fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('region', { name: '全局摘选审核' });
}
function approve() {
  fireEvent.change(screen.getByRole('textbox', { name: '作者' }), { target: { value: 'test作者' } });
  fireEvent.change(screen.getByRole('textbox', { name: '章节' }), { target: { value: 'test章' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对作者/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' }));
}
async function replace() {
  fireEvent.click(screen.getByRole('button', { name: '更换素材' }));
  const dialog = await screen.findByRole('dialog', { name: '更换全局拆书素材？' });
  fireEvent.click(within(dialog).getByRole('button', { name: '更换素材' }));
}

it('保存草稿包含修改后的讲解、来源和待审状态，保存成功才返回', async () => {
  const test = fixture(); test.mount(); await load(); approve();
  fireEvent.change(screen.getByRole('textbox', { name: '写作手法' }), { target: { value: 'test修改讲解' } });
  fireEvent.change(screen.getByRole('textbox', { name: '来源作品名' }), { target: { value: 'test自有作品' } });
  fireEvent.change(screen.getByRole('combobox', { name: '使用依据' }), { target: { value: 'owned' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' }));
  await waitFor(() => expect(test.onClose).toHaveBeenCalledOnce());
  expect(test.api.saveGlobalExtractionReview).toHaveBeenCalledWith(expect.objectContaining({
    reviews: [expect.objectContaining({ status: 'pending', annotation: expect.objectContaining({ technique: 'test修改讲解' }) })],
    metadata: expect.objectContaining({ sourceTitle: 'test自有作品', rightsBasis: 'owned', metrics: [] }),
  }));
  expect(test.api.cancelGlobalBookExtraction).toHaveBeenCalledWith(test.preview.token);
  expect(test.onDirtyChange).toHaveBeenCalledWith(false);
  expect(test.api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it.each([new Error('test磁盘已满'), 'test未知存储异常'])('草稿保存失败保留原文和审核选择，不退出也不取消来源：%s', async failure => {
  const test = fixture(); vi.mocked(test.api.saveGlobalExtractionReview).mockRejectedValue(failure);
  test.mount(); await load(); approve(); fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof Error ? failure.message : '草稿保存失败，内容已保留。');
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).toBeChecked();
  expect(screen.getByRole('textbox', { name: '原句短摘录' })).toHaveValue(test.preview.segments[0].text);
  expect(test.onClose).not.toHaveBeenCalled(); expect(test.api.cancelGlobalBookExtraction).not.toHaveBeenCalled();
});

it('没有来源时直接返回，不创建空草稿', async () => {
  const test = fixture(); test.mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' }));
  await waitFor(() => expect(test.onClose).toHaveBeenCalledOnce());
  expect(test.api.saveGlobalExtractionReview).not.toHaveBeenCalled(); expect(test.api.cancelGlobalBookExtraction).not.toHaveBeenCalled();
});

it('未知回执核对后恢复已入库卡片和来源元数据，不允许再次入库', async () => {
  const test = fixture(); test.mount(); await load(); approve();
  vi.mocked(test.api.confirmGlobalBookExtraction).mockRejectedValue(new Error('test回执丢失'));
  fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  await screen.findByRole('alert');
  vi.mocked(test.api.readGlobalExtractionDraft).mockResolvedValue(test.recovery('committed'));
  fireEvent.click(screen.getByRole('button', { name: '核对入库回执' }));
  await waitFor(() => expect(test.onCommitted).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 })));
  expect(screen.getByRole('textbox', { name: '来源作品名' })).toHaveValue('test恢复名');
  expect(screen.getByRole('combobox', { name: '使用依据' })).toHaveValue('owned');
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '确认加入全局库（0）' })).toBeDisabled();
});

it.each([new Error('test恢复失败'), 'test恢复异常'])('初始草稿恢复失败时阻止新来源，核对回执可恢复工作区：%s', async failure => {
  const test = fixture(); vi.mocked(test.api.readGlobalExtractionDraft).mockRejectedValueOnce(failure);
  test.mount(); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: '选择 TXT / DOCX' })).toBeDisabled();
  vi.mocked(test.api.readGlobalExtractionDraft).mockResolvedValue(test.recovery('pending', false));
  fireEvent.click(screen.getByRole('button', { name: '核对入库回执' }));
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect(test.onCommitted).toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: '作者' })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: /我已核对作者/ })).not.toBeChecked();
});

it.each([new Error('test读取中断'), 'test读取异常'])('核对回执失败保留当前待审卡片：%s', async failure => {
  const test = fixture(); test.mount(); await load(); approve();
  vi.mocked(test.api.readGlobalExtractionDraft).mockRejectedValue(failure);
  fireEvent.click(screen.getByRole('button', { name: '核对入库回执' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof Error ? failure.message : '回执核对失败。');
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).toBeChecked();
  expect(test.api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it.each([new Error('test清理失败'), 'test清理异常'])('更换素材失败保留当前卡片，取消弹窗可继续审核：%s', async failure => {
  const test = fixture(); test.mount(); await load(); approve();
  vi.mocked(test.api.discardGlobalExtractionDraft).mockRejectedValue(failure);
  await replace(); await screen.findByRole('alert');
  const dialog = screen.getByRole('dialog', { name: '更换全局拆书素材？' });
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).toBeChecked();
  expect(test.onClose).not.toHaveBeenCalled();
});

it('普通粘贴来源只发送作者输入内容，没有首批来源指标且须手动审核', async () => {
  const test = fixture(); test.mount(); await ready();
  fireEvent.click(screen.getByRole('button', { name: '粘贴正文' }));
  fireEvent.change(screen.getByRole('textbox', { name: '素材标题' }), { target: { value: 'test原创素材' } });
  fireEvent.change(screen.getByRole('textbox', { name: '粘贴原文' }), { target: { value: test.preview.segments[0].text } });
  fireEvent.click(screen.getByRole('button', { name: '预览粘贴内容' }));
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect(test.api.previewGlobalPastedExtraction).toHaveBeenCalledWith({ title: 'test原创素材', text: test.preview.segments[0].text });
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' })); await waitFor(() => expect(test.onClose).toHaveBeenCalled());
  expect(test.api.saveGlobalExtractionReview).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ metrics: [] }) }));
});

it('选择文件取消后仍为空工作区，不创建审核或入库请求', async () => {
  const test = fixture(); vi.mocked(test.api.chooseGlobalBookExtraction).mockResolvedValue(null);
  test.mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' })); await ready();
  expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull(); expect(test.api.saveGlobalExtractionReview).not.toHaveBeenCalled();
});

it.each([new Error('test文件无法读取'), 'test读取错误'])('来源读取失败显示原因且不产生待审稿：%s', async failure => {
  const test = fixture(); vi.mocked(test.api.chooseGlobalBookExtraction).mockRejectedValue(failure);
  test.mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof Error ? failure.message : '素材读取失败。');
  expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull(); expect(test.api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it('网页请求可取消且不会污染后续本地素材', async () => {
  const test = fixture(); let reject!: (error: Error) => void;
  vi.mocked(test.api.fetchGlobalWebExtraction).mockImplementation(() => new Promise((_, failed) => { reject = failed; }));
  test.mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://example.org/test' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并预览' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消获取' }));
  expect(test.api.cancelGlobalWebExtraction).toHaveBeenCalledWith(expect.any(String));
  await act(async () => reject(new Error('test已取消'))); await ready();
  expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '本地文件' })); await load();
  expect(screen.getByRole('textbox', { name: '作者' })).toHaveValue('');
});

it('受限渲染须确认后才请求网页，预览保留可追溯地址', async () => {
  const test = fixture(); test.preview.source = { ...test.recovery().draft.source, id: crypto.randomUUID(), kind: 'web', title: 'test网页标题', originalUrl: 'https://example.org/test',
    finalUrl: 'https://example.org/article', fetchedAt: '2026-10-15T10:06:37Z' };
  test.mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://example.org/test' } });
  fireEvent.click(screen.getByRole('button', { name: '受限渲染' }));
  const dialog = await screen.findByRole('dialog', { name: '确认受限网页渲染' });
  expect(test.api.fetchGlobalWebExtraction).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认渲染' }));
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect(test.api.fetchGlobalWebExtraction).toHaveBeenCalledWith(expect.objectContaining({ mode: 'restricted-browser', url: 'https://example.org/test' }));
  expect(screen.getByRole('textbox', { name: '来源作品名' })).toHaveValue('test网页标题');
  expect(screen.getByText(/最终网址：/)).toHaveTextContent('https://example.org/article');
});

it('学习卡修改分类或标签均撤销审核，取消标签后保存空标签', async () => {
  const test = fixture(); test.mount(); await load(); approve();
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: test.page.categories[1].id } });
  const approval = screen.getByRole('checkbox', { name: '已逐字核对，审核入库' }); expect(approval).not.toBeChecked();
  fireEvent.click(approval); fireEvent.click(screen.getByRole('checkbox', { name: 'test雨' })); expect(approval).not.toBeChecked();
  fireEvent.click(approval); fireEvent.click(screen.getByRole('checkbox', { name: 'test雨' })); expect(approval).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' })); await waitFor(() => expect(test.onClose).toHaveBeenCalled());
  expect(test.api.saveGlobalExtractionReview).toHaveBeenCalledWith(expect.objectContaining({ reviews: [expect.objectContaining({
    categoryId: test.page.categories[1].id, tagIds: [], status: 'pending',
  })] }));
});

it('采纳已验证AI建议仅修改待审卡片，讲解仍需作者确认后入库', async () => {
  const test = fixture(); test.api.prepareGlobalBookExtractionAi = vi.fn(); test.api.executeGlobalBookExtractionAi = vi.fn();
  test.api.getGlobalBookExtractionAiResult = vi.fn(); test.api.cancelGlobalBookExtractionAi = vi.fn();
  test.mount(); await load(); approve(); fireEvent.click(screen.getByRole('button', { name: 'test带入已验证AI建议' }));
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).not.toBeChecked();
  expect(screen.getByRole('textbox', { name: '写作手法' })).toHaveValue('test手法');
  expect(test.api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it('已入库卡片拒绝再次带入AI建议', async () => {
  const test = fixture(); vi.mocked(test.api.readGlobalExtractionDraft).mockResolvedValue(test.recovery('committed'));
  test.api.prepareGlobalBookExtractionAi = vi.fn(); test.api.executeGlobalBookExtractionAi = vi.fn();
  test.api.getGlobalBookExtractionAiResult = vi.fn(); test.api.cancelGlobalBookExtractionAi = vi.fn();
  test.mount(); await screen.findByRole('region', { name: '全局摘选审核' });
  fireEvent.click(screen.getByRole('button', { name: 'test带入已验证AI建议' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('该段已经入库');
  expect(test.api.saveGlobalExtractionReview).not.toHaveBeenCalled();
});

it.each([new Error('test首批载入失败'), 'test首批异常'])('首批载入失败不自动审核或写入：%s', async failure => {
  const test = fixture(); vi.mocked(test.api.previewGlobalPastedExtraction).mockRejectedValue(failure);
  test.mount(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: '载入预览' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent(failure instanceof Error ? failure.message : '首批素材载入失败。');
  expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull(); expect(test.api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});
