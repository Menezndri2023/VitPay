'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api, AppShell, Icon, ROLE_LABELS_FR, ToastProvider, type NavGroup } from '@vitpay/ui';
import { AdminProvider, useAdmin } from './admin-context';

function nav(counts: { approvals: number; incidents: number; kyb: number }): NavGroup[] {
  return [
    {
      items: [{ href: '/console', label: 'Supervision', icon: 'activity', exact: true }],
    },
    {
      label: 'À traiter',
      items: [
        { href: '/console/approvals', label: 'Validations (4 yeux)', icon: 'shield', count: counts.approvals },
        { href: '/console/incidents', label: 'Incidents', icon: 'alert', count: counts.incidents },
        { href: '/console/organizations', label: 'Organisations et KYB', icon: 'building', count: counts.kyb },
      ],
    },
    {
      label: 'Opérations',
      items: [
        { href: '/console/payments', label: 'Transactions', icon: 'card' },
        { href: '/console/reconciliation', label: 'Rapprochement', icon: 'scale' },
        { href: '/console/billing', label: 'Commissions', icon: 'receipt' },
        { href: '/console/webhooks', label: 'Webhooks', icon: 'link' },
      ],
    },
    {
      label: 'Contrôle',
      items: [{ href: '/console/audit', label: 'Journal d’audit', icon: 'file' }],
    },
  ];
}

interface Dash {
  organizations: { kybStatus: string; count: number }[];
  openIncidents: { severity: string; count: number }[];
  pendingApprovals: number;
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useAdmin();
  const [counts, setCounts] = useState({ approvals: 0, incidents: 0, kyb: 0 });
  // Compteurs de la navigation, actualisés à chaque changement de page.
  useEffect(() => {
    api<Dash>('/v1/admin/dashboard')
      .then((d) =>
        setCounts({
          approvals: d.pendingApprovals,
          incidents: d.openIncidents.reduce((s, i) => s + i.count, 0),
          kyb: d.organizations.filter((o) => o.kybStatus === 'submitted').reduce((s, o) => s + o.count, 0),
        }),
      )
      .catch(() => undefined);
  }, [pathname]);
  return (
    <AppShell
      pathname={pathname}
      nav={nav(counts)}
      home="/console"
      logoSuffix="Admin"
      footer={
        <>
          <div className="vp-who">
            <strong>{me.user.fullName}</strong>
            {ROLE_LABELS_FR[me.user.platformRole] ?? me.user.platformRole}
            <div style={{ marginTop: 6, fontSize: 12 }}>Toutes les actions sont journalisées.</div>
          </div>
          <button
            type="button"
            className="vp-nav-link"
            onClick={async () => {
              await api('/v1/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
              window.location.assign('/login');
            }}
          >
            <Icon name="logout" />
            Se déconnecter
          </button>
        </>
      }
    >
      <div className="vp-stack-lg">{children}</div>
    </AppShell>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AdminProvider>
        <Shell>{children}</Shell>
      </AdminProvider>
    </ToastProvider>
  );
}
