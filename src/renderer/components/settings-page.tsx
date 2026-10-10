import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetAction } from '../../shared/assets';
import type { RuntimeInfo } from '../../shared/contracts';
import { RecoveryPanel, type RecoveryPanelProps } from './recovery-panel';
import type { AuthorProfileController } from '../hooks/use-author-profile';
import { ProfileSettings } from './profile-settings';
import { KnowledgeDictionary } from './knowledge-dictionary';
import { StyleProfilePanel } from './style-profile-panel';
import { AiSettingsPanel } from './ai-settings-panel';
import type { AiProvider } from '../../shared/ai';
import type { RetrievalApi } from '../../shared/retrieval';
import { RetrievalModelPanel } from './retrieval-model-panel';
import './knowledge-workspace.css';
import './assets-workspace.css';

export function SettingsPage(props: RecoveryPanelProps & { api: RecoveryPanelProps['api'] & RetrievalApi; assetRecovery: {dictionary: number; style: number}; author?: AuthorProfileController; onAssetAction: (action: AssetAction) => Promise<boolean>; onAssetDirtyChange: (dirty: boolean) => void }) {
  const { api } = props;
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<{ provider: AiProvider | null; hasCredential: boolean } | null>(null);
  const dirty = useRef({ dictionary: false, style: false, ai: false, retrieval: false });
  const dirtyCallback = useRef(props.onAssetDirtyChange);
  dirtyCallback.current = props.onAssetDirtyChange;
  const dictionaryDirty = useCallback((value: boolean) => { dirty.current.dictionary = value; dirtyCallback.current(Object.values(dirty.current).some(Boolean)); }, []);
  const styleDirty = useCallback((value: boolean) => { dirty.current.style = value; dirtyCallback.current(Object.values(dirty.current).some(Boolean)); }, []);
  const aiDirty = useCallback((value: boolean) => { dirty.current.ai = value; dirtyCallback.current(Object.values(dirty.current).some(Boolean)); }, []);
  const retrievalDirty = useCallback((value: boolean) => { dirty.current.retrieval = value; dirtyCallback.current(Object.values(dirty.current).some(Boolean)); }, []);
  useEffect(() => {
    let active = true;
    void api.getRuntimeInfo().then((runtime) => { if (active) setInfo(runtime); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取运行信息'); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => { let active = true; void api.getAiSettings().then(value => { if (active) setAiSettings(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法读取模型配置'); }); return () => { active = false; }; }, [api]);
  return <section className="settings-page">
    {props.author && <ProfileSettings author={props.author} locked={props.busy} />}
    <div className="settings-group"><h2>本机数据</h2><dl><div><dt>应用版本</dt><dd>{info?.version ?? '正在读取…'}</dd></div><div><dt>作品数据目录</dt><dd className="data-directory">{info?.dataDirectory ?? '正在读取…'}</dd></div></dl>{error && <p role="alert">{error}</p>}</div>
    <div className="settings-group"><h2>写作保护</h2><p>自动保存始终开启：停止输入 500ms 后保存，持续输入最多 5 秒提交。保存失败时保留草稿并阻止离开或关闭。</p><p>正文固定为微软雅黑 12pt、1.5 倍行距；章节标题 16pt 加粗。</p></div>
    <RecoveryPanel {...props} />
    <RetrievalModelPanel api={api} busy={props.busy} workId={props.currentWork?.id ?? null} onBusyChange={retrievalDirty} />
    {props.currentWork?.assets && <div className="settings-group"><p>当前作品：{props.currentWork.title}</p><KnowledgeDictionary key={`${props.currentWork.id}/${props.assetRecovery.dictionary}`} assets={props.currentWork.assets} busy={props.busy} onAction={props.onAssetAction} onDirtyChange={dictionaryDirty} /><StyleProfilePanel key={`style-${props.currentWork.id}/${props.assetRecovery.style}`} work={props.currentWork} assets={props.currentWork.assets} busy={props.busy} onAction={props.onAssetAction} onDirtyChange={styleDirty} onLocate={() => undefined} /></div>}
    {aiSettings && <AiSettingsPanel value={aiSettings} busy={props.busy} onDirtyChange={aiDirty} onSave={async (provider, key) => { setAiSettings(await api.saveAiSettings(provider, key)); }} onClear={async () => { setAiSettings(await api.clearAiSettings()); }} />}
  </section>;
}
