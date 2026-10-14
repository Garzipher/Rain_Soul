import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BookmarkNode, Chapter, WorkDetail, WritingDocument } from '../../shared/contracts';
import type { AssetAction } from '../../shared/assets';
import { countDocumentWords } from '../../shared/document';
import type { SaveStatus } from '../lib/save-coordinator';
import { ChapterEditor } from './chapter-editor';
import { Icon } from './icon';
import { Placeholder } from './placeholder';
import { ChapterTree, type MenuEvent, type StructureTarget } from './chapter-tree';
import type { Textbook } from '../../shared/textbook';
import { LearningChapter } from './learning-chapter';
import { PlotWorkspace } from './plot-workspace';
import { ForeshadowWorkspace } from './foreshadow-workspace';
import type { SnapshotPanelProps } from './snapshot-panel';
import type { AiWorkspaceProps } from './ai-workspace';
import { WorkspaceToolDialog } from './workspace-tool-dialog';
import { restoreWritingRequest, type WritingAiRequest, type SavedWritingRequest } from '../lib/writing-ai-selection';
import './assets-workspace.css';

type WorkTab = 'body' | 'plot' | 'foreshadow';
const SnapshotPanel = lazy(() => import('./snapshot-panel').then(module => ({ default: module.SnapshotPanel })));
const AiWorkspace = lazy(() => import('./ai-workspace').then(module => ({ default: module.AiWorkspace })));
const ConsistencyPanel = lazy(() => import('./consistency-panel').then(module => ({ default: module.ConsistencyPanel })));
export interface WritingWorkspaceProps {
  savedSelection?: SavedWritingRequest;
  onSelectionChange?: (value: SavedWritingRequest | undefined) => void;
  ai: Omit<AiWorkspaceProps, 'work' | 'chapterId' | 'busy'>;
  onExport: (format: 'txt' | 'docx') => void;
  onBackup: () => void;
  snapshots: Omit<SnapshotPanelProps, 'busy' | 'revision'>;
  assetRecovery: number;
  location?: {chapterId: string; paragraphId: string; token: number} | null;
  textbook?: Textbook;
  work: WorkDetail;
  draft: Chapter | null;
  status: SaveStatus;
  busy: boolean;
  closing: boolean;
  onCompositionChange: (value: boolean) => void;
  onSelectChapter: (id: string) => void;
  onAddChapter: (volumeId?: string | null) => void;
  onAddVolume: () => void;
  onSelectVolume: (id: string) => void;
  onMenu: (target: StructureTarget, event: MenuEvent) => void;
  onTitleChange: (title: string) => void;
  onDocumentChange: (document: WritingDocument) => void;
  onRetry: () => void;
  onReturn: () => void;
  changeTab: (action: () => void) => Promise<boolean>;
  onError: (error: string) => void;
  onAssetAction: (action: AssetAction) => Promise<boolean>;
  onAssetDirtyChange: (dirty: boolean) => void;
  onLocate: (chapterId: string, paragraphId?: string) => void;
  onLocateAsset?: (kind: BookmarkNode['attrs']['kind'], id: string) => void;
}

