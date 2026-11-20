'use client';

import { useEffect, useState } from 'react';
import { Alert, Card, formatMoney, MoneyView, Stat } from '@vitpay/ui';
import { useOrg } from './org-context';

interface Dashboard {
  last30Days: { status: string; count: number; total: MoneyView }[];
  dailyReceived: { day: string; count: number; total: MoneyView }[];
}

export default function DashboardPage() {
  const { orgApi, org } = useOrg();
  const [d, setD] = useState<Dashboard | null>(null);
  const [providers, setProviders] = useState<number | null>(null);

  useEffect(() => {
    orgApi<Dashboard>('/dashboard').then(setD).catch(() => undefined);
    orgApi<{ connected: { status: string }[] }>('/providers').then((p) => setProviders(p.connected.filter((c) => c.status === 'active').length)).catch(() => undefined);
  }, [orgApi]);

  const by = (s: string) => d?.last30Days.filter((x) => x.status === s) ?? [];
  const paid = by('paid');
  const open = by('open');
  const maxDay = Math.max(1, ...(d?.dailyReceived.map((x) => Number(x.total.minor)) ?? [1]));

  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Bonjour, {org.displayName}</h1>
        <a className="vp-btn vp-btn-accent" href="/app/requests/new">
          + Nouvelle demande
        </a>
      </div>
      {providers === 0 && (
        <Alert kind="warning">
          Aucun prestataire de paiement connecté. <a href="/app/settings">Connectez votre compte prestataire</a> pour recevoir des paiements.
        </Alert>
      )}
      <div className="vp-grid">
        <Stat label="Encaissé (30 jours)" value={paid.map((p) => formatMoney(p.total)).join(' · ') || '0'} hint={`${paid.reduce((s, p) => s + p.count, 0)} paiement(s)`} />
        <Stat label="En attente de paiement" value={open.reduce((s, p) => s + p.count, 0)} hint={open.map((p) => formatMoney(p.total)).join(' · ')} />
        <Stat label="Expirées / annulées" value={by('expired').reduce((s, p) => s + p.count, 0) + by('cancelled').reduce((s, p) => s + p.count, 0)} />
      </div>
      <Card title="Encaissements confirmés par jour">
        {!d?.dailyReceived.length && <p className="vp-muted">Aucun paiement confirmé sur les 30 derniers jours.</p>}
        <div className="vp-stack" style={{ gap: 6 }}>
          {d?.dailyReceived.map((x) => (
            <div key={x.day + x.total.currency} className="vp-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <span className="vp-small vp-muted" style={{ width: 88 }}>
                {x.day}
              </span>
              <div style={{ flex: 1, background: 'var(--vp-surface-2)', borderRadius: 4, height: 14 }}>
                <div style={{ width: `${(Number(x.total.minor) / maxDay) * 100}%`, background: 'var(--vp-accent)', height: 14, borderRadius: 4 }} />
              </div>
              <span className="vp-small" style={{ width: 120, textAlign: 'end' }}>
                {formatMoney(x.total)}
              </span>
            </div>
          ))}
        </div>
      </Card>
      <p className="vp-muted vp-small">
        Les montants affichés reflètent les confirmations reçues de votre prestataire de paiement. Les fonds sont détenus et reversés par votre prestataire, pas par VITPAY.
      </p>
    </div>
  );
}
