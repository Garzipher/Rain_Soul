import { SelectField } from './components/select-field';
import type { AiKnowledgeApproval } from '../shared/ai-extraction';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi, StructureAction, StructureRequest, WorkDetail, WorkSummary } from '../shared/contracts';
import type { AssetAction, AssetQuery, AssetRequest, SearchResult } from '../shared/assets';
import type { KnowledgeScope } from '../shared/knowledge-scope';
import { CreateDialog } from './components/create-dialog';
import { ContextMenu } from './components/context-menu';
import { StructureDialog } from './components/structure-dialog';
import { useStructureMenu } from './hooks/use-structure-menu';
import { Icon } from './components/icon';
import { SettingsPage } from './components/settings-page';
import { Sidebar, type Page } from './components/sidebar';
import { WritingWorkspace } from './components/writing-workspace';
import { useWritingSession } from './hooks/use-writing-session';
import './styles.css';
import './textbook.css';
import { useAuthorProfile } from './hooks/use-author-profile';
import type { Textbook } from '../shared/textbook';
import { KnowledgeWorkspace } from './components/knowledge-workspace';
import { KnowledgeCopyDialog, prepareKnowledgeCopy, type KnowledgeCopyPreview } from './components/knowledge-copy-dialog';
import type { SnapshotCreateRequest, SnapshotRestoreRequest } from '../shared/snapshots';
import type { KnowledgeCopyRequest } from '../shared/knowledge-scope';
import type { ManuscriptDraft } from '../shared/manuscript';
import { ManuscriptDialog } from './components/manuscript-dialog';
import type { AiCandidate, AiExecuteRequest } from '../shared/ai';
import { isDefiniteRejection } from '../shared/operation-errors';
import { ConversationWorkspace } from './components/conversation-workspace';
import { BookExtractionWorkspace } from './components/book-extraction-workspace';
import { GlobalKnowledgeWorkspace } from './components/global-knowledge-workspace';
import { GlobalBookExtractionWorkspace } from './components/global-book-extraction-workspace';
import { useGlobalKnowledge, useGlobalCompletionEntries } from './hooks/use-global-knowledge';
import type { GlobalWorkCopyRequest } from '../shared/global-work-copy';
import type { GlobalExtractionApi } from '../shared/global-book-extraction';
import type { GlobalEntryRef, GlobalKnowledgeEntry } from '../shared/global-knowledge';
import type { KnowledgeCompletion } from './lib/knowledge-completion';
import type { AiReviewState } from './components/ai-workspace';
import type { SavedWritingRequest } from './lib/writing-ai-selection';
import { AnimatePresence } from 'motion/react';
import { useMotionPreference } from './motion/motion-provider';
import { transitionPage } from './motion/page-transition';

function hasGlobalExtractionApi(api: DesktopApi): api is DesktopApi & GlobalExtractionApi {
  return typeof api.chooseGlobalBookExtraction === 'function' && typeof api.fetchGlobalWebExtraction === 'function'
    && typeof api.previewGlobalPastedExtraction === 'function' && typeof api.confirmGlobalBookExtraction === 'function'
    && typeof api.readGlobalExtractionDraft === 'function' && typeof api.saveGlobalExtractionReview === 'function'
    && typeof api.discardGlobalExtractionDraft === 'function' && typeof api.cancelGlobalBookExtraction === 'function'
    && typeof api.cancelGlobalWebExtraction === 'function';
}

export interface AppProps { api: DesktopApi; textbook?: Textbook }
type PendingOperation = { kind: 'structure'; request: StructureRequest } | { kind: 'addChapter'; workId: string; title: string; revision: number; operationId: string; volumeId: string | null; previousIds: string[] }
  | { kind: 'createSnapshot'; request: SnapshotCreateRequest } | { kind: 'restoreSnapshot'; request: SnapshotRestoreRequest } | { kind: 'copyKnowledge'; request: KnowledgeCopyRequest }
  | { kind: 'importManuscript'; request: { token: string; operationId: string; draft: ManuscriptDraft } }
  | { kind: 'importProjectArchive'; request: { token: string; operationId: string } }
  | { kind: 'applyAi'; request: { workId: string; candidateId: string; operationId: string } }
  | { kind: 'approveAi'; request: { workId: string; candidateId: string; operationId: string; items: AiKnowledgeApproval[] } }
  | { kind: 'freezeGlobal'; request: GlobalWorkCopyRequest };
