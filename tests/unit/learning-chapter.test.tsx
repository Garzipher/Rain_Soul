// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningChapter } from '../../src/renderer/components/learning-chapter';
import type { Textbook } from '../../src/shared/textbook';

afterEach(cleanup);
const textbook: Textbook = { workId: 'course', chapters: [{ id: 'chapter', key: 'c1', title: '实验', markdown: '# 实验\n\n## 跟做\n\n```ts\nconst result = 1;\n```', images: {} }] };
describe('教材只显示图文与只读源文', () => {
  it('隐藏旧作者正文入口，切换源文通过保存门禁且不改作者数据', async () => {
    const changeMode = vi.fn(async (action: () => void) => { action(); return true; });
    render(<LearningChapter textbook={textbook} workId="course" chapterId="chapter" busy={false} changeMode={changeMode}><div>原作者笔记</div></LearningChapter>);
    expect(screen.getByRole('heading', { name: '实验' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '作者笔记' })).toBeNull();
    expect(screen.queryByText('原作者笔记')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 源文' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '教材 Markdown 源文' })).toHaveProperty('readOnly', true));
    fireEvent.click(screen.getByRole('button', { name: '图文阅读' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '实验' })).toBeTruthy());
    expect(changeMode).toHaveBeenCalledTimes(2);
  });
  it('门禁失败停留当前阅读方式，同名普通作品不被接管', async () => {
    const changeMode = vi.fn(async () => false);
    const { rerender } = render(<LearningChapter textbook={textbook} workId="course" chapterId="chapter" busy={false} changeMode={changeMode}><div>保留草稿</div></LearningChapter>);
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 源文' }));
    expect(screen.getByRole('article', { name: '教材正文' })).toBeTruthy();
    rerender(<LearningChapter textbook={textbook} workId="ordinary" chapterId="chapter" busy={false} changeMode={changeMode}><div>普通正文</div></LearningChapter>);
    expect(screen.getByText('普通正文')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '图文阅读' })).toBeNull();
  });
});
