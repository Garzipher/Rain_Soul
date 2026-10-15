// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LazyMotion, domAnimation, MotionConfig } from 'motion/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { GlobalKnowledgeWorkspace } from '../../src/renderer/components/global-knowledge-workspace';
import { GlobalBookExtractionWorkspace } from '../../src/renderer/components/global-book-extraction-workspace';
import type { GlobalKnowledgePage, GlobalKnowledgeQuery } from '../../src/shared/global-knowledge';
import type { GlobalExtractionPreview } from '../../src/shared/global-book-extraction';
import { globalSourceStarters } from '../../src/shared/global-source-starter';
import type { AiPreparedRequest } from '../../src/shared/ai';

afterEach(cleanup);
function shell(children: ReactNode) {
  return <LazyMotion features={domAnimation}><MotionConfig reducedMotion="always">{children}</MotionConfig></LazyMotion>;
}
function library(): GlobalKnowledgePage {
  const categoryId = crypto.randomUUID();
  return { libraryId: crypto.randomUUID(), revision: 1, entries: [], categories: [
    { id: categoryId, name: 'test景物描写', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null },
  ], tags: [{ id: crypto.randomUUID(), name: 'test雨夜', deletedAt: null }, { id: crypto.randomUUID(), name: 'test声音', deletedAt: null }],
  annotations: [], total: 0, offset: 0, limit: 20 };
}
function extraction(extraSegments = 0) {
  const page = library();
  const preview: GlobalExtractionPreview = { target: { kind: 'global' }, token: crypto.randomUUID(), filename: 'test原稿',
    fileHash: 'a'.repeat(64), format: 'paste', warnings: [], segments: [
      { id: crypto.randomUUID(), chapterTitle: 'test第一章', chapterIndex: 1, paragraphIndex: 1, text: 'test雨落在屋檐上。' },
      ...Array.from({ length: extraSegments }, (_, index) => ({ id: crypto.randomUUID(), chapterTitle: 'test第一章', chapterIndex: 1,
        paragraphIndex: index + 2, text: `test未审核段落${index + 2}` })),
    ] };
  type Api = ComponentProps<typeof GlobalBookExtractionWorkspace>['api'];
  const api: Api = {
    readGlobalExtractionDraft: vi.fn(async () => null),
    chooseGlobalBookExtraction: vi.fn(async () => preview),
    previewGlobalPastedExtraction: vi.fn(async () => preview),
    fetchGlobalWebExtraction: vi.fn(async () => preview),
    cancelGlobalWebExtraction: vi.fn(async () => {}),
    saveGlobalExtractionReview: vi.fn(async () => {}),
    confirmGlobalBookExtraction: vi.fn(async () => ({ ...page, revision: 2 })),
    cancelGlobalBookExtraction: vi.fn(async () => {}),
    discardGlobalExtractionDraft: vi.fn(async () => {}),
  };
  const onCommitted = vi.fn(), onClose = vi.fn();
  const mount = () => render(shell(<GlobalBookExtractionWorkspace page={page} api={api} onCommitted={onCommitted} onClose={onClose} />));
  return { page, preview, api, onCommitted, onClose, mount };
}
async function loadFile() {
  const choose = screen.getByRole('button', { name: '选择 TXT / DOCX' });
  await waitFor(() => expect(choose).toHaveProperty('disabled', false));
  fireEvent.click(choose);
  await screen.findByRole('region', { name: '全局摘选审核' });
}
function approveFirst() {
  fireEvent.change(screen.getByRole('textbox', { name: '作者' }), { target: { value: 'test作者' } });
  fireEvent.change(screen.getByRole('textbox', { name: '章节' }), { target: { value: 'test第一章' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对作者/ }));
  fireEvent.click(screen.getAllByRole('checkbox', { name: '已逐字核对，审核入库' })[0]);
}

it('首批素材只载入待审预览；核对原句和权限后才请求加入全局知识库', async () => {
  const { preview, api, onCommitted, mount } = extraction();
  preview.segments[0].text = globalSourceStarters[0].excerpts[0].text;
  mount();
  const load = screen.getAllByRole('button', { name: '载入预览' })[0];
  await waitFor(() => expect(load).toHaveProperty('disabled', false));
  fireEvent.click(load);
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect(api.previewGlobalPastedExtraction).toHaveBeenCalledWith(expect.objectContaining({
    starterId: globalSourceStarters[0].id,
    source: expect.objectContaining({ author: expect.any(String), chapterUrl: expect.stringContaining('https://') }),
  }));
  expect(api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
  expect(api.saveGlobalExtractionReview).not.toHaveBeenCalled();
  expect(onCommitted).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '确认加入全局库（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对作者/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' }));
  fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 })));
  expect(api.confirmGlobalBookExtraction).toHaveBeenCalledTimes(1);
  expect(api.confirmGlobalBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ permissionConfirmed: true,
    items: [expect.objectContaining({ body: globalSourceStarters[0].excerpts[0].text })] }));
  expect(screen.getByRole('button', { name: '确认加入全局库（0）' })).toHaveProperty('disabled', true);
});

