// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssetState } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
import { PlotWorkspace } from '../../src/renderer/components/plot-workspace';
import { ForeshadowWorkspace } from '../../src/renderer/components/foreshadow-workspace';
import { StyleProfilePanel } from '../../src/renderer/components/style-profile-panel';

afterEach(cleanup);
const work: WorkDetail = { id: 'work', title: '雨落之后', revision: 1, volumes: [], deletedItems: [], chapters: [
  { id: 'chapter', title: '雨夜来信', wordCount: 2, volumeId: null, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: '来信' }] }] } },
] };
const assets: AssetState = { outlines: [
  { id: 'plot', title: '来信', type: 'chapter', parentId: null, summary: '', chapterId: null, knowledgeIds: [], sortOrder: 0, deletedAt: null },
  { id: 'other', title: '归途', type: 'chapter', parentId: null, summary: '', chapterId: null, knowledgeIds: [], sortOrder: 1, deletedAt: null },
], foreshadows: [{ id: 'hint', name: '旧地址', status: '已埋设', description: '', outlineId: 'other', deletedAt: null }], evidence: [
  { id: 'evidence', foreshadowId: 'hint', kind: '埋设', chapterId: 'gone', paragraphId: 'gone-paragraph', excerpt: '旧地址', sourceRevision: 1,
    originalSource: { chapterId: 'gone', chapterTitle: '原来信', paragraphId: 'gone-paragraph', excerpt: '旧地址', revision: 1 }, supersedesId: null, supersededBy: null, deletedAt: null, valid: false, invalidReason: '段落已删除' },
], categories: [], tags: [], knowledge: [{ id: 'knowledge', body: '雨幕中的灯光', source: '雨夜摘录', categoryId: 'c', tagIds: [], origin: null, revision: 1, deletedAt: null }], styleProfiles: [], chapterStyles: [], defaultStyleId: null };
const base = { work, assets, busy: false, onLocate: vi.fn() };

it('剧情关联伏笔可定位，节点脏草稿禁止定位而保留输入', () => {
  const onSelectForeshadow = vi.fn();
  render(<PlotWorkspace {...base} assets={{ ...assets, foreshadows: [{ ...assets.foreshadows[0], outlineId: 'plot' }] }} onAction={vi.fn(async () => true)} onSelectForeshadow={onSelectForeshadow} />);
  fireEvent.click(screen.getByRole('button', { name: '定位伏笔：旧地址' }));
  expect(onSelectForeshadow).toHaveBeenCalledWith('hint');
  fireEvent.change(screen.getByRole('textbox', { name: '剧情摘要' }), { target: { value: '保留草稿' } });
  expect(screen.getByRole('button', { name: '定位伏笔：旧地址' })).toHaveProperty('disabled', true);
});

it('外部定位明确选择目标伏笔，不默认回到列表首项', () => {
  const two = { ...assets, foreshadows: [...assets.foreshadows, { ...assets.foreshadows[0], id: 'second', name: '新地址', description: '目标内容' }] };
  render(<ForeshadowWorkspace {...base} assets={two} selectedId="second" onAction={vi.fn(async () => true)} />);
  expect(screen.getByRole('textbox', { name: '伏笔名称' })).toHaveProperty('value', '新地址');
  expect(screen.getByRole('textbox', { name: '伏笔说明' })).toHaveProperty('value', '目标内容');
});

