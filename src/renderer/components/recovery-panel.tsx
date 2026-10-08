import { useEffect, useState } from 'react';
import type { DeletedWork, DesktopApi, StructureAction, WorkDetail, WorkSummary } from '../../shared/contracts';

export interface RecoveryPanelProps { api: DesktopApi; currentWork: WorkDetail | null; busy: boolean; reload: number; onSelect: (id: string) => void; onRestore: (id: string, action: StructureAction, revision?: number) => Promise<boolean> }

export function RecoveryPanel(props: RecoveryPanelProps) {
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [deleted, setDeleted] = useState<DeletedWork[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([props.api.listWorks(), props.api.listDeletedWorks()]).then(([items, removed]) => { if (active) { setWorks(items); setDeleted(removed); setError(null); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取已删除数据'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.api, props.reload, retry]);
  return <>
    <div className="settings-group"><h2>已删除作品</h2><p>删除的数据保留在本机，恢复后会重新显示在作品集中。</p>
      {error && <p role="alert">{error}<button className="secondary" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>重新读取</button></p>}
      {loading ? <p role="status">正在读取已删除数据…</p> : !error && (deleted.length ? <div className="recovery-list">{deleted.map((work) => <div role="group" aria-label={`已删除作品：${work.title}`} data-work-id={work.id} key={work.id} className="recovery-row"><span><strong>{work.title}</strong><small>{work.chapterCount} 章 · {work.wordCount} 字</small></span><button className="secondary" aria-label={`恢复作品：${work.title}`} disabled={props.busy} onClick={() => { void props.onRestore(work.id, { type: 'restoreWork' }, work.revision); }}>恢复</button></div>)}</div> : <p>暂无已删除作品</p>)}
    </div>
    <div className="settings-group"><h2>卷章恢复</h2><label className="recovery-select">作品<select aria-label="选择恢复作品" value={props.currentWork?.id ?? ''} disabled={props.busy} onChange={(event) => props.onSelect(event.target.value)}><option value="" disabled>选择一部作品</option>{works.map((work) => <option key={work.id} value={work.id}>{work.title}</option>)}</select></label>
      {props.currentWork && (props.currentWork.deletedItems.length ? <div className="recovery-list">{props.currentWork.deletedItems.map((item) => <div className="recovery-row" role="group" aria-label={`已删除${item.kind === 'volume' ? '分卷' : '章节'}：${item.title}`} key={`${item.kind}:${item.id}`}><span><strong>{item.title}</strong><small>{item.kind === 'volume' ? '分卷及其章节' : '章节'} · {new Date(item.deletedAt).toLocaleDateString('zh-CN')}</small></span><button className="secondary" disabled={props.busy} onClick={() => { void props.onRestore(props.currentWork!.id, item.kind === 'volume' ? { type: 'restoreVolume', volumeId: item.id } : { type: 'restoreChapter', chapterId: item.id }); }}>恢复</button></div>)}</div> : <p>这部作品暂无已删除的卷或章节</p>)}
    </div>
  </>;
}
