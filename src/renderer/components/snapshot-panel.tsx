import { useCallback, useEffect, useState } from 'react';
import type { SnapshotPreview, SnapshotSummary } from '../../shared/snapshots';
import { StructureDialog } from './structure-dialog';
import './snapshot-panel.css';

export interface SnapshotPanelProps {
  busy: boolean;
  revision: number;
  onList: () => Promise<SnapshotSummary[]>;
  onPreview: (id: string) => Promise<SnapshotPreview>;
  onCreate: (title: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
  onExport?: (id: string, format: 'txt' | 'docx') => Promise<boolean>;
}

export function SnapshotPanel({ busy, revision, onList, onPreview, onCreate, onRestore, onExport }: SnapshotPanelProps) {
  const [items, setItems] = useState<SnapshotSummary[]>([]);
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<SnapshotPreview | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const locked = busy || working;
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await onList()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '快照列表读取失败'); }
    finally { setLoading(false); }
  }, [onList]);
  useEffect(() => { void refresh(); }, [refresh, revision]);
  async function create() {
    if (locked || !title.trim()) return;
    setWorking(true); setError(null);
    try { if (await onCreate(title.trim())) { setTitle(''); await refresh(); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : '创建快照失败'); }
    finally { setWorking(false); }
  }
  async function inspect(id: string) {
    if (locked) return;
    setWorking(true); setPreview(null); setError(null);
    try { setPreview(await onPreview(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '快照预览失败'); }
    finally { setWorking(false); }
  }
  async function exportHistory(id: string, format: 'txt' | 'docx') {
    if (locked || !onExport) return;
    setWorking(true); setError(null);
    try { await onExport(id, format); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '历史快照导出失败，请选择新位置或重试。'); }
    finally { setWorking(false); }
  }
  return <section className="snapshot-panel" aria-label="版本快照">
    <div className="asset-heading"><div><h2>版本快照</h2><p>每次恢复都会保留当前状态和全部历史，再建立新版本。</p></div><button className="secondary" disabled={locked} onClick={() => void refresh()}>刷新列表</button></div>
    {error && <p className="page-error" role="alert">{error}</p>}
    <form className="snapshot-create" onSubmit={event => { event.preventDefault(); void create(); }}>
      <label htmlFor="snapshot-title">快照名称</label><input id="snapshot-title" value={title} maxLength={200} disabled={locked} onChange={event => setTitle(event.target.value)} placeholder="例如：修改之前" />
      <button className="primary" disabled={locked || !title.trim()}>创建快照</button>
    </form>
    {loading ? <p role="status">正在读取快照…</p> : <div className="snapshot-list">{items.length === 0 ? <p>还没有快照。可以在重要修改之前保存一份。</p> : items.map(item => <article key={item.id} className="snapshot-row">
      <div><strong>{item.title}</strong><p>{item.kind === 'manual' ? '手动快照' : '安全快照'} · 源版本 {item.sourceRevision} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN')}</time></p></div>
      <div className="asset-buttons">{onExport && <><button className="secondary" disabled={locked} aria-label={`导出快照 TXT：${item.title}`} onClick={() => void exportHistory(item.id, 'txt')}>导出 TXT</button><button className="secondary" disabled={locked} aria-label={`导出快照 DOCX：${item.title}`} onClick={() => void exportHistory(item.id, 'docx')}>导出 DOCX</button></>}<button className="secondary" disabled={locked} aria-label={`预览并恢复：${item.title}`} onClick={() => void inspect(item.id)}>预览并恢复</button></div>
    </article>)}</div>}
    {preview && <section className="snapshot-preview" aria-label="恢复预览"><h3>{preview.summary.title}</h3><p>{preview.title} · {preview.volumeCount} 卷 · {preview.chapterCount} 章 · {preview.wordCount} 字 · {preview.knowledgeCount} 条知识 · {preview.foreshadowCount} 项伏笔</p>
      <ul>{preview.chapters.map(chapter => <li key={chapter.id}>{chapter.title}<span> · {chapter.wordCount} 字</span></li>)}</ul>
      <div className="dialog-actions"><button className="secondary" disabled={locked} onClick={() => setPreview(null)}>取消</button><button className="primary" disabled={locked} onClick={() => setConfirm(true)}>恢复为新版本</button></div>
    </section>}
    {confirm && preview && <StructureDialog busy={locked} onClose={() => setConfirm(false)} state={{ heading: '确认恢复快照', description: '将先保存当前状态，再恢复为新版本。现有历史不会被删除。', submitLabel: '确认恢复', onSubmit: async () => { const success = await onRestore(preview.summary.id); if (success) { setPreview(null); await refresh(); } return success; } }} />}
  </section>;
}
