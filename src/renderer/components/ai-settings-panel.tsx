import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AiProvider } from '../../shared/ai';
import './ai-workspace.css';
export interface AiSettingsPanelProps { value: { provider: AiProvider | null; hasCredential: boolean }; onSave: (provider: AiProvider, key?: string) => Promise<void>; onClear: () => Promise<void>; busy: boolean; onDirtyChange?: (dirty: boolean) => void }
export function AiSettingsPanel(props: AiSettingsPanelProps) {
  const [provider, setProvider] = useState<AiProvider>(() => props.value.provider ?? { id: crypto.randomUUID(), name: '', baseUrl: '', model: '' });
  const [key, setKey] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [baseline, setBaseline] = useState(() => JSON.stringify(provider));
  const dirtyCallback = useRef(props.onDirtyChange); dirtyCallback.current = props.onDirtyChange;
  const dirty = pending || !!key || JSON.stringify(provider) !== baseline;
  // 在成功提示可交互前同步离开门禁，避免被上一帧的保存状态误拦。
  useLayoutEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  const lock = useRef(false), disabled = props.busy || pending;
  async function execute(clear = false) {
    if (disabled || lock.current) return;
    lock.current = true; setPending(true); setError(''); setNotice('');
    try {
      if (clear) { await props.onClear(); const empty = { id: crypto.randomUUID(), name: '', baseUrl: '', model: '' }; setProvider(empty); setBaseline(JSON.stringify(empty)); setKey(''); setNotice('云端模型配置已清除。'); }
      else { await props.onSave(provider, key || undefined); setBaseline(JSON.stringify(provider)); setKey(''); setNotice('云端模型配置已保存，密钥不会在界面回显。'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '模型配置失败，请重试。'); }
    finally { lock.current = false; setPending(false); }
  }
  return <section className="ai-settings settings-group"><h2>云端模型</h2><p className="ai-muted">会话点击发送即使用当前服务；正文写作与拆书显示发送范围后确认。密钥仅保存在本机安全存储中。</p><form onSubmit={event => { event.preventDefault(); void execute(); }}>
    <label className="ai-enable"><span>启用云端 AI</span><input aria-label="启用云端 AI" type="checkbox" checked={provider.enabled !== false} disabled={disabled} onChange={event => setProvider({ ...provider, enabled: event.target.checked })} /><small>关闭后保留服务和密钥，保存配置后生效。</small></label>
    <label>服务名称<input aria-label="服务名称" value={provider.name} disabled={disabled} required onChange={event => setProvider({ ...provider, name: event.target.value })} /></label>
    <label>服务地址<input aria-label="服务地址" type="url" placeholder="https://api.example.com/v1" value={provider.baseUrl} disabled={disabled} required onChange={event => setProvider({ ...provider, baseUrl: event.target.value })} /></label>
    <label>模型名称<input aria-label="模型名称" value={provider.model} disabled={disabled} required onChange={event => setProvider({ ...provider, model: event.target.value })} /></label>
    <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={key} disabled={disabled} onChange={event => setKey(event.target.value)} placeholder={props.value.hasCredential ? '已保存；留空保留原密钥' : '输入服务密钥'} /></label>
    <label>模型上下文容量<input aria-label="模型上下文容量" type="number" min="1024" max="2000000" value={provider.contextWindowTokens ?? ''} disabled={disabled} onChange={event => setProvider({ ...provider, contextWindowTokens: event.target.value ? Number(event.target.value) : undefined })} /></label>
    <label>计费说明<textarea aria-label="计费说明" value={provider.billingHint ?? ''} disabled={disabled} onChange={event => setProvider({ ...provider, billingHint: event.target.value })} /></label>
    <div className="ai-settings-actions"><button className="primary" disabled={disabled || !provider.name.trim() || !provider.baseUrl.trim() || !provider.model.trim()}>保存云端模型配置</button><button className="secondary" type="button" disabled={disabled} onClick={() => void execute(true)}>清除云端模型配置</button><button className="secondary" type="button" disabled={disabled || !dirty} onClick={() => { setProvider(JSON.parse(baseline) as AiProvider); setKey(''); setError(''); setNotice('已放弃未保存的模型设置更改。'); }}>放弃模型设置更改</button></div>
  </form>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</section>;
}
