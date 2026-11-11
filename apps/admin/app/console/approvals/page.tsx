'use client';

import { useState } from 'react';
import { Alert, api, ApiError, Button, Card, formatDate, StatusBadge } from '@vitpay/ui';
import { useAdmin, useLoad } from '../admin-context';

interface Approval {
  id: string;
  action: string;
  targetId: string;
  targetName: string | null;
  payload: Record<string, unknown>;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decisionNote: string | null;
}

const ACTION_LABEL: Record<string, string> = { 'org.fee.update': 'Modification de commission', 'org.reactivate': 'Réactivation d’organisation' };

export default function ApprovalsPage() {
  const me = useAdmin();
  const [status, setStatus] = useState('pending');
  const { data, reload } = useLoad<Approval[]>(`/v1/admin/approvals${status ? `?status=${status}` : ''}`);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    const note = prompt(decision === 'approved' ? 'Note de validation :' : 'Motif du refus :');
    if (!note) return;
    try {
      await api(`/v1/admin/approvals/${id}/decision`, { method: 'POST', body: { decision, note } });
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Erreur');
    }
  };

  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Validations — principe des quatre yeux</h1>
        <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="pending">En attente</option>
          <option value="approved">Approuvées</option>
          <option value="rejected">Refusées</option>
          <option value="">Toutes</option>
        </select>
      </div>
      <p className="vp-muted vp-small">Une opération sensible demandée par un administrateur doit être validée par un autre administrateur habilité.</p>
      {err && <Alert kind="danger">{err}</Alert>}
      {data?.map((a) => (
        <Card key={a.id} title={ACTION_LABEL[a.action] ?? a.action} actions={<StatusBadge status={a.status} />}>
          <div className="vp-stack" style={{ gap: 4 }}>
            <div>
              Cible : <a href={`/console/organizations/${a.targetId}`}>{a.targetName ?? a.targetId}</a>
            </div>
            {Object.keys(a.payload).length > 0 && <div className="vp-mono">{JSON.stringify(a.payload)}</div>}
            <div>Justification : {a.reason}</div>
            <div className="vp-small vp-muted">
              Demandé par {a.requestedByName} le {formatDate(a.requestedAt)}
              {a.decidedByName && ` · décidé par ${a.decidedByName} (${a.decisionNote})`}
            </div>
          </div>
          {a.status === 'pending' &&
            (a.requestedBy === me.user.id ? (
              <p className="vp-small vp-muted">Vous ne pouvez pas valider votre propre demande.</p>
            ) : (
              <div className="vp-row" style={{ marginTop: 12 }}>
                <Button onClick={() => decide(a.id, 'approved')}>Approuver</Button>
                <Button variant="danger" onClick={() => decide(a.id, 'rejected')}>
                  Refuser
                </Button>
              </div>
            ))}
        </Card>
      ))}
      {data?.length === 0 && <p className="vp-muted">Rien à afficher.</p>}
    </div>
  );
}
