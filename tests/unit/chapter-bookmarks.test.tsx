// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { chooseSelect } from './select-field-helper';
import { afterEach, expect, it, vi } from 'vitest';
import { BookmarkDetails } from '../../src/renderer/components/inline-bookmark';
import { ChapterEditor } from '../../src/renderer/components/chapter-editor';
import { emptyDocument, countDocumentWords, validateDocument } from '../../src/shared/document';
import type { AssetState } from '../../src/shared/assets';
import { auditedKnowledgeSource } from './knowledge-source-helper';
afterEach(cleanup);
it('知识书签详情仅展示可读出处，不向正文读者展开审计材料', async () => {
  const state = assets(), doc = emptyDocument(); state.knowledge[0].source = auditedKnowledgeSource('写作练习').source;
  doc.content[0].content = [{ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: state.knowledge[0].id } }];
  render(<ChapterEditor document={doc} assets={state} locked={false} onChange={vi.fn()} onError={vi.fn()} onCompositionChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '知识书签：雨打旧站台。' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('出处：写作练习');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('上下文独有秘词');
});
it.each(['knowledge', 'foreshadow'] as const)('正文 %s 书签可直接定位真实关联，已删除对象禁止定位', async kind => {
  const state = assets(), doc = emptyDocument(), onLocateAsset = vi.fn();
  const targetId = kind === 'knowledge' ? state.knowledge[0].id : state.foreshadows[0].id;
  doc.content[0].content = [{ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind, targetId } }];
  const props = { document: doc, assets: state, locked: false, onChange: vi.fn(), onError: vi.fn(), onCompositionChange: vi.fn(), onLocateAsset };
  const view = render(<ChapterEditor {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: kind === 'knowledge' ? '知识书签：雨打旧站台。' : '伏笔书签：未寄出的信' }));
  const name = kind === 'knowledge' ? '定位知识条目' : '定位伏笔架构';
  fireEvent.click(screen.getByRole('button', { name }));
  expect(onLocateAsset).toHaveBeenCalledWith(kind, targetId);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  if (kind === 'knowledge') state.knowledge[0].deletedAt = '2026-10-09'; else state.foreshadows[0].deletedAt = '2026-10-09';
  view.rerender(<ChapterEditor {...props} assets={structuredClone(state)} />);
  fireEvent.click(await screen.findByRole('button', { name: kind === 'knowledge' ? '知识书签：已删除条目' : '伏笔书签：已删除伏笔' }));
  expect(screen.getByRole('button', { name })).toBeDisabled();
});
it.each(['Enter', ' '])('书签通过键盘 %s 打开详情且不修改正文', async key => {
  const state = assets(), doc = emptyDocument();
  doc.content[0].content = [{ type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'knowledge', targetId: state.knowledge[0].id } }];
  const onChange = vi.fn();
  render(<ChapterEditor document={doc} assets={state} locked={false} onChange={onChange} onError={vi.fn()} onCompositionChange={vi.fn()} />);
  const marker = await screen.findByRole('button', { name: '知识书签：雨打旧站台。' }); marker.focus();
  fireEvent.keyDown(marker, { key });
  expect(screen.getByRole('dialog')).toHaveTextContent('写作练习'); expect(onChange).not.toHaveBeenCalled();
});
function assets(): AssetState { return { outlines: [], foreshadows: [{ id: crypto.randomUUID(), name: '未寄出的信', description: '回收旧信', status: '未埋设', outlineId: null, deletedAt: null }], evidence: [], categories: [], tags: [], knowledge: [{ id: crypto.randomUUID(), body: '雨打旧站台。', source: '写作练习', categoryId: crypto.randomUUID(), tagIds: [], origin: null, revision: 1, deletedAt: null }], styleProfiles: [], chapterStyles: [], defaultStyleId: null }; }
it('光标处插入可点击知识书签，持久化关联不计字数；详情实时跟随编辑及删除', async () => {
  const state = assets(), doc = emptyDocument();
  doc.content[0].content = [{ type: 'text', text: '雨夜ABC' }];
  const onChange = vi.fn(), onError = vi.fn();
  const props = { document: doc, assets: state, locked: false, onChange, onError, onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '插入书签' }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  const saved = validateDocument(onChange.mock.calls.at(-1)![0]);
  expect(countDocumentWords(saved)).toBe(5);
  const node = saved.content[0].content?.find(item => item.type === 'bookmark');
  expect(node).toMatchObject({ type: 'bookmark', attrs: { kind: 'knowledge', targetId: state.knowledge[0].id } });
  fireEvent.click(screen.getByRole('button', { name: '知识书签：雨打旧站台。' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('写作练习');
  const updated = structuredClone(state); updated.knowledge[0].body = '更新后的知识全文。';
  view.rerender(<ChapterEditor {...props} assets={updated} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('更新后的知识全文。');
  updated.knowledge[0].deletedAt = new Date().toISOString();
  view.rerender(<ChapterEditor {...props} assets={structuredClone(updated)} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('已删除条目');
  expect(screen.getByRole('dialog')).toHaveTextContent(state.knowledge[0].id);
  fireEvent.click(screen.getByRole('button', { name: '关闭书签详情' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onError).not.toHaveBeenCalled();
});
it('伏笔书签只关联目标，不制造埋设或回收证据；锁定时禁止插入', async () => {
  const state = assets(), onChange = vi.fn();
  const props = { document: emptyDocument(), assets: state, locked: false, onChange, onError: vi.fn(), onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  fireEvent.click(screen.getByText('引用与伏笔书签'));
  await chooseSelect(screen.getByLabelText('书签类型'), '伏笔标记');
  fireEvent.click(screen.getByRole('button', { name: '插入书签' }));
  fireEvent.click(await screen.findByRole('button', { name: '伏笔书签：未寄出的信' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('未埋设');
  expect(state.evidence).toEqual([]);
  expect(validateDocument(onChange.mock.calls.at(-1)![0]).content[0].content).toMatchObject([{ type: 'bookmark', attrs: { kind: 'foreshadow', targetId: state.foreshadows[0].id } }]);
  view.rerender(<ChapterEditor {...props} locked />);
  expect(screen.getByRole('button', { name: '插入书签' })).toBeDisabled();
});


it('伏笔书签详情与一致性规则同步提示正文摘录失配，不更改伏笔状态', () => {
  const state = assets(), doc = emptyDocument();
  doc.content[0].content = [{ type: 'text', text: '半张红船票' }];
  state.foreshadows[0].status = '已埋设';
  state.evidence.push({ id: 'evidence', foreshadowId: state.foreshadows[0].id, kind: '埋设', chapterId: 'chapter', paragraphId: doc.content[0].attrs.id, excerpt: '半张蓝船票', sourceRevision: 1, originalSource: { chapterId: 'chapter', chapterTitle: '第一章', paragraphId: doc.content[0].attrs.id, excerpt: '半张蓝船票', revision: 1 }, valid: true, invalidReason: null, deletedAt: null, supersedesId: null, supersededBy: null });
  render(<BookmarkDetails bookmark={{ id: 'bookmark', kind: 'foreshadow', targetId: state.foreshadows[0].id }} assets={state} chapters={[{ id: 'chapter', title: '第一章', document: doc, wordCount: 6, volumeId: null }]} onClose={vi.fn()} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('证据需复核');
  expect(screen.getByRole('dialog')).toHaveTextContent('证据摘录已不在当前正文中');
  expect(screen.getByRole('dialog')).toHaveTextContent('已埋设');
});

it('正文书签跟随当前草稿显示复核标记，打开详情仍保留原证据', async () => {
  const state = assets(), doc = emptyDocument();
  const hintId = state.foreshadows[0].id, paragraphId = doc.content[0].attrs.id;
  state.foreshadows[0].status = '已埋设';
  doc.content[0].content = [{ type: 'text', text: '半张蓝船票' }, { type: 'bookmark', attrs: { id: crypto.randomUUID(), kind: 'foreshadow', targetId: hintId } }];
  state.evidence.push({ id: 'evidence', foreshadowId: hintId, kind: '埋设', chapterId: 'chapter', paragraphId, excerpt: '半张蓝船票', sourceRevision: 1, originalSource: { chapterId: 'chapter', chapterTitle: '第一章', paragraphId, excerpt: '半张蓝船票', revision: 1 }, valid: true, invalidReason: null, deletedAt: null, supersedesId: null, supersededBy: null });
  const chapter = { id: 'chapter', title: '第一章', document: doc, wordCount: 6, volumeId: null };
  const props = { document: doc, chapters: [chapter], assets: state, locked: false, onChange: vi.fn(), onError: vi.fn(), onCompositionChange: vi.fn() };
  const view = render(<ChapterEditor {...props} />);
  expect(await screen.findByRole('button', { name: '伏笔书签：未寄出的信' })).not.toHaveTextContent('需复核');
  const revised = structuredClone(doc); revised.content[0].content![0] = { type: 'text', text: '半张红船票' };
  view.rerender(<ChapterEditor {...props} document={revised} chapters={[{ ...chapter, document: revised }]} />);
  const marker = await screen.findByRole('button', { name: '伏笔书签：未寄出的信 · 证据需复核' });
  expect(marker).toHaveTextContent('需复核');
  fireEvent.click(marker);
  expect(screen.getByRole('dialog')).toHaveTextContent('证据摘录已不在当前正文中');
  expect(state.evidence[0].excerpt).toBe('半张蓝船票');
  expect(state.foreshadows[0].status).toBe('已埋设');
});