it('剧情保存失败保留输入，未保存时阻止切换，取消修改后才能切换', async () => {
  const onAction = vi.fn(async () => false);
  render(<PlotWorkspace {...base} onAction={onAction} />);
  fireEvent.change(screen.getByRole('textbox', { name: '节点名称' }), { target: { value: '雨夜来信' } });
  fireEvent.click(screen.getByRole('button', { name: '选择剧情：归途' }));
  expect(screen.getByRole('textbox', { name: '节点名称' })).toHaveProperty('value', '雨夜来信');
  fireEvent.click(screen.getByRole('button', { name: '保存剧情' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'updateOutline', id: 'plot', title: '雨夜来信', summary: '', chapterId: null }));
  expect(screen.getByRole('textbox', { name: '节点名称' })).toHaveProperty('value', '雨夜来信');
  expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('失败'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  fireEvent.click(screen.getByRole('button', { name: '选择剧情：归途' }));
  expect(screen.getByRole('textbox', { name: '节点名称' })).toHaveProperty('value', '归途');
});

it('剧情知识勾选与移除同步，伏笔先显示原归属再确认迁移，失败回滚', async () => {
  let succeed = true;
  const onAction = vi.fn(async () => succeed);
  render(<PlotWorkspace {...base} onAction={onAction} />);
  fireEvent.click(screen.getByText('关联知识'));
  const knowledge = screen.getByRole('checkbox', { name: /雨幕中的灯光/ });
  fireEvent.click(knowledge);
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'setOutlineKnowledge', id: 'plot', knowledgeIds: ['knowledge'] }));
  expect(knowledge).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '移除知识：雨幕中的灯光' }));
  await waitFor(() => expect(knowledge).toHaveProperty('checked', false));
  fireEvent.click(screen.getByText('关联伏笔'));
  const hint = screen.getByRole('checkbox', { name: /旧地址.*归途.*勾选后移到本节点/ });
  succeed = false;
  fireEvent.click(hint);
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'assignForeshadows', id: 'plot', foreshadowIds: ['hint'] }));
  await waitFor(() => expect(hint).toHaveProperty('checked', false));
});

