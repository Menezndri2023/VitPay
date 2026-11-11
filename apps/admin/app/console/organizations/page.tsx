'use client';

import { useState } from 'react';
import { Card, formatDate, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Org {
  id: string;
  type: string;
  displayName: string;
  legalName: string | null;
  ice: string | null;
  status: string;
  kybStatus: string;
  vitpayFeeBps: number;
  requestCount: number;
  createdAt: string;
}

export default function OrganizationsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  const { data } = useLoad<Org[]>(`/v1/admin/organizations?${p}`);
  return (
    <div className="vp-stack">
      <h1>Organisations</h1>
      <Card>
        <div className="vp-row" style={{ marginBottom: 12 }}>
          <input className="vp-input" style={{ maxWidth: 280 }} placeholder="Nom, raison sociale, ICE" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtre">
            <option value="">Toutes</option>
            <option value="active">Actives</option>
            <option value="suspended">Suspendues</option>
            <option value="submitted">KYB à examiner</option>
            <option value="verified">KYB vérifié</option>
          </select>
        </div>
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Raison sociale / ICE</th>
                <th>Statut</th>
                <th>KYB</th>
                <th>Frais</th>
                <th>Demandes</th>
                <th>Créée</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((o) => (
                <tr key={o.id}>
                  <td>
                    <a href={`/console/organizations/${o.id}`}>{o.displayName}</a>
                    <div className="vp-small vp-muted">{o.type}</div>
                  </td>
                  <td className="vp-small">
                    {o.legalName ?? '—'}
                    <div className="vp-mono vp-muted">{o.ice ?? ''}</div>
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    <StatusBadge status={o.kybStatus} />
                  </td>
                  <td>{(o.vitpayFeeBps / 100).toFixed(2)} %</td>
                  <td>{o.requestCount}</td>
                  <td className="vp-small vp-muted">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
