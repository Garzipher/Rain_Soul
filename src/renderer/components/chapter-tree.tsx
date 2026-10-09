import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Chapter, WorkDetail } from '../../shared/contracts';
import { countDocumentWords } from '../../shared/document';
import { Icon } from './icon';

export type StructureTarget = { kind: 'work' | 'volume' | 'chapter'; id: string; title: string };
export type MenuEvent = MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>;
export interface ChapterTreeProps { work: WorkDetail; draft: Chapter | null; busy: boolean; onSelectChapter: (id: string) => void; onAddChapter: (volumeId?: string | null) => void; onAddVolume: () => void; onSelectVolume: (id: string) => void; onMenu: (target: StructureTarget, event: MenuEvent) => void }

export function ChapterTree(props: ChapterTreeProps) {
  const [collapsed, setCollapsed] = useState<Map<string, string | null>>(new Map());
  const words = (chapter: Chapter) => props.draft?.id === chapter.id ? countDocumentWords(props.draft.document) : chapter.wordCount;
  function menuKey(event: KeyboardEvent<HTMLButtonElement>, target: StructureTarget) {
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') { event.preventDefault(); props.onMenu(target, event); }
  }
  function chapterButton(chapter: Chapter) {
    const target: StructureTarget = { kind: 'chapter', id: chapter.id, title: props.draft?.id === chapter.id ? props.draft.title || '未命名章节' : chapter.title };
    return <button key={chapter.id} className={props.draft?.id === chapter.id ? 'selected' : ''} aria-label={`打开章节：${chapter.title}`} aria-current={props.draft?.id === chapter.id ? 'page' : undefined} onClick={() => props.onSelectChapter(chapter.id)} disabled={props.busy} onContextMenu={(event) => props.onMenu(target, event)} onKeyDown={(event) => menuKey(event, target)}>
      <Icon name="chapter" /><span>{target.title}</span><small>{words(chapter)}</small>
    </button>;
  }
  return <aside className="chapter-pane" aria-label="章节列表">
    <div className="pane-heading"><strong>卷与章节</strong><div className="pane-actions"><button className="icon-button" aria-label="添加分卷" title="添加分卷" onClick={props.onAddVolume} disabled={props.busy}><span aria-hidden="true">卷</span></button><button className="icon-button" aria-label="添加章节" title="添加章节" onClick={() => props.onAddChapter()} disabled={props.busy}><Icon name="plus" /></button></div></div>
    <div className="chapter-tree">
      {props.work.chapters.filter((chapter) => chapter.volumeId === null).map(chapterButton)}
      {props.work.volumes.map((volume) => {
        const chapters = props.work.chapters.filter((chapter) => chapter.volumeId === volume.id);
        const isCollapsed = collapsed.has(volume.id) && !(props.draft?.volumeId === volume.id && collapsed.get(volume.id) !== props.draft.id);
        const target: StructureTarget = { kind: 'volume', id: volume.id, title: volume.title };
        return <div key={volume.id} className="volume-group" role="group" aria-label={`分卷：${volume.title}`}>
          <button className="volume-heading" aria-label={`${isCollapsed ? '展开' : '收起'}分卷：${volume.title}`} aria-expanded={!isCollapsed} disabled={props.busy} onClick={() => { props.onSelectVolume(volume.id); setCollapsed((previous) => { const next = new Map(previous); if (isCollapsed) next.delete(volume.id); else next.set(volume.id, props.draft?.id ?? null); return next; }); }} onContextMenu={(event) => props.onMenu(target, event)} onKeyDown={(event) => menuKey(event, target)}><span className="volume-chevron" aria-hidden="true">{isCollapsed ? '›' : '⌄'}</span><span>{volume.title}</span><small>{chapters.reduce((sum, chapter) => sum + words(chapter), 0)}</small></button>
          {!isCollapsed && <div className="volume-chapters">{chapters.map(chapterButton)}{chapters.length === 0 && <p className="empty-volume">暂无章节</p>}</div>}
        </div>;
      })}
    </div>
    <p className="chapter-footer">{props.work.chapters.length} 章 · {props.work.chapters.reduce((sum, chapter) => sum + words(chapter), 0)} 字</p>
  </aside>;
}
