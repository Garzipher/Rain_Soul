import { AnimatePresence, m } from 'motion/react';
import { motionTokens, seconds } from '../motion/tokens';
import { SelectField } from './select-field';
import { useEffect, useRef, useState } from 'react';
import type { DesktopApi, WorkDetail, WorkSummary } from '../../shared/contracts';
import type { ConversationDetail, ConversationRequest, ConversationSummary } from '../../shared/conversations';
import type { AiPreparedRequest } from '../../shared/ai';
import './conversation-workspace.css';
import { ConversationDialog } from './conversation-dialog';
import { errorCode, isDefiniteRejection } from '../../shared/operation-errors';
import { ConversationReplyRecovery } from './conversation-reply-recovery';

export type ConversationApi = Pick<DesktopApi, 'listConversations' | 'readConversation' | 'manageConversation' | 'prepareConversationAi' | 'executeConversationAi' | 'cancelConversationAi' | 'retryConversationReply' | 'readPendingConversationReply' | 'discardConversationReply'>;
interface Props { work: WorkDetail | null; works: WorkSummary[]; api: ConversationApi; externalBusy?: boolean; onSelectWork: (id: string) => void; onOpenSettings?: () => void; onDirtyChange: (dirty: boolean) => void }
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : '会话操作失败，请重试。';