it('摘录改写后撤销审核，非原文连续文字不能再次通过审核', async () => {
  const { api, mount } = extraction(); mount(); await loadFile(); approveFirst();
  expect(screen.getByRole('button', { name: '确认加入全局库（1）' })).toHaveProperty('disabled', false);
  fireEvent.change(screen.getByRole('textbox', { name: '原句短摘录' }), { target: { value: 'test自行编造文字' } });
  const approval = screen.getByRole('checkbox', { name: '已逐字核对，审核入库' });
  expect(approval).toHaveProperty('checked', false);
  expect(approval).toHaveProperty('disabled', true);
  expect(api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it('入库回执未知时禁止重复请求，保留审核状态并允许核对回执', async () => {
  const { api, mount } = extraction();
  vi.mocked(api.confirmGlobalBookExtraction).mockRejectedValueOnce(new Error('test回执未知'));
  mount(); await loadFile(); approveFirst();
  fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'test回执未知');
  expect(screen.getByRole('button', { name: '确认加入全局库（1）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  expect(api.confirmGlobalBookExtraction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '核对入库回执' })).toHaveProperty('disabled', false);
});

it('拆书分页只展示本页 20 段，翻页后保留已审核选择', async () => {
  const { mount } = extraction(21); mount(); await loadFile(); approveFirst();
  const review = screen.getByRole('region', { name: '全局摘选审核' });
  expect(within(review).getAllByRole('textbox', { name: '原句短摘录' })).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(within(review).getAllByRole('textbox', { name: '原句短摘录' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  expect(within(review).getAllByRole('checkbox', { name: '已逐字核对，审核入库' })[0]).toHaveProperty('checked', true);
});

it('全局库标签组合保持多个 ID、筛选重置页码、分页和卡片原位展开', async () => {
  const page = library();
  page.total = 45;
  page.entries = [{ id: crypto.randomUUID(), body: 'test完整原句内容', source: 'test公开出处', categoryId: page.categories[0].id,
    tagIds: [], origin: null, revision: 1, deletedAt: null, reviewed: true, sourceDocumentId: null, segmentId: null }];
  const onQuery = vi.fn();
  function Harness() {
    const [query, setQuery] = useState<GlobalKnowledgeQuery>({ tagIds: [], limit: 20, offset: 20 });
    return <GlobalKnowledgeWorkspace page={page} query={query} busy={false} loading={false} error=""
      onQuery={next => { onQuery(next); setQuery(next); }} onAction={vi.fn(async () => true)} onExtract={vi.fn()}
      onSettings={vi.fn()} onRetry={vi.fn()} onDirtyChange={vi.fn()} />;
  }
  render(shell(<Harness />));
  fireEvent.click(screen.getByRole('button', { name: 'test雨夜' }));
  fireEvent.click(screen.getByRole('button', { name: 'test声音' }));
  expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ tagIds: page.tags.map(tag => tag.id), offset: 0 }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索全局知识' }), { target: { value: 'test雨' } });
  expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'test雨', offset: 0 }));
  const card = screen.getByRole('button', { name: 'test完整原句内容' });
  expect(card).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(card); expect(card).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(card); expect(card).toHaveAttribute('aria-expanded', 'false');
});

it('全局 AI 正在准备时禁止提交已审核摘录，不触发正式入库请求', async () => {
  const { api, mount } = extraction();
  let rejectPrepare!: (reason: Error) => void;
  api.prepareGlobalBookExtractionAi = vi.fn(() => new Promise<AiPreparedRequest>((_, reject) => { rejectPrepare = reject; }));
  api.executeGlobalBookExtractionAi = vi.fn();
  api.getGlobalBookExtractionAiResult = vi.fn();
  api.cancelGlobalBookExtractionAi = vi.fn(async () => {});
  mount(); await loadFile(); approveFirst();
  const selection = screen.getByRole('group', { name: '全局 AI 分析范围' });
  fireEvent.click(within(selection).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  await waitFor(() => expect(api.prepareGlobalBookExtractionAi).toHaveBeenCalledTimes(1));
  try {
    expect(screen.getByRole('button', { name: '确认加入全局库（1）' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
    expect(api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
  } finally {
    await act(async () => { rejectPrepare(new Error('test取消后台准备')); });
  }
  expect(screen.getByRole('button', { name: '确认加入全局库（1）' })).toBeEnabled();
});

it('首批素材的学习讲解和建议分类带入待审学习卡，仍不自动审核', async () => {
  const { page, preview, api, mount } = extraction();
  const starter = globalSourceStarters[0], excerpt = starter.excerpts[0];
  const category = { ...page.categories[0], id: crypto.randomUUID(), name: 'test叙事技巧', systemKey: excerpt.categoryKey };
  page.categories.push(category);
  preview.segments[0].text = excerpt.text;
  vi.mocked(api.previewGlobalPastedExtraction).mockResolvedValue(preview);
  mount();
  const load = screen.getAllByRole('button', { name: '载入预览' })[0];
  await waitFor(() => expect(load).toHaveProperty('disabled', false)); fireEvent.click(load);
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect.soft(screen.getByRole('textbox', { name: '写作手法' })).toHaveProperty('value', excerpt.annotation.technique);
  expect.soft(screen.getByRole('textbox', { name: '适用场景' })).toHaveProperty('value', excerpt.annotation.usage);
  expect.soft(screen.getByRole('textbox', { name: '仿写练习' })).toHaveProperty('value', excerpt.annotation.exercise);
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).toHaveProperty('checked', false);
  expect(within(screen.getByRole('region', { name: '全局摘选审核' })).getByRole('combobox', { name: '分类' })).toHaveTextContent('test叙事技巧');
  expect(api.confirmGlobalBookExtraction).not.toHaveBeenCalled();
});

it('更换首批来源为本地文件后清空旧来源互动指标，避免新来源继承旧口碑', async () => {
  const { api, mount } = extraction(); mount();
  const load = screen.getAllByRole('button', { name: '载入预览' })[0];
  await waitFor(() => expect(load).toHaveProperty('disabled', false)); fireEvent.click(load);
  await screen.findByRole('region', { name: '全局摘选审核' });
  fireEvent.click(screen.getByRole('button', { name: '更换素材' }));
  const dialog = await screen.findByRole('dialog', { name: '更换全局拆书素材？' });
  fireEvent.click(within(dialog).getByRole('button', { name: '更换素材' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull());
  await loadFile(); approveFirst();
  fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  await waitFor(() => expect(api.confirmGlobalBookExtraction).toHaveBeenCalled());
  expect(api.confirmGlobalBookExtraction).toHaveBeenLastCalledWith(expect.objectContaining({ metrics: [] }));
});

it.each(['正文不符', '段落坐标不符'])('首批素材%s时不带入其他摘录的学习讲解', async mismatch => {
  const { preview, mount } = extraction();
  const excerpt = globalSourceStarters[0].excerpts[0];
  preview.segments[0].text = mismatch === '正文不符' ? 'test非首批核实摘录' : excerpt.text;
  preview.segments[0].paragraphIndex = mismatch === '段落坐标不符' ? 99 : excerpt.paragraphIndex;
  mount();
  const load = screen.getAllByRole('button', { name: '载入预览' })[0];
  await waitFor(() => expect(load).toBeEnabled()); fireEvent.click(load);
  await screen.findByRole('region', { name: '全局摘选审核' });
  for (const field of ['写作手法', '适用场景', '仿写练习']) expect(screen.getByRole('textbox', { name: field })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: '已逐字核对，审核入库' })).not.toBeChecked();
});

it('恢复草稿保留其来源元数据，更换为新素材后重置使用依据和指标', async () => {
  const { page, preview, api, mount } = extraction();
  const metrics = [{ label: 'test收藏', value: '8', observedAt: '2026-10-15T10:06:37Z' }];
  vi.mocked(api.readGlobalExtractionDraft).mockResolvedValue({ preview, draft: {
    schemaVersion: 1, target: { kind: 'global' }, taskId: crypto.randomUUID(), previewToken: preview.token,
    source: { id: crypto.randomUUID(), kind: 'paste', hashVersion: 1, originalUrl: null, finalUrl: null, fetchedAt: null,
      title: preview.filename, rawHash: preview.fileHash, bodyHash: preview.fileHash,
      segments: preview.segments.map((segment, index) => ({ ...segment, ordinal: index + 1, textHash: preview.fileHash })) },
    batches: [], committing: null, reviews: [{ segmentId: preview.segments[0].id, body: preview.segments[0].text,
      categoryId: page.categories[0].id, tagIds: [], status: 'pending', annotation: { technique: '', usage: '', exercise: '' } }],
    metadata: { sourceTitle: 'test恢复来源', sourceAuthor: 'test恢复作者', chapter: 'test恢复章节', rightsBasis: 'open-license', metrics },
  } });
  mount();
  await screen.findByRole('region', { name: '全局摘选审核' });
  expect(screen.getByRole('textbox', { name: '来源作品名' })).toHaveValue('test恢复来源');
  expect(screen.getByRole('textbox', { name: '作者' })).toHaveValue('test恢复作者');
  expect(screen.getByRole('combobox', { name: '使用依据' })).toHaveTextContent('开放许可');
  fireEvent.click(screen.getByRole('button', { name: '更换素材' }));
  const dialog = await screen.findByRole('dialog', { name: '更换全局拆书素材？' });
  fireEvent.click(within(dialog).getByRole('button', { name: '更换素材' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '全局摘选审核' })).toBeNull());
  await loadFile();
  expect(screen.getByRole('textbox', { name: '作者' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: '章节' })).toHaveValue('');
  expect(screen.getByRole('combobox', { name: '使用依据' })).toHaveTextContent('官方公开阅读');
  expect(screen.getByRole('checkbox', { name: /我已核对作者/ })).not.toBeChecked();
  approveFirst(); fireEvent.click(screen.getByRole('button', { name: '确认加入全局库（1）' }));
  await waitFor(() => expect(api.confirmGlobalBookExtraction).toHaveBeenCalled());
  expect(api.confirmGlobalBookExtraction).toHaveBeenLastCalledWith(expect.objectContaining({ metrics: [], rightsBasis: 'public-excerpt' }));
});
