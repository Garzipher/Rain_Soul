import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '../../shared/contracts';
import type { GlobalKnowledgeAction, GlobalKnowledgeEntry, GlobalKnowledgeMutation, GlobalKnowledgePage, GlobalKnowledgeQuery } from '../../shared/global-knowledge';
import { isDefiniteRejection } from '../../shared/operation-errors';

/** 全局库单独加载和重试；其故障不锁住作品编辑器。 */
export function useGlobalKnowledge(api: DesktopApi) {
  const [page, setPage] = useState<GlobalKnowledgePage | null>(null);
  const [query, setQuery] = useState<GlobalKnowledgeQuery>({ limit: 20 });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [epoch, refresh] = useState(0);
  const pending = useRef<GlobalKnowledgeMutation | null>(null), lock = useRef(false);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      if (!api.readGlobalKnowledge) { setError('当前版本未提供全局知识库接口。'); setLoading(false); return; }
      void api.readGlobalKnowledge(query).then(value => { if (active) setPage(value); })
        .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '全局知识库暂不可用。'); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [api, query, epoch]);
  const accept = useCallback((value: GlobalKnowledgePage) => { setPage(value); refresh(count => count + 1); }, []);
  const mutate = useCallback(async (action: GlobalKnowledgeAction): Promise<boolean> => {
    if (lock.current || !page || !api.manageGlobalKnowledge) return false;
    if (pending.current && JSON.stringify(pending.current.action) !== JSON.stringify(action)) { setError('前一项保存结果尚未核实，请先重试原操作。'); return false; }
    const request = pending.current ?? { action, operationId: crypto.randomUUID(), expectedRevision: page.revision };
    lock.current = true; setBusy(true); setError('');
    try { pending.current = request; accept(await api.manageGlobalKnowledge(request)); pending.current = null; return true; }
    catch (reason) { if (isDefiniteRejection(reason)) pending.current = null; setError(reason instanceof Error ? reason.message : '保存结果待核实，请重试原操作。'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [api, page, accept]);
  return { page, query, setQuery, loading, busy, error, mutate, accept, hasPending: () => !!pending.current || lock.current, refresh: () => refresh(value => value + 1) };
}

/** 灰字读取完整的已审核库，不把当前分页或搜索结果误当成全部知识。 */
export function useGlobalCompletionEntries(api: DesktopApi, revision: number | undefined) {
  const [entries, setEntries] = useState<GlobalKnowledgeEntry[]>([]);
  useEffect(() => {
    let active = true;
    async function read() {
      if (!api.readGlobalKnowledge) return;
      const result: GlobalKnowledgeEntry[] = [];
      let offset = 0, expected: number | undefined;
      for (;;) {
        const page = await api.readGlobalKnowledge({ offset, limit: 100 });
        expected ??= page.revision;
        if (page.revision !== expected) throw new Error('全局知识已变化，等待下一次刷新。');
        result.push(...page.entries);
        offset += page.entries.length;
        if (offset >= page.total) break;
        if (!page.entries.length) throw new Error('全局知识分页不完整。');
      }
      if (active) setEntries(result);
    }
    void read().catch(() => { if (active) setEntries([]); });
    return () => { active = false; };
  }, [api, revision]);
  return entries;
}