/** 会话只保存讨论与草稿，不具有改写作品的权限。 */
export function ConversationWorkspace({ work, works, api, externalBusy = false, onSelectWork, onOpenSettings, onDirtyChange }: Props) {
  const [listCollapsed, setListCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches);
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || externalBusy;
  const [pending, setPending] = useState<ConversationRequest | null>(null);
  const [rejected, setRejected] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendInfo, setSendInfo] = useState<AiPreparedRequest | null>(null);
  const [replyUnsaved, setReplyUnsaved] = useState(false);
  const generation = useRef(0);
  const [pendingReply, setPendingReply] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const currentRef = useRef(current); currentRef.current = current;
  const textRef = useRef(text); textRef.current = text;
  const activeRequest = useRef<AiPreparedRequest | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const changed = !!current && text !== current.draft;
  useEffect(() => {
    const narrowWindow = window.matchMedia('(max-width: 760px)');
    const syncList = (event: MediaQueryListEvent) => setListCollapsed(event.matches);
    narrowWindow.addEventListener('change', syncList);
    return () => narrowWindow.removeEventListener('change', syncList);
  }, []);
  useEffect(() => { onDirtyChange(changed || !!pending || localBusy || renaming || rejected || replyUnsaved); }, [changed, pending, localBusy, renaming, rejected, replyUnsaved, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    if (work) void api.listConversations(work.id).then(setList).catch(reason => setError(messageOf(reason)));
    return () => { mounted.current = false; onDirtyChange(false); generation.current += 1; if (activeRequest.current) void api.cancelConversationAi(activeRequest.current.confirmationToken).catch(() => {}); };
  }, [work?.id, api, onDirtyChange]);
  function rememberReply(conversationId: string, hash: string | null) {
    try { const key = `rainsoul:conversation-reply:${work?.id}:${conversationId}`; if (hash) localStorage.setItem(key, hash); else localStorage.removeItem(key); }
    catch { /* 受限存储不影响会话使用；完整回答仍由主进程的恢复文件保留。 */ }
  }
  function readRememberedReply(conversationId: string) {
    try { return localStorage.getItem(`rainsoul:conversation-reply:${work?.id}:${conversationId}`); }
    catch { return null; }
  }
  function accept(detail: ConversationDetail) {
    setCurrent(detail); currentRef.current = detail;
    const { id, title, revision, createdAt, updatedAt, messageCount } = detail;
    setList(items => [{ id, title, revision, createdAt, updatedAt, messageCount }, ...items.filter(item => item.id !== id)]);
  }
  async function refreshRemaining(workId: string) {
    try {
      const remaining = await api.listConversations(workId);
      setList(remaining);
      if (remaining[0]) { const next = await api.readConversation(workId, remaining[0].id); accept(next); setText(next.draft); textRef.current = next.draft; }
      setRefreshNeeded(false); setError(null);
    } catch (reason) { setRefreshNeeded(true); setError(messageOf(reason)); }
  }
  async function write(request: ConversationRequest) {
    try {
      const detail = await api.manageConversation(request);
      if (!mounted.current) return;
      if (request.action.type === 'delete') {
        const deletedId = request.action.id;
        setList(items => items.filter(item => item.id !== deletedId));
        setDeleting(null);
        setPending(null); setRejected(false); setError(null);
        if (currentRef.current?.id === deletedId) {
          setCurrent(null); currentRef.current = null; setText(''); textRef.current = '';
          await refreshRemaining(request.workId);
        }
        return;
      } else {
        if (!detail) throw new Error('会话已不存在，原内容已保留。');
        accept(detail);
        if (request.action.type !== 'saveDraft') { setText(detail.draft); textRef.current = detail.draft; }
        if (request.action.type === 'rename') setRenaming(false);
      }
      setPending(null); setRejected(false); setError(null);
    } catch (reason) {
      if (mounted.current) { setError(messageOf(reason)); if (isDefiniteRejection(reason)) setRejected(true); else setPending(request); }
      throw reason;
    }
  }
  async function saveDraft(retry?: ConversationRequest): Promise<void> {
    if (saving.current) { await saving.current; return saveDraft(retry); }
    const detail = currentRef.current;
    if (!work || !detail || (!retry && textRef.current === detail.draft)) return;
    const request: ConversationRequest = retry ?? { workId: work.id, operationId: crypto.randomUUID(), action: { type: 'saveDraft', id: detail.id, expectedRevision: detail.revision, draft: textRef.current } };
    const operation = write(request);
    saving.current = operation;
    try { await operation; } finally { saving.current = null; }
  }
  useEffect(() => {
    if (!changed || pending || busy || sending || pendingReply || rejected) return;
    const timer = setTimeout(() => { void saveDraft().catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [text, current?.revision, pending, busy, sending, pendingReply, rejected]);
  async function run(action: () => Promise<void>) {
    if (running.current || externalBusy || pending || rejected || replyUnsaved) return;
    running.current = true; setBusy(true); setError(null);
    try { await saveDraft(); await action(); }
    catch (reason) { if (mounted.current) setError(messageOf(reason)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  function open(id: string) { stop(); void run(async () => { if (!work) return; const detail = await api.readConversation(work.id, id); accept(detail); setText(detail.draft); textRef.current = detail.draft; setPendingReply(readRememberedReply(id)); }); }
  function create() { stop(); setPendingReply(null); void run(async () => {
    if (!work) return;
    await write({ workId: work.id, operationId: crypto.randomUUID(), action: { type: 'create', id: crypto.randomUUID(), title: '新会话' } });
  }); }
  function stop() {
    generation.current += 1;
    const prepared = activeRequest.current; activeRequest.current = null;
    setSending(false);
    if (prepared) {
      setPendingReply(prepared.requestHash);
      void api.cancelConversationAi(prepared.confirmationToken).catch(reason => { if (mounted.current) setError(messageOf(reason)); });
    }
  }
  function send() {
    if (running.current || sending || externalBusy || pending || pendingReply || rejected || renaming) return;
    const attempt = ++generation.current;
    void (async () => {
      running.current = true; setBusy(true); setError(null);
      try { await saveDraft(); }
      catch (reason) { if (mounted.current) setError(messageOf(reason)); return; }
      finally { running.current = false; if (mounted.current) setBusy(false); }
      const detail = currentRef.current;
      if (!work || !detail || !textRef.current.trim() || !mounted.current || generation.current !== attempt) return;
      setSendInfo(null); setSending(true);
      let prepared: AiPreparedRequest | null = null;
      try {
        prepared = await api.prepareConversationAi({ workId: work.id, conversationId: detail.id, expectedRevision: detail.revision });
        if (!mounted.current || generation.current !== attempt) { await api.cancelConversationAi(prepared.confirmationToken); return; }
        activeRequest.current = prepared; setSendInfo(prepared);
        rememberReply(detail.id, prepared.requestHash);
        const updated = await api.executeConversationAi({ confirmationToken: prepared.confirmationToken, requestHash: prepared.requestHash, confirmed: true });
        rememberReply(detail.id, null);
        if (mounted.current && generation.current === attempt) { accept(updated); setText(updated.draft); textRef.current = updated.draft; }
      } catch (reason) {
        if (prepared && errorCode(reason) === 'CONVERSATION_SEND_FAILED') rememberReply(detail.id, null);
        if (mounted.current && generation.current === attempt) {
          if (prepared && errorCode(reason) !== 'CONVERSATION_SEND_FAILED') setPendingReply(prepared.requestHash);
          setError(messageOf(reason));
        }
      } finally {
        if (generation.current === attempt) { activeRequest.current = null; if (mounted.current) setSending(false); }
      }
    })();
  }
  function remove() { void run(async () => {
    if (!work || !deleting) return;
    const detail = await api.readConversation(work.id, deleting.id);
    await write({ workId: work.id, operationId: crypto.randomUUID(), action: { type: 'delete', id: detail.id, expectedRevision: detail.revision } });
  }); }
  function rename() { void run(async () => {
    const detail = currentRef.current;
    if (!work || !detail || !name.trim()) return;
    await write({ workId: work.id, operationId: crypto.randomUUID(), action: { type: 'rename', id: detail.id, expectedRevision: detail.revision, title: name.trim() } });
  }); }
  function record() { void run(async () => {
    const detail = currentRef.current;
    if (!work || !detail || !textRef.current.trim()) return;
    await write({ workId: work.id, operationId: crypto.randomUUID(), action: { type: 'appendMessage', id: detail.id, expectedRevision: detail.revision, message: { id: crypto.randomUUID(), role: 'user', content: textRef.current }, clearDraft: true } });
  }); }
  function older() { void run(async () => {
    const detail = currentRef.current;
    if (!work || !detail?.hasMore || !detail.nextBeforeMessageId) return;
    const page = await api.readConversation(work.id, detail.id, detail.nextBeforeMessageId);
    if (page.revision !== detail.revision) throw new Error('会话已变化，请重新打开后阅读历史。');
    accept({ ...page, messages: [...page.messages, ...detail.messages] });
  }); }
  async function reload() {
    if (!work || !currentRef.current || busy) return;
    setBusy(true);
    try { accept(await api.readConversation(work.id, currentRef.current.id)); setRejected(false); setError(null); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }
  return <section className={`conversation-workspace ${listCollapsed ? 'list-collapsed' : ''}`} aria-label="作品需求会话">
    <aside id="conversation-list" className="conversation-list" aria-label="作品与会话" inert={listCollapsed} aria-hidden={listCollapsed}>
      <label className="conversation-work-select">作品<SelectField aria-label="会话所属作品" value={work?.id ?? ''} disabled={busy || changed || !!pending || replyUnsaved || renaming} onChange={event => { stop(); onSelectWork(event.target.value); }}>
        {!work && <option value="">选择作品</option>}{works.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </SelectField></label>
      {work && <><div className="conversation-project"><span className="conversation-project-label">会话列表</span><button className="secondary" disabled={busy || !!pending || replyUnsaved || renaming || rejected} onClick={create}>新建会话</button></div>
        <AnimatePresence initial={false}>{list.map(item => <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: seconds(motionTokens.collapse), ease: motionTokens.enter }} key={item.id} className={`conversation-row ${current?.id === item.id ? 'active' : ''}`}>
          <button aria-label={`打开会话：${item.title}`} title={item.title} disabled={busy || !!pending || replyUnsaved || renaming} onClick={() => open(item.id)}>{item.title}</button>
          <button className="conversation-delete" aria-label={`删除会话：${item.title}`} disabled={busy || !!pending || replyUnsaved || renaming} onClick={() => { stop(); setDeleting(item); }}>×</button>
        </m.div>)}</AnimatePresence>{!list.length && <p>尚无会话</p>}</>}
    </aside>
    <div className="conversation-main">
      <div className="conversation-main-toolbar">
        <button type="button" className="conversation-list-toggle secondary" aria-label={listCollapsed ? '展开会话列表' : '收起会话列表'} aria-expanded={!listCollapsed} aria-controls="conversation-list" title={listCollapsed ? '展开会话列表' : '收起会话列表'} onClick={event => { event.currentTarget.focus(); setListCollapsed(value => !value); }}>
          <span className="conversation-list-toggle-icon" aria-hidden="true">☰</span><span>会话列表</span>
        </button>
        {current && <div className="conversation-heading"><h2 title={current.title}>{current.title}</h2><button className="secondary" disabled={busy || !!pending || replyUnsaved} onClick={() => { stop(); setName(current.title); setRenaming(true); }}>重命名</button></div>}
      </div>
      {error && <div role="alert" className="page-error"><span>{error}</span><div className="conversation-error-actions">{refreshNeeded && work && <button className="secondary" disabled={busy} onClick={() => void run(() => refreshRemaining(work.id))}>重新读取会话列表</button>}{pending && <button className="secondary" onClick={() => void write(pending).catch(() => {})}>{pending.action.type === 'saveDraft' ? '重试保存草稿' : '重试会话操作'}</button>}{rejected && current && <button className="secondary" onClick={() => void reload()}>重新读取会话并保留草稿</button>}{!pending && !pendingReply && !rejected && !busy && !changed && onOpenSettings && <button className="secondary" onClick={onOpenSettings}>打开模型设置</button>}</div></div>}
      {!current ? <div className="conversation-empty">{work ? '新建或选择一个会话' : '先选择一部作品'}</div> : <>
        {renaming && <form className="conversation-rename" onSubmit={event => { event.preventDefault(); rename(); }}><input aria-label="会话名称" value={name} maxLength={120} onChange={event => setName(event.target.value)} /><button className="primary" disabled={busy || !name.trim()}>保存名称</button><button className="secondary" type="button" disabled={busy} onClick={() => setRenaming(false)}>取消改名</button></form>}
        <div className="conversation-messages" role="log" aria-label="会话消息">{current.hasMore && <button className="secondary" disabled={busy || !!pending || replyUnsaved} onClick={older}>加载更早消息</button>}{current.messages.map(item => <article key={item.id} className={`conversation-message ${item.role}`}><span>{item.role === 'user' ? '你' : 'AI 建议'}</span><p>{item.content}</p></article>)}</div>
        {current.messageCount > 100 && <p className="conversation-range">仅发送最近100条历史；更早消息可在本机阅读。</p>}
        {sending && <div className="conversation-generating" role="status"><span className="conversation-generating-dot" aria-hidden="true" />{sendInfo ? `${sendInfo.service} 正在思考…` : '正在连接模型…'}<button type="button" className="secondary" onClick={stop}>停止生成</button></div>}
        <div className="conversation-composer"><textarea aria-label="会话输入" placeholder="输入消息" value={text} maxLength={200000} disabled={busy || sending || !!pending || !!pendingReply} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} onChange={event => { textRef.current = event.target.value; onDirtyChange(true); setText(event.target.value); }} /><div><span role="status">{pending ? '草稿保存失败' : changed ? '正在保存草稿…' : 'Enter 发送 · Shift+Enter 换行'}</span><button className="secondary" disabled={busy || sending || !!pending || !!pendingReply || renaming || rejected || !text.trim()} onClick={record}>仅记录</button><button className="primary" disabled={busy || sending || !!pending || !!pendingReply || renaming || rejected || !text.trim()} onClick={send}>发送</button></div></div>
      </>}
      {pendingReply && work && current && <ConversationReplyRecovery key={pendingReply} requestHash={pendingReply} workId={work.id} conversationId={current.id} api={api} onProtectionChange={setReplyUnsaved} onResolved={detail => { rememberReply(detail.id, null); accept(detail); setText(detail.draft); textRef.current = detail.draft; setPendingReply(null); setReplyUnsaved(false); setError(null); }} />}
      <AnimatePresence>{deleting && <ConversationDialog title="删除会话" onCancel={() => { if (!busy) setDeleting(null); }}><h3>删除会话</h3><p>确认删除“{deleting.title}”及其消息和草稿？</p><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>取消删除</button><button className="danger" disabled={busy} onClick={remove}>确认删除会话</button></ConversationDialog>}</AnimatePresence>
    </div>
  </section>;
}
