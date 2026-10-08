import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi, StructureAction, StructureRequest, WorkDetail, WorkSummary } from '../shared/contracts';
import { CreateDialog } from './components/create-dialog';
import { ContextMenu } from './components/context-menu';
import { StructureDialog } from './components/structure-dialog';
import { useStructureMenu } from './hooks/use-structure-menu';
import { Icon } from './components/icon';
import { Placeholder } from './components/placeholder';
import { SettingsPage } from './components/settings-page';
import { Sidebar, type Page } from './components/sidebar';
import { WritingWorkspace } from './components/writing-workspace';
import { useWritingSession } from './hooks/use-writing-session';
import './styles.css';

export interface AppProps { api: DesktopApi }
type PendingOperation = { kind: 'structure'; request: StructureRequest } | { kind: 'addChapter'; workId: string; title: string; revision: number; operationId: string; volumeId: string | null; previousIds: string[] };
const pageTitles: Record<Exclude<Page, 'work'>, string> = { shelf: '作品集', knowledge: '知识库', sessions: '需求会话', settings: '设置' };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重试';

export default function App({ api }: AppProps) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<Page>('shelf');
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const pendingRef = useRef<PendingOperation | null>(null);
  const pendingPage = useRef<Page>('shelf');
  const [recoveryReload, setRecoveryReload] = useState(0);
  const operationInProgress = useRef(false);
  const activeOperation = useRef<Promise<void>>(Promise.resolve());
  const session = useWritingSession(api, work, chapterId, setWork, { beforeClose: async () => { await activeOperation.current; if (pendingRef.current) throw new Error('结构操作结果待确认，请先重试结构操作'); }, isBlocked: () => operationInProgress.current || !!pendingRef.current });
  const locked = busy || session.closing || !!pending;
  const loadWorks = useCallback(async (propagateError = false) => {
    setLoading(true);
    setError(null);
    try { setWorks(await api.listWorks()); }
    catch (reason) { setError(messageOf(reason)); if (propagateError) throw reason; }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void loadWorks(); }, [loadWorks]);

  async function guarded(action: () => Promise<void>, allowPending = false): Promise<boolean> {
    if (operationInProgress.current || session.isClosing() || (pendingRef.current && !allowPending)) return false;
    operationInProgress.current = true;
    setBusy(true);
    setError(null);
    const operation = (async () => {
      try { await session.flush(); await action(); return true; }
      catch (reason) { setError(messageOf(reason)); return false; }
      finally { operationInProgress.current = false; setBusy(false); }
    })();
    activeOperation.current = operation.then(() => undefined);
    return operation;
  }
  function navigate(next: Page) {
    void guarded(async () => {
      if (next === 'shelf') await loadWorks(true);
      setPage(next);
      if (next !== 'work') setChapterId(null);
    });
  }
  function enterWork(detail: WorkDetail) {
    setWork(detail);
    setChapterId(detail.chapters[0]?.id ?? null);
    setSelectedVolumeId(detail.chapters[0]?.volumeId ?? null);
    setPage('work');
  }
  function openWork(id: string) { void guarded(async () => enterWork(await api.openWork(id))); }
  async function create(title: string) {
    if (operationInProgress.current || session.isClosing()) return;
    operationInProgress.current = true;
    setBusy(true);
    setCreateError(null);
    const operation = (async () => {
      try { const detail = await api.createWork(title); setShowCreate(false); enterWork(detail); }
      catch (reason) { setCreateError(messageOf(reason)); }
      finally { operationInProgress.current = false; setBusy(false); }
    })();
    activeOperation.current = operation;
    await operation;
  }
  function addChapter(volumeId: string | null = selectedVolumeId) {
    void guarded(async () => {
      if (!work) return;
      const fresh = await api.openWork(work.id);
      const operation: PendingOperation & { kind: 'addChapter' } = { kind: 'addChapter', workId: fresh.id, title: `第${fresh.chapters.length + 1}章`, revision: fresh.revision, operationId: crypto.randomUUID(), volumeId, previousIds: fresh.chapters.map((chapter) => chapter.id) };
      try { await applyAdd(operation); }
      catch (reason) { pendingRef.current = operation; setPending(operation); throw reason; }
    });
  }
  async function applyAdd(operation: PendingOperation & { kind: 'addChapter' }) {
    const updated = await api.addChapter(operation.workId, operation.title, operation.revision, operation.operationId, operation.volumeId);
    pendingRef.current = null; setPending(null);
    session.acceptWork(updated);
    setWork(updated);
    const added = updated.chapters.find((chapter) => !operation.previousIds.includes(chapter.id));
    setChapterId(added?.id ?? null);
    setSelectedVolumeId(added?.volumeId ?? null);
  }
  async function applyStructure(request: StructureRequest, origin: Page) {
    const updated = await api.manageStructure(request);
    pendingRef.current = null; setPending(null);
    if (updated && (work?.id === updated.id || origin === 'settings')) {
      session.acceptWork(updated);
      setWork(updated);
      if (origin === 'work') {
        setChapterId((previous) => updated.chapters.some((chapter) => chapter.id === previous) ? previous : updated.chapters[0]?.id ?? null);
        setSelectedVolumeId((previous) => request.action.type === 'createVolume' ? updated.volumes[updated.volumes.length - 1]?.id ?? null : previous && updated.volumes.some((volume) => volume.id === previous) ? previous : null);
      }
      else setChapterId(null);
    }
    if (!updated && work?.id === request.workId) { setWork(null); setChapterId(null); }
    if (!updated && origin === 'work') setPage('shelf');
    await loadWorks();
    setRecoveryReload((value) => value + 1);
  }
  async function manage(workId: string, action: StructureAction, expectedRevision?: number) {
    let attempted = false;
    await guarded(async () => {
      const fresh = action.type === 'restoreWork' ? null : await api.openWork(workId);
      if (fresh && fresh.id === work?.id) { session.acceptWork(fresh); setWork(fresh); }
      const request: StructureRequest = { workId, action, expectedRevision: fresh?.revision ?? expectedRevision!, operationId: crypto.randomUUID() };
      attempted = true;
      try { await applyStructure(request, page); }
      catch (reason) { const operation: PendingOperation = { kind: 'structure', request }; pendingRef.current = operation; pendingPage.current = page; setPending(operation); throw reason; }
    });
    return attempted || !operationInProgress.current;
  }
  function retryStructure() {
    const request = pendingRef.current;
    if (!request) return;
    void guarded(async () => { if (request.kind === 'structure') await applyStructure(request.request, pendingPage.current); else await applyAdd(request); }, true);
  }
  const structure = useStructureMenu(work, session.draft, manage, addChapter, locked);
  function retrySave() {
    if (operationInProgress.current || session.isClosing()) return;
    operationInProgress.current = true;
    setBusy(true);
    setError(null);
    activeOperation.current = session.retry().catch(() => { /* 失败原因由保存状态展示。 */ }).finally(() => { operationInProgress.current = false; setBusy(false); });
  }

  return <div className={`app ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
    <Sidebar expanded={expanded} page={page} onToggle={() => setExpanded((value) => !value)} onNavigate={navigate} />
    <main className="main">
      {session.closeError && <div className="page-error" role="alert">{session.closeError}</div>}
      {error && !(page === 'work' && session.status.phase === 'failed') && <div className="page-error" role="alert"><span>{error}</span>{pending ? <button className="secondary" disabled={busy || session.closing} onClick={retryStructure}>重试结构操作</button> : page === 'shelf' && <button className="secondary" onClick={() => void loadWorks()}>重新加载</button>}</div>}
      {page === 'work' && work ? <WritingWorkspace work={work} draft={session.draft} status={session.status} busy={locked} closing={session.closing} onCompositionChange={session.setComposing} onSelectChapter={(id) => void guarded(async () => { setChapterId(id); setSelectedVolumeId(work.chapters.find((chapter) => chapter.id === id)?.volumeId ?? null); })} onAddChapter={addChapter} onAddVolume={structure.addVolume} onSelectVolume={setSelectedVolumeId} onMenu={(target, event) => { if (target.kind === 'volume') setSelectedVolumeId(target.id); structure.showMenu(target, event); }} onTitleChange={session.updateTitle} onDocumentChange={session.updateDocument} onRetry={retrySave} onReturn={() => navigate('shelf')} changeTab={(action) => guarded(async () => action())} onError={setError} /> : <>
        <header className="topbar"><h1>{page === 'work' ? '作品集' : pageTitles[page]}</h1>{page === 'shelf' && <button className="primary" onClick={() => { setCreateError(null); setShowCreate(true); }} disabled={locked}><Icon name="plus" />新建作品</button>}</header>
        {page === 'shelf' && <section className="shelf" aria-label="作品书架">
          {loading ? <p role="status">正在读取本机作品…</p> : !error && <>
            <div className="shelf-count">{works.length} 部作品</div>
            {works.length === 0 ? <div className="empty-state"><span className="empty-mark" aria-hidden="true">◇</span><h2>还没有作品</h2><p>从一部新作品开始，把故事留在这里。</p></div> : <div className="books">{works.map((item) => <button key={item.id} className="book" data-work-id={item.id} aria-label={`打开作品：${item.title}`} disabled={locked} onClick={() => openWork(item.id)} onContextMenu={(event) => structure.showMenu({ kind: 'work', id: item.id, title: item.title }, event)} onKeyDown={(event) => { if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') structure.showMenu({ kind: 'work', id: item.id, title: item.title }, event); }}>
              <span className="book-mark" aria-hidden="true"><Icon name="books" /></span><strong>{item.title}</strong><span className="book-bottom"><span>{item.chapterCount} 章 · {item.wordCount} 字</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</time></span>
            </button>)}</div>}
          </>}
        </section>}
        {page === 'knowledge' && <Placeholder onReturn={() => navigate('shelf')} />}
        {page === 'sessions' && <Placeholder deferred onReturn={() => navigate('shelf')} />}
        {page === 'settings' && <SettingsPage api={api} currentWork={work} busy={locked} reload={recoveryReload} onSelect={(id) => { void guarded(async () => { const detail = await api.openWork(id); session.acceptWork(detail); setWork(detail); setChapterId(null); }); }} onRestore={manage} />}
      </>}
    </main>
    {structure.menu && <ContextMenu state={structure.menu} onClose={structure.closeMenu} />}
    {structure.dialog && <StructureDialog state={structure.dialog} busy={busy} onClose={structure.closeDialog} />}
    {showCreate && <CreateDialog busy={busy} error={createError} onClose={() => setShowCreate(false)} onCreate={(title) => void create(title)} />}
  </div>;
}
