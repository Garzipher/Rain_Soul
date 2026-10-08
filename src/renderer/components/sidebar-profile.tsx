import { useEffect, useRef, useState } from 'react';
import type { AuthorProfileController } from '../hooks/use-author-profile';
import './profile-settings.css';

export function SidebarProfile({ author, locked = false }: { author?: AuthorProfileController; locked?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const displayButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const profile = author?.profile;
  useEffect(() => { if (submitted !== null && !author?.busy && !author?.error && profile?.penName === submitted.trim()) { restoreFocus.current = true; setEditing(false); setSubmitted(null); } }, [profile, submitted, author?.busy, author?.error]);
  useEffect(() => { if (!editing && restoreFocus.current) { displayButton.current?.focus(); restoreFocus.current = false; } }, [editing]);
  const disabled = locked || !author || author.busy || author.loading || !profile;
  function save() { if (author && !disabled) { setSubmitted(name); void author.setPenName(name); } }
  return <div className="profile">
    {profile?.avatarDataUrl ? <img className="avatar" src={profile.avatarDataUrl} alt="作者头像" /> : <span className="avatar" aria-hidden="true">R</span>}
    {editing ? <><input className="profile-name-input" aria-label="修改显示名称" value={name} maxLength={80} autoFocus disabled={disabled} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } else if (event.key === 'Escape') { restoreFocus.current = true; setEditing(false); setSubmitted(null); } }} /><button className="secondary" disabled={disabled} onClick={save}>保存名称</button></> : <button ref={displayButton} className="profile-name-button" aria-label={`编辑显示名称：${profile?.penName || '未设置名称'}`} disabled={disabled} onClick={() => { setName(profile?.penName ?? ''); setEditing(true); }}>{profile?.penName || '未设置名称'}</button>}
    {editing && author?.error && <small role="alert">{author.error}</small>}
  </div>;
}
