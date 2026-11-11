'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, formatDate, formatMoney, StatusBadge } from '@vitpay/ui';
import { useOrg } from '../org-context';
import { PaymentRequest, STATUS_LABELS } from '../types';

export default function RequestsPage() {
  const { orgApi, orgId } = useOrg();
  const [rows, setRows] = useState<PaymentRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(
    async (before?: string) => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (q) p.set('q', q);
      if (before) p.set('before', before);
      const r = await orgApi<{ data: PaymentRequest[]; nextCursor: string | null }>(`/payment-requests?${p}`);
      setRows((prev) => (before ? [...prev, ...r.data] : r.data));
      setCursor(r.nextCursor);
    },
    [orgApi, status, q],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Demandes de paiement</h1>
        <div className="vp-row">
          <a className="vp-btn vp-btn-ghost" href={`/api/v1/orgs/${orgId}/exports/payments.csv`}>
            Export CSV
          </a>
          <a className="vp-btn vp-btn-accent" href="/app/requests/new">
            + Nouvelle demande
          </a>
        </div>
      </div>
      <Card>
        <div className="vp-row" style={{ marginBottom: 12 }}>
          <input className="vp-input" style={{ maxWidth: 260 }} placeholder="Référence, motif, client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          <select className="vp-input" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            <option value="open">En attente</option>
            <option value="paid">Payées</option>
            <option value="expired">Expirées</option>
            <option value="cancelled">Annulées</option>
          </select>
        </div>
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Montant</th>
                <th>Motif</th>
                <th>Statut</th>
                <th>Créée le</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a className="vp-mono" href={`/app/requests/${r.id}`}>
                      {r.reference}
                    </a>
                    {r.mode === 'sandbox' && <span className="vp-badge vp-badge-warning" style={{ marginInlineStart: 6 }}>test</span>}
                    {r.merchantReference && <div className="vp-small vp-muted vp-mono">{r.merchantReference}</div>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(r.amount)}</td>
                  <td className="vp-muted">{r.description ?? '—'}</td>
                  <td>
                    <StatusBadge status={r.status} label={STATUS_LABELS[r.status]} />
                  </td>
                  <td className="vp-muted vp-small">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="vp-muted">
                    Aucune demande pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <div style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={() => load(cursor)}>
              Charger plus
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
