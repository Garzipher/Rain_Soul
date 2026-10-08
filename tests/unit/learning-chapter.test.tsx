// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningChapter } from '../../src/renderer/components/learning-chapter';
import type { Textbook } from '../../src/shared/textbook';

afterEach(cleanup);
const textbook: Textbook = { workId: 'course', chapters: [{ id: 'chapter', key: 'c1', title: '实验', markdown: '# 实验\n\n## 跟做\n\n```ts\nconst result = 1;\n```', images: {} }] };
describe('教材模式与笔记隔离', () => {
  it('默认阅读，源文只读，笔记必须通过保存门禁后显示，切回阅读不改笔记', async () => {
    const changeMode = vi.fn(async (action: () => void) => { action(); return true; });
    render(<LearningChapter textbook={textbook} workId="course" chapterId="chapter" busy={false} changeMode={changeMode}><div>原作者笔记</div></LearningChapter>);
    expect(screen.getByRole('heading', { name: '实验' })).toBeTruthy();
    expect(screen.queryByText('原作者笔记')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 源文' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '教材 Markdown 源文' })).toHaveProperty('readOnly', true));
    fireEvent.click(screen.getByRole('button', { name: '作者笔记' }));
    await waitFor(() => expect(screen.getByText('原作者笔记')).toBeTruthy());
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '图文阅读' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '实验' })).toBeTruthy());
    expect(changeMode).toHaveBeenCalledTimes(3);
  });
  it('门禁失败不会离开笔记；同名普通作品也不被接管', async () => {
    let allow = true;
    const changeMode = async (action: () => void) => { if (allow) action(); return allow; };
    const { rerender } = render(<LearningChapter textbook={textbook} workId="course" chapterId="chapter" busy={false} changeMode={changeMode}><div>保留草稿</div></LearningChapter>);
    fireEvent.click(screen.getByRole('button', { name: '作者笔记' }));
    await waitFor(() => expect(screen.getByText('保留草稿')).toBeTruthy());
    allow = false;
    fireEvent.click(screen.getByRole('button', { name: '图文阅读' }));
    await waitFor(() => expect(screen.getByText('保留草稿')).toBeTruthy());
    rerender(<LearningChapter textbook={textbook} workId="ordinary" chapterId="chapter" busy={false} changeMode={changeMode}><div>普通正文</div></LearningChapter>);
    expect(screen.getByText('普通正文')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '图文阅读' })).toBeNull();
  });
});
