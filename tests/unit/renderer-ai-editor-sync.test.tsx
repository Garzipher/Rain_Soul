// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Editor } from '@tiptap/core';
import App from '../../src/renderer/App';
import type { AiCandidate } from '../../src/shared/ai';
import { WorkRepository } from '../../src/workers/database/repository';
import { createStructureAdapter } from './renderer-structure-adapter';

const adapters: ReturnType<typeof createStructureAdapter>[] = [];
const rangeMethods = ['getClientRects', 'getBoundingClientRect'] as const;
const rangeDescriptors = rangeMethods.map(name => Object.getOwnPropertyDescriptor(Range.prototype, name));
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterEach(() => {
  cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose());
  rangeMethods.forEach((name, index) => { if (rangeDescriptors[index]) Object.defineProperty(Range.prototype, name, rangeDescriptors[index]!); else Reflect.deleteProperty(Range.prototype, name); });
});

it('真实AI写入回执同步同章编辑器，直接继续写作自动落盘后切章再返回仍保留候选', async () => {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  let work = await adapter.api.createWork('test AI 连续写作回归');
  work = await adapter.api.addChapter(work.id, '第二章', work.revision, randomUUID());
  const first = work.chapters[0];
  first.document.content[0].content = [{ type: 'text', text: '雨已经停了，候船室里先亮起了一点光。' }];
  await adapter.api.saveChapter(work.id, first.id, first.title, first.document, work.revision, randomUUID());
  work = await adapter.api.openWork(work.id);
  const candidate: AiCandidate = { id: randomUUID(), operation: 'paragraphPolish', workId: work.id, baselineRevision: work.revision,
    paragraphIds: [first.document.content[0].attrs.id], text: '雨停了，候船室先亮起一点光。', requestHash: 'a'.repeat(64), createdAt: new Date().toISOString() };
  adapter.api.prepareAi = vi.fn(async () => ({ confirmationToken: 'test', requestHash: candidate.requestHash, expiresAt: Date.now() + 60000, service: '离线测试替身', model: 'test', scopeLabel: '本章', previewText: '原创原文', paragraphIds: candidate.paragraphIds, billingHint: '零网络', estimatedInputTokens: 10, maxOutputTokens: 20 }));
  adapter.api.executeAi = vi.fn(async () => candidate);
  adapter.api.applyAiCandidate = vi.fn(async request => {
    // 仅替代 IPC 传输；采用、保护快照和正文持久化运行真实仓库事务。
    const repository = new WorkRepository((await adapter.api.getRuntimeInfo!()).dataDirectory);
    try { return repository.applyAi(candidate, request.operationId); } finally { repository.close(); }
  });
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：test AI 连续写作回归' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工具' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '确认云端 AI 操作' })).getByRole('button', { name: '确认发送' }));
  await screen.findByText(candidate.text, { selector: 'pre[aria-label="候选全文"]' });
  fireEvent.click(screen.getByRole('button', { name: '确认写入正文' }));
  await screen.findByText('候选已确认写入，原文版本由快照保留。');
  expect((await adapter.api.openWork(work.id)).chapters[0].document.content[0].content).toEqual([{ type: 'text', text: candidate.text }]);
  expect(await adapter.api.listSnapshots(work.id)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '关闭AI工具' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI 工具' })).toBeEnabled());
  const textbox = screen.getByRole('textbox', { name: '章节正文' }) as HTMLElement & { editor: Editor };
  const adoptedEditor = textbox.editor;
  // 不靠切章/重新挂载刷新，立即在刚采用结果的同一编辑器追加输入。
  act(() => { adoptedEditor.commands.insertContentAt(adoptedEditor.state.doc.content.size - 1, '她听见水声。'); });
  const expected = candidate.text + '她听见水声。';
  await waitFor(async () => expect((await adapter.api.openWork(work.id)).chapters[0].document.content[0].content).toEqual([{ type: 'text', text: expected }]));
  expect(textbox).toHaveTextContent(expected);
  fireEvent.click(screen.getByRole('button', { name: '打开章节：第二章' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '章节标题' })).toHaveValue('第二章'));
  await waitFor(() => expect(screen.getByRole('button', { name: `打开章节：${first.title}` })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: `打开章节：${first.title}` }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '章节正文' })).toHaveTextContent(expected));
}, 30000);
