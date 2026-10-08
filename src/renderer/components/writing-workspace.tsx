import { useRef, useState, type KeyboardEvent } from 'react';
import type { Chapter, WorkDetail, WritingDocument } from '../../shared/contracts';
import { countDocumentWords } from '../../shared/document';
import type { SaveStatus } from '../lib/save-coordinator';
import { ChapterEditor } from './chapter-editor';
import { Icon } from './icon';
import { Placeholder } from './placeholder';

type WorkTab = 'body' | 'plot' | 'foreshadow';
export interface WritingWorkspaceProps {
  work: WorkDetail;
  draft: Chapter | null;
  status: SaveStatus;
  busy: boolean;
  closing: boolean;
  onCompositionChange: (value: boolean) => void;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
  onTitleChange: (title: string) => void;
  onDocumentChange: (document: WritingDocument) => void;
  onRetry: () => void;
  onReturn: () => void;
  beforeTabChange: () => Promise<void>;
  onError: (error: string) => void;
}

export function WritingWorkspace(props: WritingWorkspaceProps) {
  const [tab, setTab] = useState<WorkTab>('body');
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabDefinitions: { id: WorkTab; label: string }[] = [{ id: 'body', label: '正文' }, { id: 'plot', label: '剧情架构' }, { id: 'foreshadow', label: '伏笔架构' }];
  const statusText = { clean: '已保存', dirty: '待保存', saving: '保存中…', failed: '保存失败' }[props.status.phase];
  async function selectTab(next: WorkTab) {
    if (next === tab || props.busy) return;
    try {
      await props.beforeTabChange();
      setTab(next);
      tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }
    catch { /* 保存协调器已经显示失败原因，保持当前编辑区。 */ }
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: WorkTab) {
    const index = tabDefinitions.findIndex((item) => item.id === current);
    const destinations: Record<string, number> = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 };
    const nextIndex = destinations[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    void selectTab(tabDefinitions[nextIndex].id);
  }
  return <>
    <header className="topbar"><h1>{props.work.title}</h1><span role="status" className={`save-status ${props.status.phase}`}>{props.closing ? '正在保存并关闭…' : statusText}</span></header>
    <div className="work-tabs">
      <div className="work-tab-group" ref={tabsRef} role="tablist" aria-label="作品工作区">
        {tabDefinitions.map((item) => <button key={item.id} id={`tab-${item.id}`} role="tab" data-tab={item.id} aria-controls={`panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={props.busy} onClick={() => void selectTab(item.id)} onKeyDown={(event) => handleTabKey(event, item.id)}>{item.label}</button>)}
      </div>
      <button className="back-button" onClick={props.onReturn} disabled={props.busy}><Icon name="back" />返回作品集</button>
    </div>
    {props.status.phase === 'failed' && <div className="save-error" role="alert"><span>{props.status.error}。草稿仍保留在当前窗口，请重试保存后再离开。</span><button className="secondary" onClick={props.onRetry} disabled={props.busy}>重试保存</button></div>}
    {tab !== 'body' ? <div className="architecture-placeholder" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}><Placeholder onReturn={props.onReturn} /></div> : <div className="workspace" id="panel-body" role="tabpanel" aria-labelledby="tab-body">
      <aside className="chapter-pane" aria-label="章节列表">
        <div className="pane-heading"><strong>章节</strong><button className="icon-button" aria-label="添加章节" title="添加章节" onClick={props.onAddChapter} disabled={props.busy}><Icon name="plus" /></button></div>
        <div className="chapter-tree">{props.work.chapters.map((chapter) => <button key={chapter.id} className={props.draft?.id === chapter.id ? 'selected' : ''} aria-label={`打开章节：${chapter.title}`} aria-current={props.draft?.id === chapter.id ? 'page' : undefined} onClick={() => props.onSelectChapter(chapter.id)} disabled={props.busy}><Icon name="chapter" /><span>{props.draft?.id === chapter.id ? props.draft.title || '未命名章节' : chapter.title}</span><small>{props.draft?.id === chapter.id ? countDocumentWords(props.draft.document) : chapter.wordCount}</small></button>)}</div>
        <p className="chapter-footer">{props.work.chapters.length} 章 · {props.work.chapters.reduce((sum, chapter) => sum + (chapter.id === props.draft?.id ? countDocumentWords(props.draft.document) : chapter.wordCount), 0)} 字</p>
      </aside>
      <section className="editor-panel">
        {props.draft ? <div className="manuscript">
          <div className="manuscript-meta"><span>正文</span><span aria-live="polite">本章 {countDocumentWords(props.draft.document)} 字</span></div>
          <input className="chapter-title" aria-label="章节标题" value={props.draft.title} onChange={(event) => props.onTitleChange(event.target.value)} onCompositionStart={() => props.onCompositionChange(true)} onCompositionEnd={() => props.onCompositionChange(false)} disabled={props.busy} autoComplete="off" />
          <ChapterEditor key={props.draft.id} document={props.draft.document} locked={props.busy} onChange={props.onDocumentChange} onError={props.onError} onCompositionChange={props.onCompositionChange} />
        </div> : <div className="empty-state"><h2>尚无章节</h2><button className="primary" onClick={props.onAddChapter}>添加章节</button></div>}
      </section>
    </div>}
  </>;
}
