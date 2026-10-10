import type { RetrievalApi } from '../../shared/retrieval';
import type { RetrievalModelStatus } from '../../shared/retrieval-model';
import { useEffect, useRef, useState } from 'react';
export interface RetrievalModelPanelProps { api: RetrievalApi; busy: boolean; workId: string | null; onBusyChange?: (busy: boolean) => void }
export function RetrievalModelPanel(props: RetrievalModelPanelProps) {
  const [status, setStatus] = useState<RetrievalModelStatus | null>(null);
  const [running, setRunning] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true), lock = useRef(false), callback = useRef(props.onBusyChange);
  callback.current = props.onBusyChange;
  useEffect(() => {
    mounted.current = true; let active = true;
    void props.api.getRetrievalModelStatus?.().then(value => { if (active) setStatus(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法读取本机模型状态'); });
    return () => { active = false; mounted.current = false; callback.current?.(false); };
  }, [props.api]);
  async function operate(action: () => Promise<RetrievalModelStatus | void>) {
    if (props.busy || lock.current) return;
    lock.current = true; setRunning(true); callback.current?.(true); setError(null); setNotice(null);
    try { const value = await action(); if (mounted.current) { if (value) setStatus(value); else setNotice('索引重建完成'); } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '操作失败，请手动重试'); }
    finally { lock.current = false; if (mounted.current) { setRunning(false); callback.current?.(false); } }
  }
  const enabled = status?.state === 'ready', usable = !!status?.installed && !!status.qualified;
  const labels = { absent: '未安装', installing: '正在导入', ready: '已启用', disabled: '已停用', error: '不可用' };
  return <div className="settings-group" aria-label="本机知识检索模型"><h2>本机知识检索</h2>
    <p>知识文本在本机生成向量。关键词检索始终可用。</p>
    <p role="status">{status ? labels[status.state] : props.api.getRetrievalModelStatus ? '正在读取模型状态…' : '模型管理不可用'}</p>
    {status?.message && <p>{status.message}</p>}
    {status?.installed && !status.qualified && <p>模型尚未通过质量验收，暂不能启用语义检索。</p>}
    {!props.api.getRetrievalModelStatus && <p>当前运行环境未提供本机模型管理。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="knowledge-form-actions">
      <button className="secondary" disabled={props.busy || running || !props.api.importRetrievalModel} onClick={() => void operate(() => props.api.importRetrievalModel!())}>导入本机模型目录</button>
      <button className="secondary" disabled={props.busy || running || !props.api.setRetrievalModelEnabled || (!enabled && !usable)} onClick={() => void operate(() => props.api.setRetrievalModelEnabled!(!enabled))}>{enabled ? '停用语义检索' : '启用语义检索'}</button>
      <button className="secondary" disabled={props.busy || running || !enabled || !props.workId || !props.api.rebuildKnowledgeIndex} onClick={() => void operate(() => props.api.rebuildKnowledgeIndex!(props.workId))}>重建当前作品索引</button>
    </div>{running && <p role="status">正在处理，请稍候…</p>}
  </div>;
}
