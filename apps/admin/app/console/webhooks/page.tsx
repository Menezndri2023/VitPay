'use client';

import { useState } from 'react';
import { Alert, api, ApiError, Button, Card, formatDate, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Webhook {
  id: string;
  providerCode: string;
  eventType: string | null;
  objectRef: string | null;
  signatureValid: boolean;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: string;
}

export default function WebhooksPage() {
  const [status, setStatus] = useState('');
  const { data, reload } = useLoad<Webhook[]>(`/v1/admin/webhooks${status ? `?status=${status}` : ''}`);
  const [err, setErr] = useState<string | null>(null);
  const replay = async (id: string) => {
    try {
      await api(`/v1/admin/webhooks/${id}/replay`, { method: 'POST' });
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erreur');
    }
  };
  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Webhooks entrants</h1>
        <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous</option>
          <option value="processed">Traités</option>
          <option value="failed">En échec</option>
          <option value="rejected">Rejetés (signature)</option>
        </select>
      </div>
      {err && <Alert kind="danger">{err}</Alert>}
      <Card>
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Reçu</th>
                <th>Prestataire</th>
                <th>Événement</th>
                <th>Signature</th>
                <th>Statut</th>
                <th>Essais</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((w) => (
                <tr key={w.id}>
                  <td className="vp-small">{formatDate(w.receivedAt)}</td>
                  <td>{w.providerCode}</td>
                  <td className="vp-small">
                    {w.eventType ?? '—'} <span className="vp-mono vp-muted">{w.objectRef}</span>
                    {w.error && <div className="vp-error">{w.error}</div>}
                  </td>
                  <td>{w.signatureValid ? <StatusBadge status="verified" label="valide" /> : <StatusBadge status="rejected" label="invalide" />}</td>
                  <td>
                    <StatusBadge status={w.status} />
                  </td>
                  <td>{w.attempts}</td>
                  <td>
                    {w.signatureValid && w.status !== 'processed' && (
                      <Button variant="ghost" onClick={() => replay(w.id)}>
                        Rejouer
                      </Button>
                    )}
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
