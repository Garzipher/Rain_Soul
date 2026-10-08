import { useEffect, useId, useState } from 'react';
import type { AuthorProfileController } from '../hooks/use-author-profile';
import './profile-settings.css';

export function ProfileSettings({ author, locked = false }: { author: AuthorProfileController; locked?: boolean }) {
  const [name, setName] = useState(author.profile?.penName ?? '');
  const nameId = useId();
  const disabled = locked || author.busy || author.loading || author.profile === null;
  const savedName = author.profile?.penName;
  useEffect(() => { if (savedName !== undefined) setName(savedName); }, [savedName]);
  return <div className="settings-group author-settings"><h2>个人资料</h2>
    <div className="author-avatar-row">
      {author.profile?.avatarDataUrl ? <img className="avatar" src={author.profile.avatarDataUrl} alt="作者头像" /> : <span className="avatar" aria-hidden="true">R</span>}
      <div><button className="secondary" disabled={disabled} onClick={() => void author.chooseAvatar()}>上传头像</button><button className="secondary" disabled={disabled || !author.profile?.avatarDataUrl} onClick={() => void author.clearAvatar()}>移除头像</button></div>
    </div>
    {author.profile && <form className="author-name-row" onSubmit={event => { event.preventDefault(); if (!disabled) void author.setPenName(name); }}>
      <label htmlFor={nameId}>显示名称</label><div><input id={nameId} value={name} maxLength={80} disabled={disabled} onChange={event => setName(event.target.value)} autoComplete="nickname" /><button className="secondary" type="submit" disabled={disabled}>保存名称</button></div>
    </form>}
    {author.loading && <p role="status">正在读取本机个人资料…</p>}
    {author.error && <div className="author-error"><p role="alert">{author.error}</p>{author.profile === null && <button className="secondary" disabled={author.busy} onClick={() => void author.refresh()}>重新读取资料</button>}</div>}
    <p>头像和名称仅保存在本机，独立于作品及版本。</p>
  </div>;
}
