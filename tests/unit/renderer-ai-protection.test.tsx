// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
import { operationError } from '../../src/shared/operation-errors';
const adapters: ReturnType<typeof createStructureAdapter>[] = [];
afterEach(() => { cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose()); });
async function setup() {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  const work = await adapter.api.createWork('AI 保护验收');
  adapter.api.prepareAi = vi.fn(async () => ({ confirmationToken: 'test', requestHash: 'a'.repeat(64), expiresAt: Date.now() + 60000, service: '测试服务', model: 'test', scopeLabel: '本章', previewText: '原文', paragraphIds: [work.chapters[0].document.content[0].attrs.id], billingHint: '模拟', estimatedInputTokens: 10, maxOutputTokens: 20 }));
  adapter.api.executeAi = vi.fn(async () => ({ id: randomUUID(), operation: 'paragraphPolish' as const, workId: work.id, baselineRevision: work.revision, paragraphIds: [work.chapters[0].document.content[0].attrs.id], text: '新的候选正文', requestHash: 'a'.repeat(64), createdAt: new Date().toISOString() }));
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '打开作品：AI 保护验收' }));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'AI 助手' })).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览 AI 请求' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发送' }));
  await screen.findByText('新的候选正文'); return adapter;
}
it('切换正文再返回 AI 保留候选和对比状态', async () => {
  await setup();
  fireEvent.click(screen.getByRole('tab', { name: '正文' }));
  await screen.findByLabelText('章节标题');
  await waitFor(() => expect(screen.getByRole('tab', { name: 'AI 助手' })).toBeEnabled());
  fireEvent.click(screen.getByRole('tab', { name: 'AI 助手' }));
  expect(await screen.findByText('新的候选正文')).toBeVisible();
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
  expect(screen.getByRole('tab', { name: '正文' })).toBeDisabled();
  await expect(adapter.close()).rejects.toThrow('操作结果');
});
