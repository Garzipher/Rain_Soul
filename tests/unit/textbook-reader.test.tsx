// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TextbookReader } from '../../src/renderer/components/textbook-reader';
import type { TextbookChapter } from '../../src/shared/textbook';

afterEach(cleanup);
const chapter: TextbookChapter = { id: 'lesson', key: 'lesson/01', title: '完整实验', images: {
  'images/screen.png': '/learning/abc.png',
}, markdown: '# 完整实验\n\n## 实验目标\n\n阅读说明。\n\n```ts\nconst count = 1;\n```\n\n|动作|结果|\n|---|---|\n|启动|显示作品集|\n\n![图1：作品集运行结果](images/screen.png)\n\n## 跟做步骤\n\n1. 启动程序\n2. 创建作品\n\n## 实验目标\n\n复习。' };

describe('教材图文阅读', () => {
  it('显示标题、代码高亮、表格、截图图注与去重章节目录', () => {
    const { container } = render(<TextbookReader chapter={chapter} />);
    expect(screen.getByRole('heading', { name: '完整实验', level: 1 })).toBeTruthy();
    expect(container.querySelector('pre code.language-ts')).toHaveProperty('textContent', 'const count = 1;\n');
    expect(container.querySelector('code .hljs-keyword')).toHaveProperty('textContent', 'const');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('img', { name: '图1：作品集运行结果' }).getAttribute('src')).toBe('/learning/abc.png');
    expect(container.querySelector('figcaption')?.textContent).toBe('图1：作品集运行结果');
    const nav = screen.getByRole('navigation', { name: '本章目录' });
    expect(nav.compareDocumentPosition(screen.getByRole('article', { name: '教材正文' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.querySelectorAll('button')).toHaveLength(3);
    const headings = [...screen.getByRole('article', { name: '教材正文' }).querySelectorAll('h2')];
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(3);
    fireEvent.click(nav.querySelector('button')!);
    expect(document.activeElement).toBe(headings[0]);
  });

  it('不执行原始HTML、不加载远程图片、任意文件或危险链接', () => {
    const unsafe = { ...chapter, markdown: '<script>alert(1)</script>\n\n<img src="https://evil.example/a" onerror="alert(1)">\n\n![远程](https://evil.example/a.png)\n\n![文件](file:///C:/secret.png)\n\n[危险](javascript:alert%281%29)\n\n[安全外链](https://example.com)' };
    const { container } = render(<TextbookReader chapter={unsafe} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('安全外链');
  });
});
