'use client';

import { Alert, Card, formatMoney, MoneyView, Stat, StatusBadge } from '@vitpay/ui';
import { useLoad } from './admin-context';

interface Dash {
  organizations: { status: string; kybStatus: string; count: number }[];
  succeededLast30Days: { mode: string; count: number; total: MoneyView }[];
  openIncidents: { severity: string; count: number }[];
  webhooksLast24h: { status: string; count: number }[];
  pendingApprovals: number;
}

export default function AdminDashboard() {
  const { data: d, error } = useLoad<Dash>('/v1/admin/dashboard');
  if (error) return <Alert kind="danger">{error}</Alert>;
  if (!d) return <p className="vp-muted">Chargement…</p>;
  const critical = d.openIncidents.find((i) => i.severity === 'critical')?.count ?? 0;
  return (
    <div className="vp-stack">
      <h1>Supervision de la plateforme</h1>
      {critical > 0 && (
        <Alert kind="danger">
          {critical} incident(s) critique(s) ouvert(s). <a href="/console/incidents">Traiter</a>
        </Alert>
      )}
      <div className="vp-grid">
        <Stat label="Organisations" value={d.organizations.reduce((s, o) => s + o.count, 0)} hint={`${d.organizations.filter((o) => o.kybStatus === 'submitted').reduce((s, o) => s + o.count, 0)} KYB à examiner`} />
        <Stat label="Paiements confirmés (30 j)" value={d.succeededLast30Days.reduce((s, v) => s + v.count, 0)} hint={d.succeededLast30Days.map((v) => `${formatMoney(v.total)} (${v.mode})`).join(' · ')} />
        <Stat label="Incidents ouverts" value={d.openIncidents.reduce((s, i) => s + i.count, 0)} />
        <Stat label="Validations en attente" value={d.pendingApprovals} />
      </div>
      <div className="vp-grid">
        <Card title="Incidents par gravité">
          {d.openIncidents.map((i) => (
            <div key={i.severity} className="vp-row vp-between">
              <StatusBadge status={i.severity} /> {i.count}
            </div>
          ))}
          {!d.openIncidents.length && <p className="vp-muted">Aucun incident ouvert.</p>}
        </Card>
        <Card title="Webhooks (24 h)">
          {d.webhooksLast24h.map((w) => (
            <div key={w.status} className="vp-row vp-between">
              <StatusBadge status={w.status} /> {w.count}
            </div>
          ))}
          {!d.webhooksLast24h.length && <p className="vp-muted">Aucun webhook reçu.</p>}
        </Card>
      </div>
    </div>
  );
}