export function WritingWorkspace(props: WritingWorkspaceProps) {
  const [tab, setTab] = useState<WorkTab>('body');
  const [tool, setTool] = useState<'ai' | 'snapshots' | null>(null);
  const [aiOpened, setAiOpened] = useState(false);
  const [aiActive, setAiActive] = useState(!!props.ai.initialReview?.candidate);
  const [entryToken, setEntryToken] = useState(0);
  const [selectionRequest, setSelectionRequest] = useState<WritingAiRequest>();
  const restoringSelection = useRef(!!props.savedSelection);
  function openSelection(request: WritingAiRequest) {
    if (props.busy) return;
    void props.changeTab(() => { setEntryToken(value => value + 1); setSelectionRequest(request); if (props.draft) props.onSelectionChange?.({ chapterId: props.draft.id, document: JSON.stringify(props.draft.document), request }); setAiOpened(true); setTool('ai'); }).catch(() => { /* 保存失败时不打开工具。 */ });
  }
  function showTool(next: 'ai' | 'snapshots' | null) {
    if (props.busy) return;
    void props.changeTab(() => { if (next === 'ai') { const restored = restoringSelection.current ? restoreWritingRequest(props.savedSelection, props.draft) : undefined; restoringSelection.current = false; setAiOpened(true); setSelectionRequest(restored); if (!restored) props.onSelectionChange?.(undefined); setEntryToken(value => value + 1); } setTool(next); }).catch(() => { /* 保存失败时保留当前工具和草稿。 */ });
  }
  useEffect(() => { setSelectionRequest(undefined); }, [props.draft?.id]);
  const tabsRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<WorkTab | null>(null);
  const [selectedOutlineId, setSelectedOutlineId] = useState<string>();
  const [selectedForeshadowId, setSelectedForeshadowId] = useState<string>();
  function locateAsset(kind: BookmarkNode['attrs']['kind'], id: string) {
    if (props.busy) return;
    const assets = kind === 'foreshadow' ? props.work.assets?.foreshadows : props.work.assets?.knowledge;
    if (!assets?.some(item => item.id === id && !item.deletedAt)) { props.onError('关联对象已删除或不可用，请查看保留的来源。'); return; }
    void props.changeTab(() => {
      if (kind === 'foreshadow') { setSelectedForeshadowId(id); setTab('foreshadow'); }
      else props.onLocateAsset?.(kind, id);
    }).catch(() => { /* 保存门禁已经显示失败原因，不切换或清理草稿。 */ });
  }
  function locate(chapterId: string, paragraphId?: string) {
    void props.changeTab(() => { setTab('body'); props.onLocate(chapterId, paragraphId); });
  }
  function locateFromTool(chapterId: string, paragraphId?: string) {
    void props.changeTab(() => { setTool(null); setTab('body'); props.onLocate(chapterId, paragraphId); });
  }
  useEffect(() => {
    if (!props.busy && pendingFocus.current === tab) { tabsRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus(); pendingFocus.current = null; }
  }, [tab, props.busy]);
  const tabDefinitions: { id: WorkTab; label: string }[] = [{ id: 'body', label: '正文' }, { id: 'plot', label: '剧情架构' }, { id: 'foreshadow', label: '伏笔架构' }];
  const statusText = { clean: '已保存', dirty: '待保存', saving: '保存中…', failed: '保存失败' }[props.status.phase];
  async function selectTab(next: WorkTab) {
    if (next === tab || props.busy) return;
    try {
      pendingFocus.current = next;
      const changed = await props.changeTab(() => setTab(next));
      if (!changed) pendingFocus.current = null;
    }
    catch { /* 保存协调器已经显示失败原因，保持当前编辑区。 */ }
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: WorkTab) {
    const index = tabDefinitions.findIndex((item) => item.id === current);
    const count = tabDefinitions.length;
    const destinations: Record<string, number> = { ArrowRight: (index + 1) % count, ArrowLeft: (index + count - 1) % count, Home: 0, End: count - 1 };
    const nextIndex = destinations[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    void selectTab(tabDefinitions[nextIndex].id);
  }
  return <>
    <header className="topbar"><h1>{props.work.title}</h1><div className="header-actions"><button className="secondary" disabled={props.busy || !props.draft} onClick={() => showTool('ai')}>AI 工具</button><button className="secondary" disabled={props.busy} onClick={() => showTool('snapshots')}>版本历史</button><button className="secondary" disabled={props.busy} onClick={props.onBackup}>备份项目</button><button className="secondary" disabled={props.busy} onClick={() => props.onExport('txt')}>导出 TXT</button><button className="secondary" disabled={props.busy} onClick={() => props.onExport('docx')}>导出 DOCX</button><span role="status" className={`save-status ${props.status.phase}`}>{props.closing ? '正在保存并关闭…' : statusText}</span></div></header>
    <div className="work-tabs">
      <div className="work-tab-group" ref={tabsRef} role="tablist" aria-label="作品工作区">
        {tabDefinitions.map((item) => <button key={item.id} id={`tab-${item.id}`} role="tab" data-tab={item.id} aria-controls={`panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} disabled={props.busy} onClick={() => void selectTab(item.id)} onKeyDown={(event) => handleTabKey(event, item.id)}>{item.label}</button>)}
      </div>
      <button className="back-button" onClick={props.onReturn} disabled={props.busy}><Icon name="back" />返回作品集</button>
    </div>
    {props.status.phase === 'failed' && <div className="save-error" role="alert"><span>{props.status.error}。草稿仍保留在当前窗口，请重试保存后再离开。</span><button className="secondary" onClick={props.onRetry} disabled={props.busy}>重试保存</button></div>}
    <WorkspaceToolDialog title="AI工具" open={tool === 'ai'} busy={props.busy} onClose={() => showTool(null)}>
      {aiOpened && <Suspense fallback={<p role="status">正在打开 AI 工具…</p>}><ConsistencyPanel work={props.work} onLocate={locateFromTool} /><AiWorkspace {...props.ai} onActivityChange={setAiActive} entryToken={entryToken} selectionRequest={selectionRequest} work={props.work} chapterId={props.draft?.id ?? null} busy={props.busy} onLocate={locateFromTool} /></Suspense>}
    </WorkspaceToolDialog>
    <WorkspaceToolDialog title="版本历史" open={tool === 'snapshots'} busy={props.busy} onClose={() => showTool(null)}>
      {tool === 'snapshots' && <Suspense fallback={<p role="status">正在打开版本历史…</p>}><SnapshotPanel {...props.snapshots} busy={props.busy} revision={props.work.revision} /></Suspense>}
    </WorkspaceToolDialog>
    {tab !== 'body' ? <div className="architecture-placeholder" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {props.work.assets ? (tab === 'plot' ? <PlotWorkspace key={props.assetRecovery} work={props.work} assets={props.work.assets} busy={props.busy} onAction={props.onAssetAction} onLocate={locate} onDirtyChange={props.onAssetDirtyChange} selectedId={selectedOutlineId} onSelectForeshadow={id => locateAsset('foreshadow', id)} /> : <ForeshadowWorkspace key={props.assetRecovery} work={props.work} assets={props.work.assets} busy={props.busy} onAction={props.onAssetAction} onLocate={locate} onDirtyChange={props.onAssetDirtyChange} selectedId={selectedForeshadowId} onSelectOutline={(id) => { void props.changeTab(() => { setSelectedOutlineId(id); setTab('plot'); }); }} />) : <Placeholder onReturn={props.onReturn} />}
    </div> : tab === 'body' && <div className="workspace" id="panel-body" role="tabpanel" aria-labelledby="tab-body">
      <ChapterTree work={props.work} draft={props.draft} busy={props.busy} onSelectChapter={props.onSelectChapter} onAddChapter={props.onAddChapter} onAddVolume={props.onAddVolume} onSelectVolume={props.onSelectVolume} onMenu={props.onMenu} />
      <section className="editor-panel">
        {props.draft ? <LearningChapter key={props.work.id} textbook={props.textbook} workId={props.work.id} chapterId={props.draft.id} busy={props.busy} changeMode={props.changeTab}><div className="manuscript">
          <div className="manuscript-meta"><span>正文</span><span aria-live="polite">本章 {countDocumentWords(props.draft.document)} 字</span></div>
          <input className="chapter-title" aria-label="章节标题" value={props.draft.title} onChange={(event) => props.onTitleChange(event.target.value)} onCompositionStart={() => props.onCompositionChange(true)} onCompositionEnd={() => props.onCompositionChange(false)} disabled={props.busy} autoComplete="off" />
          <ChapterEditor assets={props.work.assets} location={props.location?.chapterId === props.draft.id ? props.location : null} key={props.draft.id} document={props.draft.document} locked={props.busy} ghostPaused={tool === 'ai' || aiActive} onChange={props.onDocumentChange} onError={props.onError} onCompositionChange={props.onCompositionChange} onLocateAsset={locateAsset} onAiRequest={openSelection} />
        </div></LearningChapter> : <div className="empty-state"><h2>尚无章节</h2><button className="primary" onClick={() => props.onAddChapter()} disabled={props.busy}>添加章节</button></div>}
      </section>
    </div>}
  </>;
}
