import type { RetrievalApi } from '../../shared/retrieval';
import { fixedManifest, type RetrievalModelStatus } from '../../shared/retrieval-model';
import { useEffect, useRef, useState } from 'react';
export interface RetrievalModelPanelProps { api: RetrievalApi; busy: boolean; workId: string | null; onBusyChange?: (busy: boolean) => void }
export function RetrievalModelPanel(props: RetrievalModelPanelProps) {
  const [status, setStatus] = useState<RetrievalModelStatus | null>(null);
  const [running, setRunning] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [installId, setInstallId] = useState<string | null>(null), [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true), lock = useRef(false), callback = useRef(props.onBusyChange);
  const activeInstall = useRef<string | null>(null);
  callback.current = props.onBusyChange;
  useEffect(() => {
    mounted.current = true; let active = true;
    void props.api.getRetrievalModelStatus?.().then(value => { if (active && !lock.current) setStatus(value); }).catch(reason => { if (active && !lock.current) setError(reason instanceof Error ? reason.message : '无法读取本机模型状态'); });
    return () => { active = false; mounted.current = false; activeInstall.current = null; callback.current?.(false); };
  }, [props.api]);
  useEffect(() => {
    if (!installId || !props.api.getRetrievalModelStatus) return;
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await props.api.getRetrievalModelStatus!();
        if (active && activeInstall.current === installId && value.progress?.operationId === installId) setStatus(value);
      } catch { /* 安装结果由命令回执确定，进度查询失败不终止安装。 */ }
      if (active && activeInstall.current === installId) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [installId, props.api]);
  async function operate(action: () => Promise<RetrievalModelStatus | void>, operationId: string | null = null) {
    if (props.busy || lock.current) return;
    const previousStatus = status;
    lock.current = true; setRunning(true); callback.current?.(true); setError(null); setNotice(null);
    activeInstall.current = operationId; setInstallId(operationId);
    try { const value = await action(); if (mounted.current) { if (value) setStatus(value); else setNotice('索引重建完成'); } }
    catch (reason) { if (mounted.current) { setStatus(previousStatus); setError(reason instanceof Error ? reason.message : '操作失败，请手动重试'); } }
    finally { lock.current = false; activeInstall.current = null; if (mounted.current) { setRunning(false); setInstallId(null); setCancelling(false); callback.current?.(false); } }
  }
  async function cancelInstall() {
    if (!installId || cancelling || !props.api.cancelRetrievalModelInstall) return;
    const operationId = installId; setCancelling(true);
    try { await props.api.cancelRetrievalModelInstall({ operationId }); }
    catch (reason) { if (mounted.current && activeInstall.current === operationId) setError(reason instanceof Error ? reason.message : '取消失败，请重试'); }
    finally { if (mounted.current && activeInstall.current === operationId) setCancelling(false); }
  }
  const usable = !!status?.installed && !!status.qualified && status.state !== 'error';
  const enabled = status?.enabled ?? (status?.state === 'ready' && usable);
  const active = enabled && usable && status?.state === 'ready';
  const bytes = status?.bytes && status.bytes > 0 ? status.bytes : fixedManifest.files.reduce((sum, file) => sum + file.bytes, 0);
  const size = (value: number) => `${(value / 1024 ** 2).toFixed(2)} MiB（${value.toLocaleString('zh-CN')} 字节）`;
  const labels = { absent: '未安装', installing: '正在安装', ready: '已启用', disabled: '已停用', error: '不可用' };
  const progress = installId && status?.progress?.operationId === installId ? status.progress : null;
  const phases = { 'checking-space': '检查磁盘空间', downloading: '下载模型文件', copying: '复制本机模型文件', verifying: '核对文件完整性', activating: '安装到本机目录' };
  const summary = !status ? props.api.getRetrievalModelStatus ? '正在读取模型状态…' : '模型管理不可用'
    : status.state === 'installing' ? labels.installing
    : status.source === 'bundled' && status.installed && !status.qualified ? '内置模型待验收，当前使用关键词'
    : status.installed && !status.qualified ? '已安装，资格待核验' : labels[status.state];
  return <div className="settings-group" aria-label="本机知识检索模型"><h2>本机知识检索</h2>
    <p>模型可用时，知识文本在本机生成向量。关键词检索始终可用。</p>
    <dl><div><dt>模型</dt><dd>{fixedManifest.modelId}</dd></div><div><dt>固定修订</dt><dd>{fixedManifest.revision.slice(0, 12)}</dd></div><div><dt>许可与来源</dt><dd><a href={fixedManifest.licenseUrl} target="_blank" rel="noreferrer">MIT 许可证</a> · <a href={`https://huggingface.co/${fixedManifest.repository}/tree/${fixedManifest.revision}`} target="_blank" rel="noreferrer">固定版本来源</a></dd></div><div><dt>模型文件总量</dt><dd>{size(bytes)}</dd></div><div><dt>手动修复空间估算</dt><dd>下载或导入时，临时目录新增约 {size(bytes)}，已有手动副本另外占用空间。离线来源目录与向量缓存另计，可用磁盘空间尚未测量。</dd></div>
      {status && <><div><dt>当前来源</dt><dd>{status.source === 'bundled' ? '内置来源' : status.source === 'user' ? '手动副本' : '来源尚未读取'}</dd></div>
        <div><dt>文件状态</dt><dd>{status.installed ? '文件校验通过' : status.state === 'error' ? '文件或选择记录校验失败' : '当前来源文件不可用'}</dd></div>
        <div><dt>资格状态</dt><dd>{status.qualified ? '资格核验通过' : '资格待核验'}</dd></div>
        <div><dt>启用偏好</dt><dd>{status.enabled === undefined ? '启用偏好尚未读取' : enabled ? '偏好开启' : '偏好停用'}</dd></div>
        <div><dt>实际检索模式</dt><dd>{active ? '语义检索可用' : '当前使用关键词'}</dd></div>
        <div><dt>索引状态</dt><dd>{notice === '索引重建完成' ? '当前作品索引重建完成' : active ? '索引状态未读取，查询时显示进度' : '语义索引未启用'}</dd></div></>}
    </dl>
    <p role="status">{summary}</p>
    {status?.bundledPresent === false && <p>本构建未捆绑模型</p>}
    {status?.source === 'bundled' && status.installed && <p>内置模型直接读取安装资源，无需重新下载，也不复制到用户目录。</p>}
    {status?.legacyDisabled && <p>保留旧禁用记录：旧版本可能因资格未通过自动停用，当前保留原偏好；资格通过后可由你明确启用。</p>}
    {status?.requiredSpaceBytes !== undefined && <p>手动下载或导入所需新增空间：{size(status.requiredSpaceBytes)}；{status.availableSpaceBytes === undefined ? '可用磁盘空间尚未测量' : `实测可用空间：${size(status.availableSpaceBytes)}`}。</p>}
    {progress && <div aria-live="polite"><p>{phases[progress.phase]}</p>{progress.file && <p>{progress.file}</p>}<progress aria-label="模型安装进度" max={Math.max(1, progress.totalBytes)} value={Math.min(progress.receivedBytes, progress.totalBytes)} /><p>{size(progress.receivedBytes)} / {size(progress.totalBytes)}</p></div>}
    {status?.message && <p>{status.message}</p>}
    {status?.installed && !status.qualified && <p>模型资格核验尚未全部完成，暂不能使用语义检索。</p>}
    {!props.api.getRetrievalModelStatus && <p>当前运行环境未提供本机模型管理。</p>}
    <p>{props.api.cancelRetrievalModelInstall ? '下载和目录导入均可取消，校验通过前不替换现有模型。' : '取消导入尚未接入：目录选择框可取消；确认目录后，本次导入完成或失败再继续操作。'}</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="knowledge-form-actions">
      {props.api.selectRetrievalModelSource && <>
        <button className="secondary" disabled={props.busy || running || !status?.bundledPresent || status.source === 'bundled'} onClick={() => void operate(() => props.api.selectRetrievalModelSource!({ source: 'bundled' }))}>改用内置模型</button>
        <button className="secondary" disabled={props.busy || running || !status || !status.source || status.source === 'user'} onClick={() => void operate(() => props.api.selectRetrievalModelSource!({ source: 'user' }))}>改用手动副本</button>
      </>}
      <button className="secondary" disabled={props.busy || running || !props.api.downloadRetrievalModel} onClick={() => { const operationId = crypto.randomUUID(); void operate(() => props.api.downloadRetrievalModel!({ operationId }), operationId); }}>下载固定版本模型</button>
      <button className="secondary" disabled={props.busy || running || !props.api.importRetrievalModel} onClick={() => { const operationId = crypto.randomUUID(); void operate(() => props.api.importRetrievalModel!({ operationId }), operationId); }}>导入本机模型目录</button>
      {installId && props.api.cancelRetrievalModelInstall && <button className="secondary" disabled={cancelling} onClick={() => void cancelInstall()}>{cancelling ? '正在取消…' : '取消模型安装'}</button>}
      <button className="secondary" disabled={props.busy || running || !props.api.setRetrievalModelEnabled || (!enabled && !usable)} onClick={() => void operate(() => props.api.setRetrievalModelEnabled!(!enabled))}>{enabled ? '停用语义检索' : '启用语义检索'}</button>
      <button className="secondary" disabled={props.busy || running || !active || !props.workId || !props.api.rebuildKnowledgeIndex} onClick={() => void operate(() => props.api.rebuildKnowledgeIndex!(props.workId))}>重建当前作品索引</button>
    </div>{running && <p role="status">正在处理，请稍候…</p>}
  </div>;
}
