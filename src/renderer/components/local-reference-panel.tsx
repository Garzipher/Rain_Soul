import { useEffect, useRef, useState } from 'react';
import type { KnowledgeEntry } from '../../shared/assets';
import type { RetrievalQuery, RetrievalReply } from '../../shared/retrieval';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
export function LocalReferencePanel(props: {
  workId: string; revision: number; entries: KnowledgeEntry[]; busy: boolean;
  onRetrieve: (request: RetrievalQuery) => Promise<RetrievalReply>; onSelect: (ids: string[]) => void;
}) {
  const [text, setText] = useState(''), [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const epoch = useRef(0), select = useRef(props.onSelect); select.current = props.onSelect;
  useEffect(() => { epoch.current++; setResults([]); setSelected([]); setMessage(''); setPending(false); select.current([]); }, [props.workId, props.revision]);
  useEffect(() => () => { epoch.current++; }, []);
  async function search() {
    if (pending || props.busy || !text.trim()) return;
    const generation = ++epoch.current, queryId = crypto.randomUUID(); setPending(true); setMessage(''); setResults([]); setSelected([]); select.current([]);
    try {
      const reply = await props.onRetrieve({ workId: props.workId, queryId, query: text,
        mode: 'hybrid', tagIds: [], page: 1, pageSize: 5 });
      if (epoch.current !== generation) return;
      if (reply.queryId !== queryId) throw new Error('检索回执不匹配，请重新查找。');
      setResults(reply.hits.filter(hit => hit.workId === props.workId && hit.reliable).flatMap(hit => {
        const entry = props.entries.find(entry => entry.id === hit.entryId && !entry.deletedAt); return entry ? [entry] : [];
      }));
      setMessage(reply.message ?? (reply.total ? '参考仅在本机查找，勾选后才加入云端请求预览。' : '没有可靠参考，可改写查询再试。'));
    } catch (error) { if (epoch.current === generation) setMessage(error instanceof Error ? error.message : '本机检索失败。'); }
    finally { if (epoch.current === generation) setPending(false); }
  }
  return <div>
    <p className="ai-muted">用一句话描述希望借鉴的描写或写法，最多推荐五条。本机检索不发送正文或知识到云端。</p>
    <label>本机参考查询<input aria-label="本机参考查询" value={text} maxLength={20000} disabled={props.busy || pending} onChange={event => setText(event.target.value)} /></label>
    <button className="secondary" disabled={props.busy || pending || !text.trim()} onClick={() => { void search(); }}>{pending ? '正在本机查找…' : '查找写作参考'}</button>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={props.busy || pending}><legend>选用参考</legend>{results.map(entry => <div key={entry.id}>
      <label><input type="checkbox" checked={selected.includes(entry.id)} onChange={event => {
        const ids = event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id); setSelected(ids); select.current(ids);
      }} /><span>{entry.body}</span></label><small>{readableKnowledgeSource(entry.source) || '未注明出处'}</small>
    </div>)}</fieldset>
  </div>;
}
