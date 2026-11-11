'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from '@vitpay/ui';

export interface Me {
  user: { id: string; email: string; fullName: string; mfaEnabled: boolean };
  organizations: { id: string; role: string; displayName: string; type: string; status: string; kybStatus: string }[];
}

interface Ctx {
  me: Me;
  orgId: string;
  org: Me['organizations'][number];
  setOrgId: (id: string) => void;
  refresh: () => Promise<void>;
  /** Raccourci : appel API scopé à l'organisation courante. */
  orgApi: <T>(path: string, opts?: Parameters<typeof api>[1]) => Promise<T>;
}

const OrgCtx = createContext<Ctx | null>(null);

export function useOrg(): Ctx {
  const c = useContext(OrgCtx);
  if (!c) throw new Error('useOrg outside provider');
  return c;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgIdState] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me & { session: { mfaVerified: boolean } }>('/v1/auth/me');
      if (!m.session.mfaVerified) return router.replace('/mfa');
      setMe(m);
      let stored: string | null = null;
      try {
        stored = localStorage.getItem('vp_org');
      } catch {
        /* ignore */
      }
      const chosen = m.organizations.find((o) => o.id === stored) ?? m.organizations[0];
      setOrgIdState(chosen?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [router, pathname]);

  useEffect(() => {
    void load();
  }, [load]);

  // Identité stable : les effets des pages qui en dépendent ne se relancent qu'au changement d'organisation.
  const orgApi = useCallback(<T,>(path: string, opts?: Parameters<typeof api>[1]) => api<T>(`/v1/orgs/${orgId}${path}`, opts), [orgId]);

  if (!me || !orgId) return <div className="vp-container vp-muted">Chargement…</div>;
  const org = me.organizations.find((o) => o.id === orgId) as Me['organizations'][number];

  const setOrgId = (id: string) => {
    setOrgIdState(id);
    try {
      localStorage.setItem('vp_org', id);
    } catch {
      /* ignore */
    }
  };

  return (
    <OrgCtx.Provider value={{ me, orgId, org, setOrgId, refresh: load, orgApi }}>
      {children}
    </OrgCtx.Provider>
  );
}
