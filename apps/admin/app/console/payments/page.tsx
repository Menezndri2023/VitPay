'use client';

import { useEffect, useState } from 'react';
import { Card, formatDate, formatMoney, MoneyView, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Payment {
  id: string;
  status: string;
  amount: MoneyView;
  providerCode: string;
  providerRef: string | null;
  settlementStatus: string;
  reference: string;
  mode: string;
  orgName: string;
  orgId: string;
  createdAt: string;
}

export default function PaymentsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [orgId, setOrgId] = useState('');
  useEffect(() => setOrgId(new URLSearchParams(window.location.search).get('orgId') ?? ''), []);
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  if (orgId) p.set('orgId', orgId);
  const { data } = useLoad<Payment[]>(`/v1/admin/payments?${p}`);
  return (
    <div className="vp-stack">
      <h1>Transactions</h1>
      <Card>
        <div className="vp-row" style={{ marginBottom: 12 }}>
          <input className="vp-input" style={{ maxWidth: 320 }} placeholder="Référence VP-…, réf. prestataire ou id" value={q} onChange={(e) => setQ(e.target.value.trim())} aria-label="Rechercher" />
          <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous statuts</option>
            {['succeeded', 'pending', 'requires_action', 'failed', 'cancelled', 'expired'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          {orgId && <button className="vp-btn vp-btn-ghost" onClick={() => setOrgId('')}>Retirer le filtre organisation</button>}
        </div>
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Organisation</th>
                <th>Référence</th>
                <th>Montant</th>
                <th>Statut</th>
                <th>Prestataire</th>
                <th>Règlement</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((x) => (
                <tr key={x.id}>
                  <td className="vp-small">{formatDate(x.createdAt)}</td>
                  <td>
                    <a href={`/console/organizations/${x.orgId}`}>{x.orgName}</a>
                  </td>
                  <td className="vp-mono">
                    {x.reference} {x.mode === 'sandbox' && <span className="vp-badge vp-badge-warning">test</span>}
                  </td>
                  <td>{formatMoney(x.amount)}</td>
                  <td>
                    <StatusBadge status={x.status} />
                  </td>
                  <td className="vp-small">
                    {x.providerCode} <span className="vp-mono vp-muted">{x.providerRef}</span>
                  </td>
                  <td>
                    <StatusBadge status={x.settlementStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
