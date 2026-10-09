import { useState, type ReactNode } from 'react';
import type { Textbook } from '../../shared/textbook';
import { TextbookReader } from './textbook-reader';
export function LearningChapter(props: { textbook?: Textbook; workId: string; chapterId: string; busy: boolean; changeMode: (action: () => void) => Promise<boolean>; children: ReactNode }) {
  const [mode, setMode] = useState<'read' | 'source'>('read');
  const chapter = props.textbook?.workId === props.workId ? props.textbook.chapters.find((item) => item.id === props.chapterId) : undefined;
  if (!chapter) return <>{props.children}</>;
  const modes = [{ value: 'read', label: '图文阅读' }, { value: 'source', label: 'Markdown 源文' }] as const;
  return <>
    <div className="learning-toolbar" role="group" aria-label="教材阅读方式">
      {modes.map((item) => <button key={item.value} aria-pressed={mode === item.value} disabled={props.busy} onClick={() => { void props.changeMode(() => setMode(item.value)); }}>{item.label}</button>)}
    </div>
    {mode === 'read' && <TextbookReader chapter={chapter} />}
    {mode === 'source' && <textarea className="textbook-source" aria-label="教材 Markdown 源文" value={chapter.markdown} readOnly spellCheck={false} />}
  </>;
}
