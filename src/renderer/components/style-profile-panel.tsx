import { SelectField } from './select-field';
import { useState } from 'react';
import { useAssetAction, type AssetWorkspaceProps } from './plot-workspace';
const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
export function StyleProfilePanel(props: AssetWorkspaceProps) {
  const current = props.assets.styleProfiles.find((profile) => profile.id === props.assets.defaultStyleId);
  const [person, setPerson] = useState(current?.payload.narrativePerson ?? '第三人称');
  const [pace, setPace] = useState(current?.payload.pace ?? '');
  const [prohibited, setProhibited] = useState(current?.payload.prohibited.join('\n') ?? '');
  const [references, setReferences] = useState(current?.payload.referenceWorks.join('\n') ?? '');
  const [dirty, setDirty] = useState(false);
  const action = useAssetAction(props, dirty);
  return <section className="style-workspace assets-detail" aria-label="写作特点">
    <form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (person.trim()) void action.execute({ type: 'publishStyle', payload: { narrativePerson: person.trim(), pace: pace.trim(), prohibited: lines(prohibited), referenceWorks: lines(references) } }).then((success) => { if (success) setDirty(false); }); }}>
      <h2>写作特点</h2><p className="asset-hint">作品默认：{current ? `版本 ${current.version}` : '尚未发布'}。发布新版本保留历史；已有章节覆盖不随默认变化。</p>{action.error && <p className="asset-error" role="alert">{action.error}</p>}
      <label>人称<input value={person} disabled={action.locked} onChange={(event) => { setPerson(event.target.value); setDirty(true); }} required /></label>
      <label>节奏<input value={pace} disabled={action.locked} onChange={(event) => { setPace(event.target.value); setDirty(true); }} /></label>
      <label>禁用项<textarea value={prohibited} disabled={action.locked} placeholder="每行一项" onChange={(event) => { setProhibited(event.target.value); setDirty(true); }} /></label>
      <label>参考作品<textarea value={references} disabled={action.locked} placeholder="每行一部作品" onChange={(event) => { setReferences(event.target.value); setDirty(true); }} /></label>
      <div className="asset-buttons"><button className="primary" disabled={action.locked || !person.trim()}>发布新版本</button><button type="button" className="secondary" disabled={action.locked} onClick={() => { setPerson(current?.payload.narrativePerson ?? '第三人称'); setPace(current?.payload.pace ?? ''); setProhibited(current?.payload.prohibited.join('\n') ?? ''); setReferences(current?.payload.referenceWorks.join('\n') ?? ''); setDirty(false); action.setError(''); }}>放弃更改</button></div>
    </form>
    <section className="asset-form"><h3>章节覆盖</h3><p className="asset-hint">选择“作品默认”解除本章覆盖，不修改其他章节。</p>{dirty && <p className="asset-hint" role="status">请先发布或放弃写作特点更改，再调整章节覆盖。</p>}{props.work.chapters.map((chapter) => { const profileId = props.assets.chapterStyles.find((item) => item.chapterId === chapter.id)?.profileId ?? ''; return <label key={chapter.id}>{chapter.title}写作特点<SelectField aria-label={`${chapter.title}写作特点`} value={profileId} disabled={action.locked || dirty} onChange={(event) => void action.execute({ type: 'setChapterStyle', chapterId: chapter.id, profileId: event.target.value || null })}><option value="">作品默认{current ? `（版本 ${current.version}）` : ''}</option>{props.assets.styleProfiles.map((profile) => <option key={profile.id} value={profile.id}>固定版本 {profile.version} · {profile.payload.narrativePerson} · {profile.payload.pace}</option>)}</SelectField></label>; })}</section>
    <details className="asset-picker"><summary>历史版本 · {props.assets.styleProfiles.length} 版</summary>{[...props.assets.styleProfiles].sort((a, b) => b.version - a.version).map((profile) => <div key={profile.id} className="asset-evidence-card"><strong>版本 {profile.version}</strong><p>{profile.payload.narrativePerson} · {profile.payload.pace || '未限定节奏'}</p><p>禁用：{profile.payload.prohibited.join('；') || '无'}</p><p>参考：{profile.payload.referenceWorks.join('；') || '无'}</p><time>{profile.createdAt}</time></div>)}</details>
  </section>;
}