const pageTitles: Record<Exclude<Page, 'work'>, string> = { shelf: '作品集', knowledge: '知识库', sessions: '需求会话', settings: '设置' };
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重试';
const validWritingReferenceIds = (work: WorkDetail, ids: string[]) => {
  const available = new Set(work.assets?.knowledge.filter(entry => !entry.deletedAt).map(entry => entry.id));
  return [...new Set(ids)].filter(id => available.has(id));
};

export default function App({ api, textbook }: AppProps) {
  const global = useGlobalKnowledge(api);
  const globalEntries = useGlobalCompletionEntries(api, global.page?.revision);
  const globalFlight = useRef<Promise<boolean> | null>(null);
  const author = useAuthorProfile(api);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<Page>('shelf');
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [location, setLocation] = useState<{ chapterId: string; paragraphId: string; token: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [importPreview, setImportPreview] = useState<{ token: string; draft: ManuscriptDraft } | null>(null);
  const [importEncoding, setImportEncoding] = useState<'utf-8' | 'gb18030'>('utf-8');
  const [archivePreview, setArchivePreview] = useState<{ token: string; filename: string; schemaVersion: number } | null>(null);
  const [aiCandidates, setAiCandidates] = useState<Record<string, AiCandidate>>({});
  const [aiReviews, setAiReviews] = useState<Record<string, AiReviewState>>({});
  const [writingReferences, setWritingReferences] = useState<Record<string, string[]>>({});
  const selectedReferenceIds = work ? validWritingReferenceIds(work, writingReferences[work.id] ?? []) : [];
  const toggleWritingReference = (id: string) => {
    if (!work || !validWritingReferenceIds(work, [id]).length) return;
    setWritingReferences(previous => {
      const ids = validWritingReferenceIds(work, previous[work.id] ?? []);
      return { ...previous, [work.id]: ids.includes(id) ? ids.filter(value => value !== id) : ids.length < 5 ? [...ids, id] : ids };
    });
  };
  const [writingSelections, setWritingSelections] = useState<Record<string, SavedWritingRequest | undefined>>({});
  const lastWritingChapter = useRef<Record<string, string>>({});
  useEffect(() => { if (work && chapterId) lastWritingChapter.current[work.id] = chapterId; }, [work?.id, chapterId]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const pendingRef = useRef<PendingOperation | null>(null);
  const pendingPage = useRef<Page>('shelf');
  const [recoveryReload, setRecoveryReload] = useState(0);
  const assetDirtyRef = useRef(false);
  const pendingAssetRef = useRef<AssetRequest | null>(null);
  const [pendingAsset, setPendingAsset] = useState<AssetRequest | null>(null);
  const [assetRecovery, setAssetRecovery] = useState({ workspace: 0, dictionary: 0, style: 0 });
  const [knowledgeScopeId, setKnowledgeScopeId] = useState<string>('global');
  const [knowledgeScope, setKnowledgeScope] = useState<KnowledgeScope | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeRetry, setKnowledgeRetry] = useState(0);
  const [knowledgeCopyPreview, setKnowledgeCopyPreview] = useState<KnowledgeCopyPreview | null>(null);
  const knowledgeCopyRef = useRef(knowledgeCopyPreview);
  knowledgeCopyRef.current = knowledgeCopyPreview;
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [bookExtraction, setBookExtraction] = useState(false);
  const [globalExtraction, setGlobalExtraction] = useState(false);
  const motion = useMotionPreference();
  const composingRef = useRef(false);
  const notifyAssetDirty = useCallback((dirty: boolean) => { assetDirtyRef.current = dirty; }, []);
  const operationInProgress = useRef(false);
  const activeOperation = useRef<Promise<void>>(Promise.resolve());
  const session = useWritingSession(api, work, chapterId, setWork, { beforeClose: async () => { await author.waitForPending(); if (globalFlight.current) await globalFlight.current; await activeOperation.current; if (pendingRef.current) throw new Error('结构操作结果待确认，请先重试结构操作'); if (pendingAssetRef.current) throw new Error('资产操作结果待确认，请先重试资产操作'); if (knowledgeCopyRef.current) throw new Error('知识复制尚未确认，请先确认或取消'); if (assetDirtyRef.current) throw new Error('资产编辑尚未保存，请先保存或放弃当前更改'); }, isBlocked: () => operationInProgress.current || !!pendingRef.current || !!pendingAssetRef.current || !!knowledgeCopyRef.current || assetDirtyRef.current });
  const locked = busy || session.closing || !!pending || !!pendingAsset;
  const worksGeneration = useRef(0);
  const loadWorks = useCallback(async (propagateError = false) => {
    const generation = ++worksGeneration.current;
    setLoading(true);
    setError(null);
    try { const result = await api.listWorks(); if (generation === worksGeneration.current) setWorks(result); }
    catch (reason) { setError(messageOf(reason)); if (propagateError) throw reason; }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void loadWorks(); }, [loadWorks]);
  useEffect(() => {
    if (page !== 'knowledge' || !work || knowledgeScopeId === 'global') return;
    const scopeId = knowledgeScopeId || work.id;
    let active = true;
    setKnowledgeScope(null); setKnowledgeError(null);
    void api.readKnowledgeScope(scopeId === 'all' ? null : scopeId).then(scope => { if (active) setKnowledgeScope(scope); }).catch(reason => { if (active) setKnowledgeError(messageOf(reason)); });
    return () => { active = false; };
  }, [api, page, work?.id, work?.revision, knowledgeScopeId, assetRecovery.workspace, knowledgeRetry]);

  async function guarded(action: () => Promise<void>, allowPending = false, allowAssetDirty = false): Promise<boolean> {
    if (globalFlight.current) await globalFlight.current;
    if (operationInProgress.current || session.isClosing() || ((pendingRef.current || pendingAssetRef.current) && !allowPending) || ((assetDirtyRef.current || knowledgeCopyRef.current) && !allowAssetDirty)) {
      if (knowledgeCopyRef.current && !allowAssetDirty) setError('请先确认或取消当前知识复制。');
      if (assetDirtyRef.current && !allowAssetDirty) setError('请先保存或放弃当前资产编辑。');
      return false;
    }
    operationInProgress.current = true;
    setBusy(true);
    setError(null);
    const operation = (async () => {
      try { if (!(allowPending && pendingRef.current?.kind === 'freezeGlobal')) await session.flush(); await action(); return true; }
      catch (reason) { setError(messageOf(reason)); return false; }
      finally { operationInProgress.current = false; setBusy(false); }
    })();
    activeOperation.current = operation.then(() => undefined);
    return operation;
  }
  function navigate(next: Page) {
    void guarded(async () => {
      if (next === 'shelf') await loadWorks(true);
       transitionPage(() => setPage(next), { reduced: motion.reduced, composing: composingRef.current });
      if (next !== 'work') setChapterId(null);
      else if (work) setChapterId(lastWritingChapter.current[work.id] ?? work.chapters[0]?.id ?? null);
    });
  }
  async function freezeGlobalEntries(entries: GlobalEntryRef[]): Promise<boolean> {
    if (!work || !api.freezeGlobalKnowledge || globalFlight.current || locked || pendingRef.current || assetDirtyRef.current) return false;
    const owner = work.id;
    const operation = session.withSavedState(async () => {
      const fresh = await api.openWork(owner);
      const request: GlobalWorkCopyRequest = { workId: owner, expectedRevision: fresh.revision, operationId: crypto.randomUUID(), entries };
      try { const updated = await api.freezeGlobalKnowledge!(request); session.acceptWork(updated); setWork(updated); return true; }
      catch (reason) { if (!isDefiniteRejection(reason)) { const retry: PendingOperation = { kind: 'freezeGlobal', request }; pendingRef.current = retry; setPending(retry); session.pauseForExternalOperation('知识复制结果待核实，请先重试知识复制再保存正文。'); } throw reason; }
    }).catch(reason => { setError(messageOf(reason)); return false; }).finally(() => { globalFlight.current = null; });
    globalFlight.current = operation;
    return operation;
  }
  async function acceptGlobalCompletion(candidate: KnowledgeCompletion): Promise<boolean> {
    return freezeGlobalEntries([{ entryId: candidate.knowledgeId, revision: candidate.revision }]);
  }
  async function useGlobalEntry(entry: GlobalKnowledgeEntry) {
    return freezeGlobalEntries([{ entryId: entry.id, revision: entry.revision }]);
  }
  function enterWork(detail: WorkDetail) {
    // 已落盘的新作品立即合入目录；晚到的旧目录请求不能抹掉它。
    worksGeneration.current += 1;
    setWorks(items => [{ id: detail.id, title: detail.title, chapterCount: detail.chapters.length, wordCount: detail.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), updatedAt: new Date().toISOString() }, ...items.filter(item => item.id !== detail.id)]);
    setWork(detail);
    setKnowledgeScope(null);
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
    void guarded(async () => {
      if (request.kind === 'structure') await applyStructure(request.request, pendingPage.current);
      else if (request.kind === 'addChapter') await applyAdd(request);
      else if (request.kind === 'importManuscript') await applyImport(request.request);
      else if (request.kind === 'importProjectArchive') await applyArchiveImport(request.request);
      else if (request.kind === 'applyAi' || request.kind === 'approveAi') await applyAiOperation(request);
      else if (request.kind === 'freezeGlobal') {
        if (!api.freezeGlobalKnowledge) throw new Error('全局知识复制接口不可用。');
        try { const updated = await api.freezeGlobalKnowledge(request.request); session.acceptWork(updated); setWork(updated); pendingRef.current = null; setPending(null); session.resumeExternalOperation(); }
        catch (reason) { if (isDefiniteRejection(reason)) { pendingRef.current = null; setPending(null); session.resumeExternalOperation(); } throw reason; }
      }
      else if (request.kind === 'copyKnowledge') {
        try { await applyVersionOperation(request); }
        catch (reason) { if (isDefiniteRejection(reason)) { pendingRef.current = null; setPending(null); } throw reason; }
      }
      else await applyVersionOperation(request);
    }, true, request.kind === 'copyKnowledge');
  }
  const structure = useStructureMenu(work, session.draft, manage, addChapter, locked);
  function retrySave() {
    if (operationInProgress.current || session.isClosing()) return;
    operationInProgress.current = true;
    setBusy(true);
    setError(null);
    activeOperation.current = session.retry().catch(() => { /* 失败原因由保存状态展示。 */ }).finally(() => { operationInProgress.current = false; setBusy(false); });
  }

  async function manageAsset(action: AssetAction): Promise<boolean> {
    if (!work) return false;
    return guarded(async () => {
      const fresh = await api.openWork(work.id);
      const request: AssetRequest = { workId: fresh.id, expectedRevision: fresh.revision, operationId: crypto.randomUUID(), action };
      try { await applyAsset(request); }
      catch (reason) { pendingAssetRef.current = request; setPendingAsset(request); throw reason; }
    }, false, true);
  }

  async function applyAsset(request: AssetRequest) {
    const updated = await api.manageAssets(request);
    session.acceptWork(updated); setWork(updated);
    pendingAssetRef.current = null; setPendingAsset(null);
  }

  function retryAsset() {
    const request = pendingAssetRef.current; if (!request) return;
    void guarded(async () => {
      await applyAsset(request);
      const group = request.action.type === 'publishStyle' || request.action.type === 'setChapterStyle' ? 'style' : 'dictionary';
      setAssetRecovery(value => ({ ...value, workspace: value.workspace + 1, [group]: value[group] + 1 }));
    }, true, true);
  }

  async function searchWork(query: AssetQuery): Promise<SearchResult[]> {
    if (!work) return [];
    return api.searchWork(work.id, query);
  }

  async function searchKnowledgeScope(query: AssetQuery): Promise<SearchResult[]> {
    const scopeId = knowledgeScopeId || work?.id;
    if (!scopeId) return [];
    return api.searchKnowledgeScope(scopeId === 'all' ? null : scopeId, query);
  }

  async function copyKnowledge(entryId: string): Promise<boolean> {
    const owner = knowledgeScope?.entryOwners[entryId];
    if (!owner || !work) return false;
    return guarded(async () => {
      const target = await api.openWork(work.id);
      const source = await api.readKnowledgeScope(owner.workId);
      setKnowledgeCopyPreview(prepareKnowledgeCopy(target, source, owner));
    }, false, true);
  }
  async function confirmKnowledgeCopy(categoryId: string, tagIds: string[]): Promise<boolean> {
    const preview = knowledgeCopyRef.current;
    if (!preview || !work || preview.targetWorkId !== work.id) return false;
    return guarded(async () => {
      const operation: PendingOperation & { kind: 'copyKnowledge' } = { kind: 'copyKnowledge', request: { workId: preview.targetWorkId, expectedRevision: preview.targetRevision, operationId: crypto.randomUUID(), sourceWorkId: preview.owner.workId, sourceEntryId: preview.owner.sourceEntryId, sourceExpectedRevision: preview.owner.sourceRevision, categoryId, tagIds } };
      try { await applyVersionOperation(operation); }
      catch (reason) { if (!isDefiniteRejection(reason)) { pendingRef.current = operation; setPending(operation); } throw reason; }
    }, false, true);
  }

  async function applyVersionOperation(operation: Extract<PendingOperation, { kind: 'createSnapshot' | 'restoreSnapshot' | 'copyKnowledge' }>) {
    const updated = operation.kind === 'createSnapshot' ? await api.createSnapshot(operation.request)
      : operation.kind === 'restoreSnapshot' ? await api.restoreSnapshot(operation.request) : await api.copyKnowledge(operation.request);
    session.acceptWork(updated, operation.kind === 'restoreSnapshot'); setWork(updated);
    pendingRef.current = null; setPending(null);
    if (operation.kind === 'restoreSnapshot') {
      setChapterId(previous => updated.chapters.some(chapter => chapter.id === previous) ? previous : updated.chapters[0]?.id ?? null);
      setLocation(null);
    }
    if (operation.kind === 'copyKnowledge') { setKnowledgeScopeId(updated.id); setKnowledgeScope(null); setKnowledgeCopyPreview(null); }
  }
  function manageSnapshot(kind: 'createSnapshot' | 'restoreSnapshot', value: string): Promise<boolean> {
    return guarded(async () => {
      if (!work) return;
      const fresh = await api.openWork(work.id);
      const mutation = { workId: fresh.id, expectedRevision: fresh.revision, operationId: crypto.randomUUID() };
      const operation: Extract<PendingOperation, { kind: 'createSnapshot' | 'restoreSnapshot' }> = kind === 'createSnapshot'
        ? { kind, request: { ...mutation, title: value } } : { kind, request: { ...mutation, snapshotId: value } };
      try { await applyVersionOperation(operation); }
      catch (reason) { pendingRef.current = operation; setPending(operation); throw reason; }
    });
  }
  const listSnapshots = useCallback(() => work ? api.listSnapshots(work.id) : Promise.resolve([]), [api, work?.id]);
  function chooseManuscript() { void guarded(async () => { setImportPreview(await api.chooseManuscript(importEncoding)); }); }
  async function applyImport(request: { token: string; operationId: string; draft: ManuscriptDraft }) {
    const imported = await api.confirmManuscript(request);
    pendingRef.current = null; setPending(null); setImportPreview(null); enterWork(imported);
  }
  function confirmManuscript(draft: ManuscriptDraft): Promise<boolean> {
    return guarded(async () => {
      if (!importPreview) throw new Error('请先选择手稿。');
      const request = { token: importPreview.token, operationId: crypto.randomUUID(), draft };
      try { await applyImport(request); }
      catch (reason) { const operation: PendingOperation = { kind: 'importManuscript', request }; pendingRef.current = operation; setPending(operation); throw reason; }
    });
  }
  function exportManuscript(format: 'txt' | 'docx', mode: 'clean' | 'full') { void guarded(async () => { if (work) await api.exportManuscript(work.id, format, undefined, mode); }); }
  async function exportSnapshot(snapshotId: string, format: 'txt' | 'docx', mode: 'clean' | 'full'): Promise<boolean> {
    let saved = false;
    const completed = await guarded(async () => { if (work) saved = await api.exportManuscript(work.id, format, snapshotId, mode); });
    return completed && saved;
  }
  function exportArchive() { void guarded(async () => { if (work) await api.exportProjectArchive(work.id); }); }
  function chooseArchive() { void guarded(async () => { setArchivePreview(await api.chooseProjectArchive()); }); }
  async function applyArchiveImport(request: { token: string; operationId: string }) {
    const imported = await api.confirmProjectArchive(request);
    pendingRef.current = null; setPending(null); setArchivePreview(null); enterWork(imported);
  }
  function confirmArchive(): Promise<boolean> {
    return guarded(async () => {
      if (!archivePreview) throw new Error('请先选择归档。');
      const request = { token: archivePreview.token, operationId: crypto.randomUUID() };
      try { await applyArchiveImport(request); }
      catch (reason) { const operation: PendingOperation = { kind: 'importProjectArchive', request }; pendingRef.current = operation; setPending(operation); throw reason; }
    });
  }
  async function prepareAi(request: Parameters<DesktopApi['prepareAi']>[0] extends infer R ? Omit<R, 'workId' | 'chapterId'> : never) {
    let prepared: Awaited<ReturnType<DesktopApi['prepareAi']>> | undefined;
    await guarded(async () => {
      if (!work || !chapterId) throw new Error('请先选择正文章节。');
      prepared = await api.prepareAi({ ...request, workId: work.id, chapterId });
    });
    if (!prepared) throw new Error('无法准备 AI 请求，请检查保存状态或模型配置。');
    return prepared;
  }
  async function executeAi(request: AiExecuteRequest) {
    // 云请求只返回候选，不占用本地写入锁；采用候选仍经过 guarded 和版本校验。
    const candidate = await api.executeAi(request);
    setAiCandidates(previous => ({ ...previous, [candidate.id]: candidate }));
    return candidate;
  }
  async function applyAiOperation(operation: Extract<PendingOperation, { kind: 'applyAi' | 'approveAi' }>) {
    const updated = operation.kind === 'applyAi' ? await api.applyAiCandidate(operation.request) : await api.approveAiKnowledge(operation.request);
    session.acceptWork(updated, operation.kind === 'applyAi'); setWork(updated); pendingRef.current = null; setPending(null);
  }
  function acceptAi(candidateId: string, items?: AiKnowledgeApproval[]): Promise<boolean> {
    return guarded(async () => {
      if (!work || !aiCandidates[candidateId]) throw new Error('请先生成候选。');
      const mutation = { workId: work.id, candidateId, operationId: crypto.randomUUID() };
      const operation: Extract<PendingOperation, { kind: 'applyAi' | 'approveAi' }> = items ? { kind: 'approveAi', request: { ...mutation, items } } : { kind: 'applyAi', request: mutation };
      try { await applyAiOperation(operation); }
      catch (reason) { if (!isDefiniteRejection(reason)) { pendingRef.current = operation; setPending(operation); } throw reason; }
    });
  }

  function locateChapter(targetChapterId: string, paragraphId?: string) {
    setChapterId(targetChapterId);
    setPage('work');
    setLocation(paragraphId ? { chapterId: targetChapterId, paragraphId, token: Date.now() } : null);
  }
  function locateKnowledge(kind: 'knowledge' | 'foreshadow', id: string) {
    if (kind !== 'knowledge' || !work) return;
    setKnowledgeScopeId(work.id); setKnowledgeScope(null); setSelectedKnowledgeId(id); setPage('knowledge'); setChapterId(null);
  }

  return <div className={`app ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
    <AnimatePresence>{knowledgeCopyPreview && <KnowledgeCopyDialog key="knowledge-copy" preview={knowledgeCopyPreview} busy={busy || session.closing} pending={pending?.kind === 'copyKnowledge'} onRetry={retryStructure} onConfirm={confirmKnowledgeCopy} onClose={() => setKnowledgeCopyPreview(null)} />}</AnimatePresence>
    <Sidebar author={author} locked={locked} expanded={expanded} page={page} onToggle={() => setExpanded((value) => !value)} onNavigate={navigate} />
    <main className="main">
      {session.closeError && !(page === 'work' && session.status.phase === 'failed') && <div className="page-error" role="alert">{session.closeError}</div>}
      {pendingAsset && <div className="page-error" role="alert"><span>资产操作结果待确认。请重试原请求，以免重复创建或覆盖。</span><button className="secondary" disabled={busy || session.closing} onClick={retryAsset}>重试资产操作</button></div>}
      {error && !(page === 'work' && session.status.phase === 'failed') && <div className="page-error" role="alert"><span>{error}</span>{pending ? <button className="secondary" disabled={busy || session.closing} onClick={retryStructure}>{pending.kind === 'createSnapshot' || pending.kind === 'restoreSnapshot' ? '重试快照操作' : pending.kind === 'applyAi' || pending.kind === 'approveAi' ? '重试 AI 写入' : pending.kind === 'copyKnowledge' ? '重试知识复制' : pending.kind === 'importManuscript' || pending.kind === 'importProjectArchive' ? '重试导入操作' : '重试结构操作'}</button> : page === 'shelf' && <button className="secondary" onClick={() => void loadWorks()}>重新加载</button>}</div>}
      {page === 'work' && work ? <WritingWorkspace globalEntries={globalEntries} onAcceptGlobal={acceptGlobalCompletion} savedSelection={writingSelections[work.id]} onSelectionChange={value => setWritingSelections(previous => ({ ...previous, [work.id]: value }))} key={work.id} onLocateAsset={locateKnowledge} ai={{ initialReview: aiReviews[work.id], onReviewChange: review => setAiReviews(previous => ({ ...previous, [work.id]: review })), selectedReferenceIds, onRetrieve: api.queryKnowledge, onPrepare: prepareAi, onExecute: executeAi, onCancel: api.cancelAi, onApply: candidateId => acceptAi(candidateId), onExtract: (candidateId, items) => acceptAi(candidateId, items) }} onBackup={exportArchive} onExport={exportManuscript} snapshots={{ onExport: exportSnapshot, onList: listSnapshots, onPreview: id => api.previewSnapshot(work.id, id), onCreate: title => manageSnapshot('createSnapshot', title), onRestore: id => manageSnapshot('restoreSnapshot', id) }} location={location} assetRecovery={assetRecovery.workspace} textbook={textbook} work={work} draft={session.draft} status={session.status} busy={locked} closing={session.closing} onCompositionChange={value => { composingRef.current = value; session.setComposing(value); }} onSelectChapter={(id) => void guarded(async () => { setChapterId(id); setSelectedVolumeId(work.chapters.find((chapter) => chapter.id === id)?.volumeId ?? null); })} onAddChapter={addChapter} onAddVolume={structure.addVolume} onSelectVolume={setSelectedVolumeId} onMenu={(target, event) => { if (target.kind === 'volume') setSelectedVolumeId(target.id); structure.showMenu(target, event); }} onTitleChange={session.updateTitle} onDocumentChange={session.updateDocument} onRetry={retrySave} onReturn={() => navigate('shelf')} changeTab={(action) => guarded(async () => action())} onError={setError} onAssetAction={manageAsset} onAssetDirtyChange={notifyAssetDirty} onLocate={locateChapter} /> : <>
        {page !== 'sessions' && <header className="topbar"><h1>{page === 'work' ? '作品集' : pageTitles[page]}</h1>{page === 'shelf' && <div className="header-actions"><SelectField aria-label="TXT 导入编码" value={importEncoding} disabled={locked} onChange={event => setImportEncoding(event.target.value as 'utf-8' | 'gb18030')}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></SelectField><button className="secondary" disabled={locked} onClick={chooseManuscript}>导入手稿</button><button className="secondary" disabled={locked} onClick={chooseArchive}>导入项目</button><button className="primary" onClick={() => { setCreateError(null); setShowCreate(true); }} disabled={locked}><Icon name="plus" />新建作品</button></div>}</header>}
        {page === 'shelf' && <section className="shelf" aria-label="作品书架">
          {loading ? <p role="status">正在读取本机作品…</p> : !error && <>
            <div className="shelf-count">{works.length} 部作品</div>
            {works.length === 0 ? <div className="empty-state"><span className="empty-mark" aria-hidden="true">◇</span><h2>还没有作品</h2><p>从一部新作品开始，把故事留在这里。</p></div> : <div className="books">{works.map((item) => <button key={item.id} className="book" data-work-id={item.id} aria-label={`打开作品：${item.title}`} disabled={locked} onClick={() => openWork(item.id)} onContextMenu={(event) => structure.showMenu({ kind: 'work', id: item.id, title: item.title }, event)} onKeyDown={(event) => { if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') structure.showMenu({ kind: 'work', id: item.id, title: item.title }, event); }}>
              <span className="book-mark" aria-hidden="true"><Icon name="books" /></span><strong>{item.title}</strong><span className="book-bottom"><span>{item.chapterCount} 章 · {item.wordCount} 字</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</time></span>
            </button>)}</div>}
          </>}
        </section>}
        {page === 'knowledge' && <>
          {!bookExtraction && !globalExtraction && <nav className="knowledge-scope-tabs" aria-label="知识库范围"><button disabled={locked} aria-pressed={knowledgeScopeId === 'global'} onClick={() => void guarded(async () => setKnowledgeScopeId('global'))}>全局知识库</button><button disabled={locked || !work} aria-pressed={knowledgeScopeId !== 'global'} onClick={() => void guarded(async () => { if (work) setKnowledgeScopeId(work.id); })}>作品知识库{work ? ` · ${work.title}` : ''}</button></nav>}
          {knowledgeScopeId === 'global' ? global.page ? globalExtraction && hasGlobalExtractionApi(api) ? <GlobalBookExtractionWorkspace page={global.page} api={api} onCommitted={global.accept} onClose={() => setGlobalExtraction(false)} onDirtyChange={notifyAssetDirty} /> : <GlobalKnowledgeWorkspace page={global.page} query={global.query} busy={global.busy || locked} loading={global.loading} error={global.error} onQuery={global.setQuery} onAction={global.mutate} onExtract={() => { void guarded(async () => { if (!hasGlobalExtractionApi(api)) throw new Error('当前版本未提供全局拆书接口。'); setGlobalExtraction(true); }); }} onSettings={() => navigate('settings')} onRetry={global.refresh} onDirtyChange={notifyAssetDirty} onUse={work ? useGlobalEntry : undefined} /> : <section className="placeholder"><h2>全局知识库</h2>{global.error ? <><p role="alert">{global.error}</p><button onClick={global.refresh}>重新加载</button></> : <p role="status">正在读取本机全局知识库…</p>}</section> : (bookExtraction && work ? <BookExtractionWorkspace key={work.id} work={work} api={api} onClose={() => setBookExtraction(false)} onDirtyChange={notifyAssetDirty} onCommitted={updated => { session.acceptWork(updated); setWork(updated); }} /> : work?.assets && knowledgeScope ? <KnowledgeWorkspace referenceIds={selectedReferenceIds} onToggleReference={toggleWritingReference} onReturnWriting={() => navigate('work')} onRetrieve={api.queryKnowledge} onBookExtraction={() => { void guarded(async () => setBookExtraction(true)); }} selectedEntryId={selectedKnowledgeId} key={`${assetRecovery.workspace}/${knowledgeScopeId}`} work={work} assets={{ ...work.assets, knowledge: knowledgeScope.knowledge, categories: knowledgeScope.categories, tags: knowledgeScope.tags }} busy={locked} onAction={manageAsset} onDirtyChange={notifyAssetDirty} onSearch={knowledgeScopeId && knowledgeScopeId !== work.id ? searchKnowledgeScope : searchWork} onLocate={(id, paragraph) => { void guarded(async () => locateChapter(id, paragraph)); }} scopeProps={{ works, scopeId: knowledgeScopeId || work.id, onScopeChange: setKnowledgeScopeId, canEdit: (knowledgeScopeId || work.id) === work.id, onCopy: copyKnowledge, entryOwners: knowledgeScope.entryOwners }} /> : work ? <section aria-label="知识库加载">{knowledgeError ? <><p role="alert">{knowledgeError}</p><button className="secondary" disabled={locked} onClick={() => setKnowledgeRetry(value => value + 1)}>重新加载知识库</button></> : <p role="status">正在读取本机知识库…</p>}</section> : <section className="placeholder" aria-label="选择知识库作品"><span className="placeholder-mark" aria-hidden="true">◇</span><h2>请先选择作品</h2><p>知识按作品保存。请从作品集中选择要查看或维护知识的作品。</p><button className="secondary" onClick={() => navigate('shelf')}>前往作品集选择作品</button></section>)}
        </>}
        {page === 'sessions' && <ConversationWorkspace key={work?.id ?? 'no-work'} work={work} works={works} api={api} externalBusy={locked} onDirtyChange={notifyAssetDirty} onOpenSettings={() => navigate('settings')} onSelectWork={id => { void guarded(async () => { const detail = await api.openWork(id); session.acceptWork(detail); setWork(detail); setChapterId(null); }); }} />}
        {page === 'settings' && <SettingsPage globalKnowledge={{ page: global.page, busy: global.busy, error: global.error, onAction: global.mutate, onAccept: global.accept }} assetRecovery={assetRecovery} author={author} api={api} currentWork={work} busy={locked} reload={recoveryReload} onAssetAction={manageAsset} onAssetDirtyChange={notifyAssetDirty} onSelect={(id) => { void guarded(async () => { const detail = await api.openWork(id); session.acceptWork(detail); setWork(detail); setChapterId(null); }); }} onRestore={manage} />}
      </>}
    </main>
    <AnimatePresence>{structure.menu && <ContextMenu key="structure-menu" state={structure.menu} onClose={structure.closeMenu} />}</AnimatePresence>
    <AnimatePresence>{structure.dialog && <StructureDialog key="structure-dialog" state={structure.dialog} busy={busy} onClose={structure.closeDialog} />}</AnimatePresence>
    <AnimatePresence>{showCreate && <CreateDialog key="create-work" busy={busy} error={createError} onClose={() => setShowCreate(false)} onCreate={(title) => void create(title)} />}</AnimatePresence>
    <AnimatePresence>{importPreview && <ManuscriptDialog key="import-manuscript" draft={importPreview.draft} busy={locked} error={error} onConfirm={confirmManuscript} onClose={() => setImportPreview(null)} />}</AnimatePresence>
    <AnimatePresence>{archivePreview && <StructureDialog key="import-archive" busy={locked} onClose={() => setArchivePreview(null)} state={{ heading: '导入项目归档', description: `${archivePreview.filename} · 格式 ${archivePreview.schemaVersion}。确认后校验数据库并导入为新作品，现有作品全部保留。`, submitLabel: '导入为新作品', onSubmit: confirmArchive }} />}</AnimatePresence>
  </div>;
}
