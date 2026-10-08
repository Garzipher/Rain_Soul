import { useEffect, useState } from 'react';
import type { RuntimeInfo } from '../../shared/contracts';
import { RecoveryPanel, type RecoveryPanelProps } from './recovery-panel';

export function SettingsPage(props: RecoveryPanelProps) {
  const { api } = props;
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.getRuntimeInfo().then((runtime) => { if (active) setInfo(runtime); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '无法读取运行信息'); });
    return () => { active = false; };
  }, [api]);
  return <section className="settings-page">
    <div className="settings-group"><h2>本机数据</h2><dl><div><dt>应用版本</dt><dd>{info?.version ?? '正在读取…'}</dd></div><div><dt>作品数据目录</dt><dd className="data-directory">{info?.dataDirectory ?? '正在读取…'}</dd></div></dl>{error && <p role="alert">{error}</p>}</div>
    <div className="settings-group"><h2>写作保护</h2><p>自动保存始终开启：停止输入 500ms 后保存，持续输入最多 5 秒提交。保存失败时保留草稿并阻止离开或关闭。</p><p>正文固定为微软雅黑 12pt、1.5 倍行距；章节标题 16pt 加粗。</p></div>
    <RecoveryPanel {...props} />
    <div className="settings-group"><h2>后续设置</h2><p>头像与名称、知识字典、云端模型和备份设置将随对应功能交付。</p></div>
  </section>;
}