it('删除剧情需要确认，取消不发送动作', () => {
  const onAction = vi.fn(async () => true);
  render(<PlotWorkspace {...base} onAction={onAction} />);
  fireEvent.click(screen.getByRole('button', { name: '删除剧情' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(onAction).not.toHaveBeenCalled();
});

it('失效伏笔证据保留原出处且禁止定位，重新关联使用明确新来源', async () => {
  const onAction = vi.fn(async () => true);
  const onDirtyChange = vi.fn();
  const view = render(<ForeshadowWorkspace {...base} onAction={onAction} onDirtyChange={onDirtyChange} />);
  expect(screen.getByText(/原出处：原来信/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '定位证据：旧地址' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '重新关联证据：旧地址' }));
  fireEvent.change(screen.getByRole('combobox', { name: '证据章节' }), { target: { value: 'chapter' } });
  fireEvent.change(screen.getByRole('combobox', { name: '证据段落' }), { target: { value: 'paragraph' } });
  fireEvent.change(screen.getByRole('textbox', { name: '证据摘录' }), { target: { value: '来信' } });
  fireEvent.click(screen.getByRole('button', { name: '确认重新关联' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'relinkEvidence', id: 'evidence', chapterId: 'chapter', paragraphId: 'paragraph', excerpt: '来信' }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  const previous = assets.evidence[0];
  const relinked = { ...assets, evidence: [
    { ...previous, supersededBy: 'new-evidence' },
    { ...previous, id: 'new-evidence', chapterId: 'chapter', paragraphId: 'paragraph', excerpt: '来信', sourceRevision: 2, supersedesId: previous.id, valid: true, invalidReason: null },
  ] };
  view.rerender(<ForeshadowWorkspace {...base} assets={relinked} onAction={onAction} onDirtyChange={onDirtyChange} />);
  expect(screen.getByText(/原出处：原来信.*gone-paragraph/)).toBeTruthy();
  expect(screen.getByText('原出处摘录：旧地址')).toBeTruthy();
  expect(screen.getByText(/当前来源：雨夜来信.*版本 2/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '定位证据：来信' })).toHaveProperty('disabled', false);
});

it('证据表单未保存时向伏笔工作区报告脏状态并阻止切换', () => {
  const onDirtyChange = vi.fn();
  const twoForeshadows = { ...assets, foreshadows: [...assets.foreshadows, { id: 'second', name: '迟来的信', status: '未埋设' as const, description: '', outlineId: null, deletedAt: null }] };
  render(<ForeshadowWorkspace {...base} assets={twoForeshadows} onAction={vi.fn(async () => true)} onDirtyChange={onDirtyChange} />);
  fireEvent.change(screen.getByRole('combobox', { name: '证据章节' }), { target: { value: 'chapter' } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '选择伏笔：迟来的信' }));
  expect(screen.getByRole('button', { name: '添加证据' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('切换伏笔');
});

it('伏笔详情与证据脏状态统一汇总，放弃其中一份表单仍保留另一份保护', async () => {
  const onDirtyChange = vi.fn();
  render(<ForeshadowWorkspace {...base} onAction={vi.fn(async () => true)} onDirtyChange={onDirtyChange} />);
  fireEvent.change(screen.getByRole('combobox', { name: '证据章节' }), { target: { value: 'chapter' } });
  fireEvent.change(screen.getByRole('textbox', { name: '伏笔说明' }), { target: { value: '待保存说明' } });
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃证据更改' }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

it('证据重关联待处理时持续保护父层，失败后保留输入直到作者放弃', async () => {
  const onDirtyChange = vi.fn();
  let finish!: (success: boolean) => void;
  const onAction = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  render(<ForeshadowWorkspace {...base} onAction={onAction} onDirtyChange={onDirtyChange} />);
  fireEvent.click(screen.getByRole('button', { name: '重新关联证据：旧地址' }));
  fireEvent.change(screen.getByRole('combobox', { name: '证据章节' }), { target: { value: 'chapter' } });
  fireEvent.click(screen.getByRole('button', { name: '确认重新关联' }));
  expect(screen.getByRole('button', { name: '确认重新关联' })).toHaveProperty('disabled', true);
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  finish(false);
  await waitFor(() => expect(screen.getByRole('button', { name: '确认重新关联' })).toHaveProperty('disabled', false));
  expect(screen.getByRole('combobox', { name: '证据章节' })).toHaveProperty('value', 'chapter');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃证据更改' }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

it('章节级原出处明确标注证据粒度', () => {
  const chapterSource = { ...assets, evidence: [{ ...assets.evidence[0], originalSource: { ...assets.evidence[0].originalSource, paragraphId: null } }] };
  render(<ForeshadowWorkspace {...base} assets={chapterSource} onAction={vi.fn(async () => true)} />);
  expect(screen.getByText(/原出处：原来信.*章节证据/)).toBeTruthy();
});

it('伏笔归属可定位同作品剧情节点，dirty表单不触发跳转，父层可见dirty状态', async () => {
  const onDirtyChange = vi.fn();
  const onSelectOutline = vi.fn();
  const onAction = vi.fn(async () => true);
  render(<ForeshadowWorkspace {...base} onAction={onAction} onDirtyChange={onDirtyChange} onSelectOutline={onSelectOutline} />);
  fireEvent.click(screen.getByRole('button', { name: '定位剧情节点' }));
  expect(onSelectOutline).toHaveBeenCalledWith('other');
  fireEvent.change(screen.getByRole('textbox', { name: '伏笔说明' }), { target: { value: '新增说明' } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '定位剧情节点' }));
  expect(onSelectOutline).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

it('写作特点发布失败保留表单，章节可以明确恢复作品默认', async () => {
  const onAction = vi.fn(async () => false);
  const styled = { ...assets, styleProfiles: [{ id: 'style', version: 1, createdAt: '2026-10-08', payload: { narrativePerson: '第三人称', pace: '缓慢', prohibited: ['套话'], referenceWorks: [] } }], defaultStyleId: 'style', chapterStyles: [{ chapterId: 'chapter', profileId: 'style' }] };
  render(<StyleProfilePanel {...base} assets={styled} onAction={onAction} />);
  fireEvent.change(screen.getByRole('textbox', { name: '节奏' }), { target: { value: '紧凑' } });
  fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'publishStyle', payload: { narrativePerson: '第三人称', pace: '紧凑', prohibited: ['套话'], referenceWorks: [] } }));
  expect(screen.getByRole('textbox', { name: '节奏' })).toHaveProperty('value', '紧凑');
  fireEvent.change(screen.getByRole('combobox', { name: '雨夜来信写作特点' }), { target: { value: '' } });
  await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'setChapterStyle', chapterId: 'chapter', profileId: null }));
});
