// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import App from '../../src/renderer/App';
import { createStructureAdapter } from './renderer-structure-adapter';
const adapters: ReturnType<typeof createStructureAdapter>[] = [];
afterEach(() => { cleanup(); adapters.splice(0).forEach(adapter => adapter.dispose()); });
it('手稿预览取消不新建，确认完整卷章导入，TXT/DOCX导出先保存正文', async () => {
  const adapter = createStructureAdapter(); adapters.push(adapter);
  adapter.api.chooseManuscript = async () => ({ token: crypto.randomUUID(), draft: { title: '手稿', format: 'txt', encoding: 'utf-8', warnings: [], chapters: [{ title: '第一章', volumeTitle: '第一卷', paragraphs: ['雨落下来。'] }] } });
  const exports: string[] = [];
  adapter.api.exportManuscript = async (id, format, snapshotId, mode) => { exports.push(`${format}:${mode}`); expect(snapshotId).toBeUndefined(); expect((await adapter.api.openWork(id)).chapters[0].title).toBe('修改后标题'); return true; };
  render(<App api={adapter.api} />);
  fireEvent.click(await screen.findByRole('button', { name: '导入手稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  expect(await adapter.api.listWorks()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '导入手稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '创建新作品' }));
  expect(await screen.findByLabelText('章节正文')).toHaveTextContent('雨落下来。');
  fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '修改后标题' } });
  fireEvent.click(screen.getByRole('button', { name: '导出正文净稿 DOCX' }));
  await waitFor(() => expect(exports).toEqual(['docx:clean']));
  await waitFor(() => expect(screen.getByRole('button', { name: '导出含创作资料 TXT' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '导出含创作资料 TXT' }));
  await waitFor(() => expect(exports).toEqual(['docx:clean', 'txt:full']));
  expect(screen.getByRole('group', { name: '分卷：第一卷' })).toBeInTheDocument();
});
