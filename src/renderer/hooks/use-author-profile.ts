import type { DesktopApi } from '../../shared/contracts';
import type { AuthorProfile } from '../../shared/profile';

export interface AuthorProfileController {
  profile: AuthorProfile | null; loading: boolean; busy: boolean; error: string | null;
  refresh(): Promise<void>; setPenName(value: string): Promise<void>; chooseAvatar(): Promise<void>;
  clearAvatar(): Promise<void>; waitForPending(): Promise<void>;
}
export function useAuthorProfile(api: DesktopApi): AuthorProfileController {
  const [profile, setProfile] = useState<AuthorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const locked = useRef(false);
  const mounted = useRef(true);
  const run = useCallback(async (request: () => Promise<AuthorProfile>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null);
    const operation = (async () => {
      try { const saved = await request(); if (mounted.current) setProfile(saved); }
      catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '个人资料操作失败，请重试'); }
      finally { locked.current = false; if (mounted.current) { setBusy(false); setLoading(false); } }
    })();
    pending.current = operation;
    await operation;
  }, []);
  const refresh = useCallback(() => run(() => api.getAuthorProfile()), [api, run]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  return { profile, loading, busy, error, refresh,
    setPenName: value => run(() => api.setPenName(value)), chooseAvatar: () => run(() => api.chooseAvatar()),
    clearAvatar: () => run(() => api.clearAvatar()), waitForPending: () => pending.current };
}
import { useCallback, useEffect, useRef, useState } from 'react';
