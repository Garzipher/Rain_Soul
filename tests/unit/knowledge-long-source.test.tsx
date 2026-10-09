// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '../../src/renderer/components/knowledge-workspace';
import type { AssetState } from '../../src/shared/assets';
afterEach(cleanup);
it('两个真实SHA长出处完整呈现、原位展开，操作区保留不压缩及换行规则', () => {
  const source = '《雨夜》／作者：原作者；参考.txt；第1章 第2段；文件 SHA-256：' + 'a'.repeat(64) + '；段落 SHA-256：' + 'b'.repeat(64);
  const body = '雨落在窗台。\n灯光透过轻薄的雾。';
  const assets: AssetState = { categories: [], tags: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
    knowledge: [{ id: 'entry', body, source, categoryId: 'cat', tagIds: [], revision: 1, origin: null, deletedAt: null }] };
  render(<KnowledgeWorkspace work={{ id: 'work', title: '雨夜', revision: 1, chapters: [], volumes: [], deletedItems: [] }} assets={assets} busy={false} onAction={vi.fn(async () => true)} onSearch={vi.fn(async () => [])} onLocate={vi.fn()} />);
  const card = screen.getByRole('article');
  expect(within(card).getByText(source)).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: /^展开知识/ }));
  expect(within(card).getByRole('button', { name: /^收起知识/ })).toHaveProperty('textContent', body);
  expect(within(card).getByRole('button', { name: '编辑知识' })).toBeTruthy();
  const css = readFileSync('src/renderer/components/knowledge-workspace.css', 'utf-8');
  expect(css).toMatch(/\.knowledge-entry-bottom\s*\{[^}]*flex-wrap:\s*wrap/s);
  expect(css).toMatch(/\.knowledge-entry-bottom\s*>\s*div:first-child\s*\{[^}]*flex-shrink:\s*0/s);
  expect(css).toMatch(/\.knowledge-entry-bottom button\s*\{[^}]*white-space:\s*nowrap/s);
});
