'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '@vitpay/ui';

export interface AdminMe {
  user: { id: string; email: string; fullName: string; platformRole: string };
}

const Ctx = createContext<AdminMe | null>(null);

export function useAdmin(): AdminMe {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside provider');
  return c;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    api<AdminMe & { session: { mfaVerified: boolean } }>('/v1/admin/auth/me')
      .then((m) => (m.session.mfaVerified ? setMe(m) : window.location.assign('/login')))
      .catch(() => window.location.assign('/login'));
  }, []);
  if (!me) return <div className="vp-container vp-muted">Chargement…</div>;
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

/** Hook de chargement simple avec rechargement manuel. */
export function useLoad<T>(path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [path, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
