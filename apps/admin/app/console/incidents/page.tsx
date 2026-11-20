'use client';

import { useState } from 'react';
import { Alert, api, ApiError, Button, Card, formatDate, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Incident {
  id: string;
  type: string;
  severity: string;
  status: string;
  summary: string;
  details: Record<string, unknown>;
  orgName: string | null;
  orgId: string | null;
  createdAt: string;
  resolutionNote: string | null;
}

export default function IncidentsPage() {
  const [status, setStatus] = useState('open');
  const { data, reload } = useLoad<Incident[]>(`/v1/admin/incidents${status ? `?status=${status}` : ''}`);
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (id: string) => {
    const note = prompt('Note de résolution (journalisée) :');
    if (!note) return;
    try {
      await api(`/v1/admin/incidents/${id}/resolve`, { method: 'POST', body: { note } });
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erreur');
    }
  };

  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Incidents</h1>
        <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="open">Ouverts</option>
          <option value="resolved">Résolus</option>
          <option value="">Tous</option>
        </select>
      </div>
      {err && <Alert kind="danger">{err}</Alert>}
      <p className="vp-muted vp-small">
        Les incidents sont ouverts automatiquement par le moteur (double paiement, écart de montant, rapprochement, webhooks rejetés…). Un incident critique exige une action humaine.
      </p>
      {data?.map((i) => (
        <Card
          key={i.id}
          title={
            <span className="vp-row">
              <StatusBadge status={i.severity} /> {i.type}
            </span>
          }
          actions={i.status !== 'resolved' ? <Button variant="ghost" onClick={() => resolve(i.id)}>Résoudre</Button> : <StatusBadge status="resolved" />}
        >
          <p style={{ marginTop: 0 }}>{i.summary}</p>
          <div className="vp-small vp-muted">
            {formatDate(i.createdAt)} {i.orgId && <> · <a href={`/console/organizations/${i.orgId}`}>{i.orgName}</a></>}
          </div>
          {Object.keys(i.details).length > 0 && <pre className="vp-mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--vp-surface-2)', padding: 8, borderRadius: 6 }}>{JSON.stringify(i.details, null, 2)}</pre>}
          {i.resolutionNote && <p className="vp-small">Résolution : {i.resolutionNote}</p>}
        </Card>
      ))}
      {data?.length === 0 && <p className="vp-muted">Aucun incident.</p>}
    </div>
  );
}
