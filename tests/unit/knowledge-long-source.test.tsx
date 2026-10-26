// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '../../src/renderer/components/knowledge-workspace';
import type { AssetState } from '../../src/shared/assets';
afterEach(cleanup);
it('长出处默认简洁、校验信息展开后完整呈现，操作区保留不压缩及换行规则', async () => {
  const source = '《雨夜》／作者：原作者；参考.txt；第1章 第2段；文件 SHA-256：' + 'a'.repeat(64) + '；段落 SHA-256：' + 'b'.repeat(64);
  const body = '雨落在窗台。\n灯光透过轻薄的雾。';
  const assets: AssetState = { categories: [], tags: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
    knowledge: [{ id: 'entry', body, source, categoryId: 'cat', tagIds: [], revision: 1, origin: null, deletedAt: null }] };
  render(<KnowledgeWorkspace work={{ id: 'work', title: '雨夜', revision: 1, chapters: [], volumes: [], deletedItems: [] }} assets={assets} busy={false} onAction={vi.fn(async () => true)} onSearch={vi.fn(async () => [])} onLocate={vi.fn()} />);
  const card = screen.getByRole('article');
  expect(within(card).getByText('《雨夜》／作者：原作者；参考.txt；第1章 第2段')).toBeTruthy();
  expect(within(card).queryByText(source)).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: /^展开知识/ }));
  expect(within(card).getByRole('button', { name: /^收起知识/ })).toHaveProperty('textContent', body);
  const verification = within(card).getByText('来源校验详情').closest('details')!;
  verification.open = true; fireEvent(verification, new Event('toggle'));
  await waitFor(() => expect(within(card).getByText(source)).toBeTruthy());
  fireEvent.click(within(card).getByLabelText(/^知识操作：/));
  expect(within(card).getByRole('button', { name: '编辑知识' })).toBeTruthy();
  const css = readFileSync('src/renderer/components/knowledge-workspace.css', 'utf-8');
  expect(css).toMatch(/\.knowledge-source\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*min-width:\s*0/s);
  expect(css).toMatch(/\.knowledge-entry-actions\s*\{[^}]*flex-shrink:\s*0/s);
  expect(css).toMatch(/\.knowledge-entry-bottom button\s*\{[^}]*white-space:\s*nowrap/s);
});
