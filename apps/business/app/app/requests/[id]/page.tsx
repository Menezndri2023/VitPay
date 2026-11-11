'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import { Alert, ApiError, Button, Card, Field, formatDate, formatMoney, newIdempotencyKey, StatusBadge } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { SharePanel } from '../../share-panel';
import { ACTOR_LABELS, EVENT_LABELS, RequestDetail, STATUS_LABELS } from '../../types';

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { orgApi, orgId, org } = useOrg();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const canRefund = org.role === 'owner' || org.role === 'admin';

  const load = useCallback(() => orgApi<RequestDetail>(`/payment-requests/${id}`).then(setR), [orgApi, id]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const cancel = async () => {
    if (!confirm('Annuler cette demande ? Le lien ne sera plus payable.')) return;
    try {
      await orgApi(`/payment-requests/${id}/cancel`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setMsg({ kind: 'danger', text: e instanceof ApiError ? e.message : 'Erreur' });
    }
  };

  const refund = async (e: FormEvent<HTMLFormElement>, attemptId: string) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const res = await orgApi<{ status: string }>('/refunds', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: { attemptId, amount: String(fd.get('amount') || '') || undefined, reason: String(fd.get('reason')) },
      });
      setMsg({ kind: 'success', text: `Remboursement ${res.status === 'succeeded' ? 'confirmé par le prestataire' : 'transmis au prestataire'}.` });
      await load();
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Erreur' });
    }
  };

  /** Sandbox : réponse différée de la banque pour un paiement en attente (prestataire simulé). */
  const resolvePending = async (providerRef: string, outcome: 'succeeded' | 'failed') => {
    setMsg(null);
    const res = await fetch(`/api/mock-psp/simulate/payments/${encodeURIComponent(providerRef)}/resolve/${outcome}`, { method: 'POST' });
    if (!res.ok) setMsg({ kind: 'danger', text: 'Simulation impossible (paiement déjà terminé ?)' });
    else setMsg({ kind: 'success', text: 'Réponse de la banque simulée : la confirmation arrive par notification du prestataire.' });
    setTimeout(() => void load(), 1200);
  };

  if (!r) return <p className="vp-muted">Chargement…</p>;
  const succeeded = r.attempts.filter((a) => a.status === 'succeeded');

  return (
    <div className="vp-stack" style={{ maxWidth: 900 }}>
      <div className="vp-row vp-between">
        <div>
          <div className="vp-muted vp-small vp-mono">
            {r.reference}
            {r.merchantReference && <> · commande {r.merchantReference}</>}
          </div>
          <h1 style={{ margin: 0 }}>
            {formatMoney(r.amount)} <StatusBadge status={r.displayStatus} label={STATUS_LABELS[r.displayStatus]} />
          </h1>
        </div>
        <div className="vp-row">
          {r.receipt && (
            <a className="vp-btn vp-btn-ghost" href={`/api/v1/orgs/${orgId}/payments/${r.receipt.attemptId}/receipt.pdf`} target="_blank" rel="noreferrer">
              Reçu {r.receipt.number}
            </a>
          )}
          {r.status === 'open' && (
            <Button variant="danger" onClick={cancel}>
              Annuler
            </Button>
          )}
        </div>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {r.mode === 'sandbox' && <Alert kind="warning">Demande en mode test (prestataire simulé).</Alert>}

      <Card title="Détails">
        <div className="vp-grid">
          <div>
            <div className="vp-muted vp-small">Motif</div>
            {r.description ?? '—'}
          </div>
          <div>
            <div className="vp-muted vp-small">Client</div>
            {r.customerName ?? '—'}
          </div>
          <div>
            <div className="vp-muted vp-small">Créée le</div>
            {formatDate(r.createdAt)}
          </div>
          <div>
            <div className="vp-muted vp-small">{r.paidAt ? 'Payée le' : 'Expire le'}</div>
            {formatDate(r.paidAt ?? r.expiresAt)}
          </div>
        </div>
      </Card>

      {r.status === 'open' && (
        <Card title="Partager">
          <SharePanel req={r} orgId={orgId} />
        </Card>
      )}

      <Card title="Tentatives de paiement">
        <p className="vp-muted vp-small" style={{ marginTop: 0 }}>
          Un paiement n’est « confirmé » qu’après vérification serveur auprès du prestataire.
        </p>
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Prestataire</th>
                <th>Statut</th>
                <th>Frais prestataire</th>
                <th>Règlement</th>
              </tr>
            </thead>
            <tbody>
              {r.attempts.map((a) => (
                <tr key={a.id}>
                  <td className="vp-small">{formatDate(a.createdAt)}</td>
                  <td className="vp-small">
                    {a.providerCode} <span className="vp-mono vp-muted">{a.providerRef ?? ''}</span>
                  </td>
                  <td>
                    <StatusBadge status={a.status} label={STATUS_LABELS[a.status]} />
                    {a.failureCode && <div className="vp-small vp-muted">{a.failureCode}</div>}
                    {r.mode === 'sandbox' && a.status === 'processing' && a.providerCode === 'mock' && a.providerRef && (
                      <div className="vp-row" style={{ gap: 6, marginTop: 6 }}>
                        <Button variant="ghost" onClick={() => resolvePending(a.providerRef as string, 'succeeded')}>
                          Simuler : banque confirme
                        </Button>
                        <Button variant="ghost" onClick={() => resolvePending(a.providerRef as string, 'failed')}>
                          Simuler : banque refuse
                        </Button>
                      </div>
                    )}
                  </td>
                  <td>{formatMoney(a.providerFee)}</td>
                  <td>
                    <StatusBadge status={a.settlementStatus} label={a.settlementStatus === 'settled' ? 'Réglé' : 'Non réglé'} />
                  </td>
                </tr>
              ))}
              {!r.attempts.length && (
                <tr>
                  <td colSpan={5} className="vp-muted">
                    Le payeur n’a pas encore ouvert le paiement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {(succeeded.length > 0 || r.refunds.length > 0) && (
        <Card title="Remboursements">
          {r.refunds.map((x) => (
            <div key={x.id} className="vp-row vp-between" style={{ borderBottom: '1px solid var(--vp-border)', padding: '8px 0' }}>
              <span>
                {formatMoney(x.amount)} — {x.reason}
              </span>
              <StatusBadge status={x.status} />
            </div>
          ))}
          {canRefund &&
            succeeded.map((a) => (
              <form key={a.id} className="vp-row" style={{ marginTop: 12, alignItems: 'flex-end' }} onSubmit={(e) => refund(e, a.id)}>
                <div style={{ width: 160 }}>
                  <Field label="Montant (vide = total)" name="amount" inputMode="decimal" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Field label="Raison" name="reason" required minLength={3} />
                </div>
                <Button type="submit" variant="ghost">
                  Rembourser
                </Button>
              </form>
            ))}
        </Card>
      )}

      <Card title="Historique des événements">
        <p className="vp-muted vp-small" style={{ marginTop: 0 }}>
          Journal infalsifiable (chaîné) : chaque changement de statut est tracé.
        </p>
        <ol className="vp-stack" style={{ gap: 6, margin: 0, paddingInlineStart: 18 }}>
          {r.events.map((e) => (
            <li key={e.id} className="vp-small">
              <span className="vp-muted">{formatDate(e.at)}</span> — <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
              {e.to && (
                <>
                  {' : '}
                  {e.from ? `${STATUS_LABELS[e.from] ?? e.from} → ` : ''}
                  {STATUS_LABELS[e.to] ?? e.to}
                </>
              )}
              <span className="vp-muted"> · {ACTOR_LABELS[e.actor] ?? e.actor}</span>
              {e.reason && <span className="vp-muted"> · {e.reason}</span>}
            </li>
          ))}
        </ol>
      </Card>

      {r.disputes.length > 0 && (
        <Card title="Litiges">
          {r.disputes.map((d) => (
            <div key={d.id} className="vp-row vp-between">
              <span>
                {formatMoney(d.amount)} — {d.reason ?? 'Contestation du payeur'}
              </span>
              <StatusBadge status={d.status} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
