import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi, WorkDetail, WorkSummary } from '../shared/contracts';
import { CreateDialog } from './components/create-dialog';
import { Icon } from './components/icon';
import { Placeholder } from './components/placeholder';
import { SettingsPage } from './components/settings-page';
import { Sidebar, type Page } from './components/sidebar';
import { WritingWorkspace } from './components/writing-workspace';
import { useWritingSession } from './hooks/use-writing-session';
import './styles.css';

export interface AppProps { api: DesktopApi }
const pageTitles: Record<Exclude<Page, 'work'>, string> = { shelf: '作品集', knowledge: '知识库', sessions: '需求会话', settings: '设置' };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重试';

export default function App({ api }: AppProps) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<Page>('shelf');
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const operationInProgress = useRef(false);
  const activeOperation = useRef<Promise<void>>(Promise.resolve());
  const session = useWritingSession(api, work, chapterId, setWork, { beforeClose: () => activeOperation.current, isBlocked: () => operationInProgress.current });
  const loadWorks = useCallback(async (propagateError = false) => {
    setLoading(true);
    setError(null);
    try { setWorks(await api.listWorks()); }
    catch (reason) { setError(messageOf(reason)); if (propagateError) throw reason; }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void loadWorks(); }, [loadWorks]);

  async function guarded(action: () => Promise<void>) {
    if (operationInProgress.current || session.isClosing()) return;
    operationInProgress.current = true;
    setBusy(true);
    setError(null);
    const operation = (async () => {
      try { await session.flush(); await action(); }
      catch (reason) { if (session.status.phase !== 'failed') setError(messageOf(reason)); }
      finally { operationInProgress.current = false; setBusy(false); }
    })();
    activeOperation.current = operation;
    await operation;
  }
  function navigate(next: Page) {
    void guarded(async () => {
      if (next === 'shelf') await loadWorks(true);
      setPage(next);
      if (next !== 'work') { setWork(null); setChapterId(null); }
    });
  }
  function enterWork(detail: WorkDetail) {
    setWork(detail);
    setChapterId(detail.chapters[0]?.id ?? null);
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
  function addChapter() {
    void guarded(async () => {
      if (!work) return;
      const fresh = await api.openWork(work.id);
      const updated = await api.addChapter(fresh.id, `第${fresh.chapters.length + 1}章`, fresh.revision, crypto.randomUUID());
      setWork(updated);
      setChapterId(updated.chapters[updated.chapters.length - 1]?.id ?? null);
    });
  }
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
      {error && !(page === 'work' && session.status.phase === 'failed') && <div className="page-error" role="alert"><span>{error}</span>{page === 'shelf' && <button className="secondary" onClick={() => void loadWorks()}>重新加载</button>}</div>}
      {page === 'work' && work ? <WritingWorkspace work={work} draft={session.draft} status={session.status} busy={busy || session.closing} closing={session.closing} onCompositionChange={session.setComposing} onSelectChapter={(id) => void guarded(async () => setChapterId(id))} onAddChapter={addChapter} onTitleChange={session.updateTitle} onDocumentChange={session.updateDocument} onRetry={retrySave} onReturn={() => navigate('shelf')} beforeTabChange={session.flush} onError={setError} /> : <>
        <header className="topbar"><h1>{page === 'work' ? '作品集' : pageTitles[page]}</h1>{page === 'shelf' && <button className="primary" onClick={() => { setCreateError(null); setShowCreate(true); }} disabled={busy}><Icon name="plus" />新建作品</button>}</header>
        {page === 'shelf' && <section className="shelf" aria-label="作品书架">
          {loading ? <p role="status">正在读取本机作品…</p> : !error && <>
            <div className="shelf-count">{works.length} 部作品</div>
            {works.length === 0 ? <div className="empty-state"><span className="empty-mark" aria-hidden="true">◇</span><h2>还没有作品</h2><p>从一部新作品开始，把故事留在这里。</p></div> : <div className="books">{works.map((item) => <button key={item.id} className="book" aria-label={`打开作品：${item.title}`} disabled={busy} onClick={() => openWork(item.id)}>
              <span className="book-mark" aria-hidden="true"><Icon name="books" /></span><strong>{item.title}</strong><span className="book-bottom"><span>{item.chapterCount} 章 · {item.wordCount} 字</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</time></span>
            </button>)}</div>}
          </>}
        </section>}
        {page === 'knowledge' && <Placeholder onReturn={() => navigate('shelf')} />}
        {page === 'sessions' && <Placeholder deferred onReturn={() => navigate('shelf')} />}
        {page === 'settings' && <SettingsPage api={api} />}
      </>}
    </main>
    {showCreate && <CreateDialog busy={busy} error={createError} onClose={() => setShowCreate(false)} onCreate={(title) => void create(title)} />}
  </div>;
}
