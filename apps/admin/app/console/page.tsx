'use client';

import { Alert, Card, formatMoney, MoneyView, PageHeader, PageSkeleton, Stat, StatusBadge, STATUS_LABELS_FR } from '@vitpay/ui';
import { useLoad } from './admin-context';

interface Dash {
  organizations: { status: string; kybStatus: string; count: number }[];
  succeededLast30Days: { mode: string; count: number; total: MoneyView }[];
  openIncidents: { severity: string; count: number }[];
  webhooksLast24h: { status: string; count: number }[];
  pendingApprovals: number;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

export default function AdminDashboard() {
  const { data: d, error } = useLoad<Dash>('/v1/admin/dashboard');
  if (error) return <Alert kind="danger">{error}</Alert>;
  if (!d) return <PageSkeleton />;
  const critical = d.openIncidents.find((i) => i.severity === 'critical')?.count ?? 0;
  const kybToReview = d.organizations.filter((o) => o.kybStatus === 'submitted').reduce((s, o) => s + o.count, 0);
  const incidents = d.openIncidents.reduce((s, i) => s + i.count, 0);
  const live = d.succeededLast30Days.filter((v) => v.mode === 'live');
  const test = d.succeededLast30Days.filter((v) => v.mode !== 'live');
  const todo = [
    critical > 0 && { kind: 'danger' as const, text: `${critical} incident${critical > 1 ? 's' : ''} critique${critical > 1 ? 's' : ''} ouvert${critical > 1 ? 's' : ''}`, href: '/console/incidents', action: 'Traiter' },
    d.pendingApprovals > 0 && { kind: 'warning' as const, text: `${d.pendingApprovals} validation${d.pendingApprovals > 1 ? 's' : ''} en attente d’un second administrateur`, href: '/console/approvals', action: 'Examiner' },
    kybToReview > 0 && { kind: 'info' as const, text: `${kybToReview} dossier${kybToReview > 1 ? 's' : ''} KYB à examiner`, href: '/console/organizations', action: 'Ouvrir' },
  ].filter(Boolean) as { kind: 'danger' | 'warning' | 'info'; text: string; href: string; action: string }[];

  return (
    <>
      <PageHeader title="Supervision de la plateforme" subtitle="État en direct : à traiter d’abord, puis activité et santé technique." />
      {todo.length ? (
        <div className="vp-stack">
          {todo.map((t) => (
            <Alert key={t.href} kind={t.kind}>
              {t.text}. <a href={t.href}>{t.action}</a>
            </Alert>
          ))}
        </div>
      ) : (
        <Alert kind="success">Rien à traiter : aucune validation, aucun dossier KYB ni incident en attente.</Alert>
      )}
      <div className="vp-grid">
        <Stat icon="building" label="Organisations" value={d.organizations.reduce((s, o) => s + o.count, 0)} hint={`${kybToReview} KYB à examiner`} href="/console/organizations" />
        <Stat icon="card" label="Paiements réels (30 j)" value={live.reduce((s, v) => s + v.count, 0)} hint={live.map((v) => formatMoney(v.total)).join(' · ') || 'Paiements réels non ouverts'} href="/console/payments" />
        <Stat icon="activity" label="Paiements de test (30 j)" value={test.reduce((s, v) => s + v.count, 0)} hint={test.map((v) => formatMoney(v.total)).join(' · ') || '—'} />
        <Stat icon="alert" label="Incidents ouverts" value={incidents} hint={critical ? `${critical} critique(s)` : 'Aucun critique'} href="/console/incidents" />
      </div>
      <div className="vp-grid">
        <Card title="Incidents par gravité">
          {d.openIncidents.length ? (
            <div className="vp-list">
              {[...d.openIncidents]
                .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
                .map((i) => (
                  <div key={i.severity} className="vp-row vp-between">
                    <StatusBadge status={i.severity} />
                    <strong className="vp-num">{i.count}</strong>
                  </div>
                ))}
            </div>
          ) : (
            <p className="vp-muted" style={{ margin: 0 }}>
              Aucun incident ouvert.
            </p>
          )}
        </Card>
        <Card title="Notifications prestataires (24 h)">
          {d.webhooksLast24h.length ? (
            <div className="vp-list">
              {d.webhooksLast24h.map((w) => (
                <div key={w.status} className="vp-row vp-between">
                  <StatusBadge status={w.status} label={STATUS_LABELS_FR[w.status] ?? w.status} />
                  <strong className="vp-num">{w.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="vp-muted" style={{ margin: 0 }}>
              Aucune notification reçue sur 24 h.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
