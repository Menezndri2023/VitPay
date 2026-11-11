'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, Logo } from '@vitpay/ui';
import { OrgProvider, useOrg } from './org-context';

const NAV = [
  { href: '/app', label: 'Tableau de bord' },
  { href: '/app/requests', label: 'Demandes' },
  { href: '/app/requests/new', label: 'Nouvelle demande' },
  { href: '/app/pos', label: 'Caisse (QR)' },
  { href: '/app/notifications', label: 'Notifications' },
  { href: '/app/developers', label: 'Développeurs' },
  { href: '/app/settings', label: 'Paramètres' },
];

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, org, orgId, setOrgId } = useOrg();
  const logout = async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  };
  return (
    <div className="vp-shell">
      <nav className="vp-sidebar" aria-label="Navigation principale">
        <Logo href="/app" />
        {NAV.map((n) => (
          <a key={n.href} className="vp-nav-link" href={n.href} aria-current={pathname === n.href ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        {me.organizations.length > 1 && (
          <select aria-label="Organisation" className="vp-input" value={orgId} onChange={(e) => setOrgId(e.target.value)} style={{ background: 'transparent', color: '#fff' }}>
            {me.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName}
              </option>
            ))}
          </select>
        )}
        <div className="vp-small" style={{ padding: '8px 12px', color: '#9fb2d3' }}>
          {org.displayName}
          <br />
          {me.user.fullName} · {org.role}
        </div>
        <button className="vp-nav-link" style={{ background: 'none', border: 0, textAlign: 'start', cursor: 'pointer', font: 'inherit' }} onClick={logout}>
          Se déconnecter
        </button>
      </nav>
      <main className="vp-main">
        {org.status !== 'active' && (
          <div className="vp-alert vp-alert-danger" style={{ marginBottom: 16 }}>
            Votre organisation est suspendue. Les nouvelles opérations sont bloquées. Contactez le support VITPAY.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <OrgProvider>
      <Shell>{children}</Shell>
    </OrgProvider>
  );
}
