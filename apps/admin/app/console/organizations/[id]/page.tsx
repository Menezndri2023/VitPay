'use client';

import { FormEvent, use, useState } from 'react';
import { Alert, api, ApiError, Button, Card, Field, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../../admin-context';

interface OrgDetail {
  id: string;
  displayName: string;
  type: string;
  legalName: string | null;
  ice: string | null;
  rc: string | null;
  address: string | null;
  status: string;
  kybStatus: string;
  vitpayFeeBps: number;
  members: { userId: string; role: string; fullName: string; email: string }[];
  providerAccounts: { id: string; providerCode: string; mode: string; status: string }[];
}

export default function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: o, reload } = useLoad<OrgDetail>(`/v1/admin/organizations/${id}`);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  const act = (path: string, body: object, ok: string) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api(path, { method: 'POST', body: { ...body, ...fd } });
      setMsg({ kind: 'success', text: ok });
      reload();
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? `${err.message}${err.status === 403 ? ' (permission requise)' : ''}` : 'Erreur' });
    }
  };

  if (!o) return <p className="vp-muted">Chargement…</p>;
  return (
    <div className="vp-stack" style={{ maxWidth: 900 }}>
      <h1>
        {o.displayName} <StatusBadge status={o.status} />
      </h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title="Informations légales">
        <div className="vp-grid">
          <div>
            <div className="vp-muted vp-small">Raison sociale</div>
            {o.legalName ?? '—'}
          </div>
          <div>
            <div className="vp-muted vp-small">ICE</div>
            <span className="vp-mono">{o.ice ?? '—'}</span>
          </div>
          <div>
            <div className="vp-muted vp-small">RC</div>
            {o.rc ?? '—'}
          </div>
          <div>
            <div className="vp-muted vp-small">Adresse</div>
            {o.address ?? '—'}
          </div>
        </div>
        <p className="vp-muted vp-small">Les données personnelles sont masquées selon votre rôle.</p>
      </Card>

      <Card title={<>KYB <StatusBadge status={o.kybStatus} /></>}>
        {o.kybStatus === 'submitted' ? (
          <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={act(`/v1/admin/organizations/${id}/kyb`, { decision: 'verified' }, 'KYB validé.')}>
            <div style={{ flex: 1 }}>
              <Field label="Motif de validation (journalisé)" name="reason" required minLength={5} />
            </div>
            <Button type="submit">Valider</Button>
          </form>
        ) : (
          <p className="vp-muted">Aucune décision en attente.</p>
        )}
        {o.kybStatus === 'submitted' && (
          <form className="vp-row" style={{ marginTop: 8 }} onSubmit={act(`/v1/admin/organizations/${id}/kyb`, { decision: 'rejected' }, 'KYB refusé.')}>
            <div style={{ flex: 1 }}>
              <Field label="Motif du refus" name="reason" required minLength={5} />
            </div>
            <Button type="submit" variant="danger">
              Refuser
            </Button>
          </form>
        )}
      </Card>

      <Card title="Justificatifs KYB">
        <KybDocs orgId={id} onMessage={setMsg} />
      </Card>

      <Card title="Statut du compte">
        {o.status === 'active' ? (
          <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={act(`/v1/admin/organizations/${id}/suspend`, {}, 'Organisation suspendue.')}>
            <div style={{ flex: 1 }}>
              <Field label="Motif de suspension (journalisé)" name="reason" required minLength={5} />
            </div>
            <Button type="submit" variant="danger">
              Suspendre immédiatement
            </Button>
          </form>
        ) : (
          <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={act('/v1/admin/approvals', { action: 'org.reactivate', targetId: id, payload: {} }, 'Demande de réactivation créée : un second administrateur doit la valider.')}>
            <div style={{ flex: 1 }}>
              <Field label="Justification de la réactivation" name="reason" required minLength={5} />
            </div>
            <Button type="submit">Demander la réactivation</Button>
          </form>
        )}
      </Card>

      <Card title={`Commission VITPAY — ${(o.vitpayFeeBps / 100).toFixed(2)} %`}>
        <form
          className="vp-row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            try {
              await api('/v1/admin/approvals', {
                method: 'POST',
                body: { action: 'org.fee.update', targetId: id, payload: { vitpayFeeBps: Number(fd.get('bps')) }, reason: String(fd.get('reason')) },
              });
              setMsg({ kind: 'success', text: 'Modification soumise à validation (quatre yeux).' });
            } catch (err) {
              setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Erreur' });
            }
          }}
        >
          <div style={{ width: 160 }}>
            <Field label="Nouveau taux (bps)" name="bps" type="number" min={0} max={1000} required hint="100 bps = 1 %" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Justification" name="reason" required minLength={5} />
          </div>
          <Button type="submit" variant="ghost">
            Proposer
          </Button>
        </form>
      </Card>

      <Card title="Membres">
        {o.members.map((m) => (
          <div key={m.userId} className="vp-row vp-between">
            <span>
              {m.fullName} <span className="vp-muted">{m.email}</span>
            </span>
            <span className="vp-badge vp-badge-neutral">{m.role}</span>
          </div>
        ))}
      </Card>

      <Card title="Comptes prestataires (modèle A)">
        {o.providerAccounts.map((p) => (
          <div key={p.id} className="vp-row vp-between">
            <span>
              {p.providerCode} <span className="vp-badge vp-badge-neutral">{p.mode}</span> <span className="vp-mono vp-muted vp-small">{p.id}</span>
            </span>
            <StatusBadge status={p.status} />
          </div>
        ))}
        {!o.providerAccounts.length && <p className="vp-muted">Aucun compte connecté.</p>}
        <a href={`/console/payments?orgId=${id}`}>Voir les transactions →</a>
      </Card>
    </div>
  );
}

