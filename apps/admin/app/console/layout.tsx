'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api, Logo } from '@vitpay/ui';
import { AdminProvider, useAdmin } from './admin-context';

const NAV = [
  { href: '/console', label: 'Tableau de bord' },
  { href: '/console/organizations', label: 'Organisations' },
  { href: '/console/payments', label: 'Transactions' },
  { href: '/console/incidents', label: 'Incidents' },
  { href: '/console/approvals', label: 'Validations (4 yeux)' },
  { href: '/console/reconciliation', label: 'Rapprochement' },
  { href: '/console/billing', label: 'Commissions' },
  { href: '/console/webhooks', label: 'Webhooks' },
  { href: '/console/audit', label: 'Journal d’audit' },
];

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useAdmin();
  return (
    <div className="vp-shell">
      <nav className="vp-sidebar" aria-label="Navigation admin">
        <Logo href="/console" />
        <span className="vp-badge vp-badge-warning" style={{ alignSelf: 'flex-start', margin: '0 8px 12px' }}>
          ADMIN
        </span>
        {NAV.map((n) => (
          <a key={n.href} className="vp-nav-link" href={n.href} aria-current={pathname === n.href ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <div className="vp-small" style={{ padding: '8px 12px', color: '#9fb2d3' }}>
          {me.user.fullName}
          <br />
          {me.user.platformRole}
        </div>
        <button
          className="vp-nav-link"
          style={{ background: 'none', border: 0, textAlign: 'start', cursor: 'pointer', font: 'inherit' }}
          onClick={async () => {
            await api('/v1/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
            window.location.assign('/login');
          }}
        >
          Se déconnecter
        </button>
      </nav>
      <main className="vp-main">{children}</main>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AdminProvider>
      <Shell>{children}</Shell>
    </AdminProvider>
  );
}
