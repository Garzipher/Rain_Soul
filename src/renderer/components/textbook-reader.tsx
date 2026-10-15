import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root as HastRoot, Element } from 'hast';
import type { TextbookChapter } from '../../shared/textbook';
import 'highlight.js/styles/github.css';

/** 教材为只读 Markdown；原始 HTML、外链和任意图片不会进入阅读界面。 */
export function TextbookReader({ chapter }: { chapter: TextbookChapter }) {
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null);
  const tocExpanded = expandedChapter === chapter.id;
  const sections = useMemo(() => {
    const tree = unified().use(remarkParse).parse(chapter.markdown);
    return tree.children.filter((node) => node.type === 'heading' && node.depth > 1).map((node, index) => {
      const label = (value: unknown): string => {
        const part = value as { value?: string; children?: unknown[] };
        return part.value ?? (part.children ?? []).map(label).join('');
      };
      return { id: `lesson-${chapter.id}-${index}`, label: label(node) };
    });
  }, [chapter]);
  const headingIds = useMemo(() => () => (tree: HastRoot) => {
    let index = 0;
    const walk = (parent: HastRoot | Element) => {
      for (const node of parent.children) {
        if (node.type !== 'element') continue;
        if (/^h[2-6]$/.test(node.tagName)) {
          node.properties.id = sections[index++]?.id;
          node.properties.tabIndex = -1;
        }
        walk(node);
      }
    };
    walk(tree);
  }, [sections]);
  function jump(id: string) {
    setExpandedChapter(null);
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  }
  return <div className="textbook-layout">
    {sections.length > 0 && <aside className="textbook-toc-panel" data-expanded={tocExpanded}>
      <button className="textbook-toc-toggle" aria-expanded={tocExpanded} aria-controls={`toc-${chapter.id}`} onClick={() => setExpandedChapter(tocExpanded ? null : chapter.id)}><span>本章目录</span><span aria-hidden="true">{tocExpanded ? '−' : '+'}</span></button>
      <nav id={`toc-${chapter.id}`} className="textbook-toc" aria-label="本章目录"><h2>本章目录</h2>{sections.map((section) => <button key={section.id} onClick={() => jump(section.id)}>{section.label}</button>)}</nav>
    </aside>}
    <article className="textbook" aria-label="教材正文">
      <Markdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight, headingIds]} components={{
        a: ({ children }) => <span>{children}</span>,
        p: ({ children }) => <div className="textbook-paragraph">{children}</div>,
        img: ({ src, alt }) => {
          const approved = src ? chapter.images[src] : undefined;
          if (!approved || !/^\/learning\/[a-f0-9]+\.png$/.test(approved)) return <span>{alt}</span>;
          return <figure><img src={approved} alt={alt ?? '系统截图'} loading="lazy" /><figcaption>{alt}</figcaption></figure>;
        },
        table: ({ children }) => <div className="textbook-table"><table>{children}</table></div>,
      }}>{chapter.markdown}</Markdown>
    </article>
  </div>;
}
