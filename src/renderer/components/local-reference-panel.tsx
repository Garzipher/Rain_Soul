import { useEffect, useRef, useState } from 'react';
import type { KnowledgeEntry } from '../../shared/assets';
import type { RetrievalQuery, RetrievalReply } from '../../shared/retrieval';
import { conciseKnowledgeSource } from '../../shared/knowledge-source';
import type { GlobalEntryRef } from '../../shared/global-knowledge';
import { SelectField } from './select-field';
import { KnowledgeLearningNotes } from './knowledge-learning-notes';
import { KnowledgeSourceVerification } from './knowledge-source-audit';
interface ReferenceChoice { key: string; library: 'work' | 'global'; id: string; revision: number; body: string; source: string }
export function LocalReferencePanel(props: {
  workId: string; revision: number; entries: KnowledgeEntry[]; busy: boolean;
  onRetrieve: (request: RetrievalQuery) => Promise<RetrievalReply>; onSelect: (ids: string[]) => void;
  onGlobalSelect?: (entries: GlobalEntryRef[]) => void;
  maxSelections?: number;
}) {
  const [text, setText] = useState(''), [results, setResults] = useState<ReferenceChoice[]>([]);
  const [scope, setScope] = useState<'work' | 'global' | 'combined'>('work');
  const [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const epoch = useRef(0), select = useRef(props.onSelect); select.current = props.onSelect;
  const globalSelect = useRef(props.onGlobalSelect); globalSelect.current = props.onGlobalSelect;
  const maximum = Math.max(0, Math.min(5, props.maxSelections ?? 5));
  useEffect(() => { epoch.current++; setResults([]); setSelected([]); setMessage(''); setPending(false); select.current([]); globalSelect.current?.([]); }, [props.workId, props.revision, scope]);
  useEffect(() => () => { epoch.current++; }, []);
  async function search() {
    if (pending || props.busy || !text.trim()) return;
    const generation = ++epoch.current, queryId = crypto.randomUUID(); setPending(true); setMessage(''); setResults([]); setSelected([]); select.current([]); globalSelect.current?.([]);
    try {
      const reply = await props.onRetrieve({ workId: scope === 'global' ? null : props.workId, scope: scope === 'global' ? { kind: 'global' } : { kind: scope, workId: props.workId }, queryId, query: text,
        mode: 'hybrid', tagIds: [], page: 1, pageSize: 5 });
      if (epoch.current !== generation) return;
      if (reply.queryId !== queryId) throw new Error('检索回执不匹配，请重新查找。');
      setResults(reply.hits.filter(hit => hit.reliable).flatMap((hit): ReferenceChoice[] => {
        if (hit.library === 'global') return props.onGlobalSelect && hit.entryRevision && scope !== 'work'
          ? [{ key: `global:${hit.entryId}`, library: 'global', id: hit.entryId, revision: hit.entryRevision, body: hit.excerpt, source: hit.source }] : [];
        if (hit.workId !== props.workId || scope === 'global') return [];
        const entry = props.entries.find(entry => entry.id === hit.entryId && !entry.deletedAt);
        return entry ? [{ key: `work:${entry.id}`, library: 'work', id: entry.id, revision: entry.revision, body: entry.body, source: entry.source }] : [];
      }));
      setMessage(reply.message ?? (reply.total ? '参考仅在本机查找，勾选后才加入云端请求预览。' : '没有可靠参考，可改写查询再试。'));
    } catch (error) { if (epoch.current === generation) setMessage(error instanceof Error ? error.message : '本机检索失败。'); }
    finally { if (epoch.current === generation) setPending(false); }
  }
  return <div>
    <p className="ai-muted">用一句话描述希望借鉴的描写或写法，作品与全局合计最多选用五条。本机检索不发送正文或知识到云端；全局参考只用于本次请求，不自动加入作品库。</p>
    {props.onGlobalSelect && <label>参考范围<SelectField aria-label="参考范围" value={scope} disabled={props.busy || pending} onChange={event => setScope(event.target.value as typeof scope)}><option value="work">当前作品</option><option value="global">全局知识库</option><option value="combined">当前作品＋全局</option></SelectField></label>}
    <label>本机参考查询<input aria-label="本机参考查询" value={text} maxLength={20000} disabled={props.busy || pending} onChange={event => setText(event.target.value)} /></label>
    <button className="secondary" disabled={props.busy || pending || !text.trim()} onClick={() => { void search(); }}>{pending ? '正在本机查找…' : '查找写作参考'}</button>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={props.busy || pending}><legend>选用参考 · 完整材料将在发送前预览</legend>{results.map(entry => <div key={entry.key}>
      <label><input type="checkbox" checked={selected.includes(entry.key)} disabled={!selected.includes(entry.key) && selected.length >= maximum} onChange={event => {
        const ids = event.target.checked ? [...selected, entry.key] : selected.filter(id => id !== entry.key); setSelected(ids);
        select.current(results.filter(item => item.library === 'work' && ids.includes(item.key)).map(item => item.id));
        globalSelect.current?.(results.filter(item => item.library === 'global' && ids.includes(item.key)).map(item => ({ entryId: item.id, revision: item.revision })));
      }} /><span>{entry.body}</span></label><small>{entry.library === 'global' ? `全局库 v${entry.revision} · ` : '当前作品 · '}{conciseKnowledgeSource(entry.source) || '未注明出处'}</small>
      {entry.library === 'work' && <KnowledgeLearningNotes notes={props.entries.find(item => item.id === entry.id)?.learningNotes ?? []} referenceAvailable={true} />}
      <KnowledgeSourceVerification source={entry.source} />
    </div>)}</fieldset>
  </div>;
}
