import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chapter, DesktopApi, WorkDetail, WritingDocument } from '../../shared/contracts';
import { SaveCoordinator, SaveValidationError, type SaveStatus } from '../lib/save-coordinator';

interface Draft extends Chapter { workId: string; operationId: string }

/** 将作者草稿与已持久化版本分开；保存回执只更新已保存内容。 */
export function useWritingSession(api: DesktopApi, work: WorkDetail | null, chapterId: string | null, onSaved: (work: WorkDetail) => void, operations: { beforeClose: () => Promise<void>; isBlocked: () => boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ phase: 'clean', error: null });
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [resetGeneration, setResetGeneration] = useState(0);
  const closingRef = useRef(false);
  const composing = useRef(false);
  const coordinator = useRef<SaveCoordinator<Draft> | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const workRef = useRef(work);
  const onSavedRef = useRef(onSaved);
  const operationsRef = useRef(operations);
  const revision = useRef(work?.revision ?? 0);
  workRef.current = work;
  onSavedRef.current = onSaved;
  operationsRef.current = operations;

  useEffect(() => {
    const currentWork = workRef.current;
    const chapter = currentWork?.chapters.find((item) => item.id === chapterId);
    setStatus({ phase: 'clean', error: null });
    if (!currentWork || !chapter) {
      draftRef.current = null;
      setDraft(null);
      return;
    }
    revision.current = currentWork.revision;
    const initial = { ...structuredClone(chapter), workId: currentWork.id, operationId: crypto.randomUUID() };
    draftRef.current = initial;
    setDraft(initial);
    const expectedRevisions = new WeakMap<Draft, number>();
    const saver = new SaveCoordinator<Draft>({
      onStatusChange: setStatus,
      save: async (snapshot) => {
        if (!snapshot.title.trim()) throw new SaveValidationError('章节标题不能为空');
        const expectedRevision = expectedRevisions.get(snapshot) ?? revision.current;
        expectedRevisions.set(snapshot, expectedRevision);
        const result = await api.saveChapter(snapshot.workId, snapshot.id, snapshot.title, snapshot.document, expectedRevision, snapshot.operationId);
        revision.current = result.revision;
        const savedWork = workRef.current;
        if (savedWork?.id !== snapshot.workId) return;
        const updated = {
          ...savedWork,
          revision: result.revision,
          assets: result.assets ?? savedWork.assets,
          chapters: savedWork.chapters.map((item) => item.id === snapshot.id ? { ...item, title: snapshot.title, document: snapshot.document, wordCount: result.wordCount } : item),
        };
        workRef.current = updated;
        onSavedRef.current(updated);
      },
    });
    coordinator.current = saver;
    return () => { saver.dispose(); coordinator.current = null; };
  }, [api, work?.id, chapterId, resetGeneration]);

  const update = useCallback((changes: Partial<Pick<Draft, 'title' | 'document'>>) => {
    if (!draftRef.current || closingRef.current || operationsRef.current.isBlocked()) return;
    const next = { ...draftRef.current, ...changes, operationId: crypto.randomUUID() };
    draftRef.current = next;
    setDraft(next);
    coordinator.current?.update(next);
  }, []);
  const flush = useCallback(async () => {
    if (composing.current) throw new Error('输入法正在组词，请先确认输入后再操作');
    await coordinator.current?.flush();
  }, []);
  const acceptWork = useCallback((detail: WorkDetail, resetDraft = false) => {
    workRef.current = detail; revision.current = detail.revision;
    if (resetDraft) { setResetGeneration(value => value + 1); return; }
    const currentDraft = draftRef.current;
    const chapter = detail.chapters.find((item) => item.id === currentDraft?.id);
    if (currentDraft && chapter && currentDraft.volumeId !== chapter.volumeId) { const next = { ...currentDraft, volumeId: chapter.volumeId }; draftRef.current = next; setDraft(next); }
  }, []);
  const retry = useCallback(async () => { await coordinator.current?.retry(); }, []);
  useEffect(() => api.onCloseRequested(async () => {
    if (composing.current) {
      const message = '输入法正在组词，请先确认输入后再关闭';
      setCloseError(message);
      throw new Error(message);
    }
    closingRef.current = true;
    setClosing(true);
    setCloseError(null);
    try { await operationsRef.current.beforeClose(); await coordinator.current?.flush(); }
    catch (reason) { closingRef.current = false; setClosing(false); setCloseError(reason instanceof Error ? reason.message : '关闭前保存失败，请保留当前窗口'); throw reason; }
  }), [api]);
  const setComposing = (value: boolean) => { composing.current = value; if (!value) setCloseError(null); };

  return { draft, status, flush, retry, acceptWork, closing, closeError, isClosing: () => closingRef.current, setComposing, updateTitle: (title: string) => update({ title }), updateDocument: (document: WritingDocument) => update({ document }) };
}
