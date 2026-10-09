// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
import { operationError } from '../../src/shared/operation-errors';
const adapters: ReturnType<typeof createStructureAdapter>[] = [];
const rangeMethods = ['getClientRects', 'getBoundingClientRect'] as const;
const rangeDescriptors = rangeMethods.map(name => Object.getOwnPropertyDescriptor(Range.prototype, name));
// jsdom 无布局引擎；只补齐定位命令依赖的几何接口，真实滚动由 Electron 验收。
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterEach(() => { cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose()); rangeMethods.forEach((name, index) => { if (rangeDescriptors[index]) Object.defineProperty(Range.prototype, name, rangeDescriptors[index]!); else Reflect.deleteProperty(Range.prototype, name); }); });
async function setup() {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  const work = await adapter.api.createWork('AI 保护验收');
  adapter.api.prepareAi = vi.fn(async () => ({ confirmationToken: 'test', requestHash: 'a'.repeat(64), expiresAt: Date.now() + 60000, service: '测试服务', model: 'test', scopeLabel: '本章', previewText: '原文', paragraphIds: [work.chapters[0].document.content[0].attrs.id], billingHint: '模拟', estimatedInputTokens: 10, maxOutputTokens: 20 }));
  adapter.api.executeAi = vi.fn(async () => ({ id: randomUUID(), operation: 'paragraphPolish' as const, workId: work.id, baselineRevision: work.revision, paragraphIds: [work.chapters[0].document.content[0].attrs.id], text: '新的候选正文', requestHash: 'a'.repeat(64), createdAt: new Date().toISOString() }));
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：AI 保护验收' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工具' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '确认云端 AI 操作' })).getByRole('button', { name: '确认发送' }));
  await screen.findByText('新的候选正文'); return adapter;
}
it('关闭工具后再次打开仍保留候选和对比状态', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: '关闭AI工具' }));
  await screen.findByLabelText('章节标题');
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工具' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }));
  await waitFor(() => expect(screen.getByText('新的候选正文')).toBeVisible());
});
it('版本明确冲突允许重新生成，回执未知保留原请求重试且不放开导航', async () => {
  const adapter = await setup();
  adapter.api.applyAiCandidate = vi.fn(async () => { throw operationError('原稿版本已变化', 'REVISION_CONFLICT'); });
  fireEvent.click(screen.getByRole('button', { name: '确认写入正文' }));
  await screen.findByText('原稿版本已变化');
  expect(screen.queryByRole('button', { name: '重试 AI 写入' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: '预览 AI 请求' })).toBeEnabled());
  adapter.api.applyAiCandidate = vi.fn(async () => { throw new Error('回执丢失'); });
  fireEvent.click(screen.getByRole('button', { name: '确认写入正文' }));
  await screen.findByRole('button', { name: '重试 AI 写入' });
  expect(screen.getByRole('button', { name: '关闭AI工具' })).toBeDisabled();
  await expect(adapter.close()).rejects.toThrow('操作结果');
});

it('写作入口只保留正文剧情伏笔，AI和版本在右上角按需打开', async () => {
  await setup();
  expect(screen.queryByRole('tab', { name: 'AI 助手' })).toBeNull();
  expect(screen.queryByRole('tab', { name: '版本快照' })).toBeNull();
  expect(screen.getByRole('tablist', { name: '作品工作区' })).toHaveTextContent('正文剧情架构伏笔架构');
});
it('AI跨章证据定位在一次保存门禁内关闭工具并打开目标章', async () => {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  let work = await adapter.api.createWork('跨章定位');
  work = await adapter.api.addChapter(work.id, '证据所在章', work.revision, randomUUID());
  const chapter = work.chapters[1];
  chapter.document.content[0].content = [{ type: 'text', text: '雨夜来信。' }];
  await adapter.api.saveChapter(work.id, chapter.id, chapter.title, chapter.document, work.revision, randomUUID());
  work = await adapter.api.openWork(work.id);
  adapter.api.prepareAi = vi.fn(async () => ({ confirmationToken: 'test', requestHash: 'a'.repeat(64), expiresAt: Date.now() + 60000, service: '测试服务', model: 'test', scopeLabel: '全卷', previewText: '原文', paragraphIds: [chapter.document.content[0].attrs.id], billingHint: '模拟', estimatedInputTokens: 10, maxOutputTokens: 20 }));
  adapter.api.executeAi = vi.fn(async () => ({ id: randomUUID(), operation: 'consistency' as const, workId: work.id, baselineRevision: work.revision, paragraphIds: [chapter.document.content[0].attrs.id], referenceChapterIds: work.chapters.map(item => item.id), requestHash: 'a'.repeat(64), createdAt: new Date().toISOString(),
    text: JSON.stringify({ findings: [{ dimension: '时间', message: '请核对乙章事件', uncertainty: '可能是倒叙', evidence: [{ chapterId: chapter.id, paragraphId: chapter.document.content[0].attrs.id, excerpt: '雨夜来信。' }] }] }) }));
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：跨章定位' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工具' })).toBeEnabled());
  fireEvent.click(await screen.findByRole('button', { name: 'AI 工具' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '确认云端 AI 操作' })).getByRole('button', { name: '确认发送' }));
  fireEvent.click(await screen.findByRole('button', { name: '定位正文证据' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('证据所在章'));
  expect(screen.queryByRole('dialog', { name: 'AI工具' })).toBeNull();
});