function KybDocs({ orgId, onMessage }: { orgId: string; onMessage: (m: { kind: 'success' | 'danger'; text: string }) => void }) {
  const { data, error, reload } = useLoad<{ id: string; kind: string; filename: string; status: string; sizeBytes: number; reviewNote: string | null }[]>(`/v1/admin/organizations/${orgId}/kyb/documents`);
  if (error) return <p className="vp-muted vp-small">Accès réservé à la conformité.</p>;
  if (!data) return <p className="vp-muted">Chargement…</p>;
  if (!data.length) return <p className="vp-muted">Aucun justificatif déposé.</p>;
  const review = async (docId: string, decision: 'accepted' | 'rejected') => {
    const note = prompt(decision === 'accepted' ? 'Note de validation :' : 'Motif du refus :');
    if (!note) return;
    try {
      await api(`/v1/admin/kyb/documents/${docId}/review`, { method: 'POST', body: { decision, note } });
      onMessage({ kind: 'success', text: 'Revue enregistrée.' });
      reload();
    } catch (e) {
      onMessage({ kind: 'danger', text: e instanceof ApiError ? e.message : 'Erreur' });
    }
  };
  return (
    <div className="vp-stack">
      <p className="vp-muted vp-small" style={{ margin: 0 }}>Chaque téléchargement est inscrit au journal d’audit.</p>
      {data.map((d) => (
        <div key={d.id} className="vp-row vp-between">
          <span>
            <a href={`/api/v1/admin/kyb/documents/${d.id}/download`}>{d.filename}</a> <span className="vp-muted vp-small">{d.kind} · {Math.ceil(d.sizeBytes / 1024)} Ko</span>
            {d.reviewNote && <div className="vp-muted vp-small">{d.reviewNote}</div>}
          </span>
          <span className="vp-row" style={{ gap: 6 }}>
            <StatusBadge status={d.status === 'accepted' ? 'verified' : d.status === 'rejected' ? 'rejected' : 'pending'} label={d.status} />
            {d.status === 'pending' && (
              <>
                <Button variant="ghost" onClick={() => review(d.id, 'accepted')}>Accepter</Button>
                <Button variant="ghost" onClick={() => review(d.id, 'rejected')}>Refuser</Button>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
