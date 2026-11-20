'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, errorText, Field, formatDate, formatMoney, LinkButton, newIdempotencyKey, PageHeader, PageSkeleton, StatusBadge, TestBadge, usePaidChime, useToast } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { SharePanel } from '../../share-panel';
import { ACTOR_LABELS, Attempt, EVENT_LABELS, RequestDetail, STATUS_LABELS } from '../../types';

const LIVE_ATTEMPT = ['created', 'pending', 'requires_action', 'processing', 'authorized', 'captured'];

/** Formulaire de remboursement : une clé d'idempotence par saisie, aucun double envoi. */
function RefundForm({ attempt, onDone }: { attempt: Attempt; onDone: () => Promise<void> }) {
  const { orgApi } = useOrg();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const amount = String(fd.get('amount') || '').trim();
    if (!confirm(`Rembourser ${amount ? `${amount} MAD` : `la totalité (${formatMoney(attempt.amount)})`} au client ? Cette opération est transmise au prestataire et ne peut pas être annulée.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgApi<{ status: string }>('/refunds', {
        method: 'POST',
        idempotencyKey: key,
        body: { attemptId: attempt.id, amount: amount || undefined, reason: String(fd.get('reason')).trim() },
      });
      toast(res.status === 'succeeded' ? 'Remboursement confirmé par le prestataire.' : 'Remboursement transmis au prestataire.');
      form.reset();
      setKey(newIdempotencyKey());
      await onDone();
    } catch (err) {
      setError(errorText(err));
      setKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="vp-stack" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="vp-row" style={{ alignItems: 'flex-end' }}>
        <div style={{ width: 170 }}>
          <Field id={`amount-${attempt.id}`} label="Montant (vide = total)" name="amount" inputMode="decimal" placeholder={attempt.amount.value.replace('.', ',')} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field id={`reason-${attempt.id}`} label="Raison" name="reason" required minLength={3} placeholder="Ex. article retourné" />
        </div>
        <Button type="submit" variant="ghost" icon="refresh" busy={busy}>
          Rembourser
        </Button>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
    </form>
  );
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { orgApi, orgId, org } = useOrg();
  const toast = useToast();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canRefund = org.role === 'owner' || org.role === 'admin';
  usePaidChime(r?.status);

  const load = useCallback(
    () =>
      orgApi<RequestDetail>(`/payment-requests/${id}`)
        .then((x) => {
          setR(x);
          setLoadError(null);
        })
        .catch((e) => setLoadError(errorText(e))),
    [orgApi, id],
  );

  // Actualisation automatique tant qu'un changement est attendu (demande ouverte ou paiement en cours),
  // suspendue quand l'onglet est masqué.
  const waiting = !r || r.status === 'open' || r.attempts.some((a) => LIVE_ATTEMPT.includes(a.status)) || r.refunds.some((x) => x.status === 'pending' || x.status === 'requested');
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => clearInterval(t);
  }, [load, waiting]);

  const cancel = async () => {
    if (!confirm('Annuler cette demande ? Le lien ne sera plus payable.')) return;
    setBusy(true);
    try {
      await orgApi(`/payment-requests/${id}/cancel`, { method: 'POST', body: {} });
      toast('Demande annulée.');
      await load();
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Sandbox : réponse différée de la banque pour un paiement en attente (prestataire simulé). */
  const resolvePending = async (attemptId: string, outcome: 'succeeded' | 'failed') => {
    setMsg(null);
    try {
      await orgApi(`/sandbox/attempts/${attemptId}/resolve`, { method: 'POST', body: { outcome } });
      setMsg({ kind: 'success', text: 'Réponse de la banque simulée : la confirmation arrive par notification du prestataire.' });
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e, 'Simulation impossible.') });
    }
    setTimeout(() => void load(), 1200);
  };

  if (loadError && !r)
    return (
      <Alert kind="danger">
        {loadError} <a href="/app/requests">Retour aux demandes</a>
      </Alert>
    );
  if (!r) return <PageSkeleton />;
  const succeeded = r.attempts.filter((a) => a.status === 'succeeded');

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 920 }}>
      <PageHeader
        back={{ href: '/app/requests', label: 'Demandes' }}
        title={
          <>
            <span className="vp-num">{formatMoney(r.amount)}</span> <StatusBadge status={r.displayStatus} label={STATUS_LABELS[r.displayStatus]} />
          </>
        }
        subtitle={
          <span className="vp-mono vp-small">
            {r.reference}
            {r.merchantReference && <> · commande {r.merchantReference}</>}
          </span>
        }
        actions={
          <>
            {r.receipt && (
              <LinkButton variant="ghost" icon="receipt" href={`/api/v1/orgs/${orgId}/payments/${r.receipt.attemptId}/receipt.pdf`} target="_blank" rel="noreferrer">
                Reçu {r.receipt.number}
              </LinkButton>
            )}
            {r.status === 'open' && org.role !== 'viewer' && (
              <Button variant="danger" icon="ban" onClick={cancel} busy={busy}>
                Annuler la demande
              </Button>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {r.mode === 'sandbox' && (
        <Alert kind="warning">
          <TestBadge /> Demande en mode test (prestataire simulé) : aucun argent réel.
        </Alert>
      )}

      <Card title="Détails">
        <dl className="vp-grid" style={{ margin: 0 }}>
          {[
            ['Motif', r.description ?? '—'],
            ['Client', r.customerName ?? '—'],
            ['Créée le', formatDate(r.createdAt)],
            [r.paidAt ? 'Payée le' : r.status === 'open' ? 'Expire le' : 'Validité', formatDate(r.paidAt ?? r.expiresAt)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="vp-muted vp-small">{k}</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {r.status === 'open' && (
        <Card title="Partager">
          <SharePanel req={r} orgId={orgId} />
        </Card>
      )}

      <Card title="Tentatives de paiement" description="Un paiement n’est « confirmé » qu’après vérification par VITPAY auprès du prestataire.">
        {!r.attempts.length ? (
          <p className="vp-muted" style={{ margin: 0 }}>
            Le client n’a pas encore ouvert le paiement.
          </p>
        ) : (
          <div className="vp-table-wrap">
            <table className="vp-table vp-table-cards">
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
                    <td className="vp-small" data-label="Prestataire">
                      {a.providerCode === 'mock' ? 'Prestataire simulé' : a.providerCode === 'youcanpay' ? 'YouCan Pay' : a.providerCode} <span className="vp-mono vp-muted">{a.providerRef ?? ''}</span>
                      {a.method === 'card_present' && <div className="vp-small vp-muted">Carte présente (TPE)</div>}
                    </td>
                    <td>
                      <StatusBadge status={a.status} label={STATUS_LABELS[a.status]} />
                      {a.failureCode && <div className="vp-small vp-muted">{a.failureCode}</div>}
                      {r.mode === 'sandbox' && a.status === 'processing' && a.providerCode === 'mock' && org.role !== 'viewer' && (
                        <div className="vp-row" style={{ gap: 6, marginTop: 6 }}>
                          <Button variant="ghost" size="sm" onClick={() => resolvePending(a.id, 'succeeded')}>
                            Simuler : banque confirme
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => resolvePending(a.id, 'failed')}>
                            Simuler : banque refuse
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="vp-num" data-label="Frais prestataire">
                      {formatMoney(a.providerFee)}
                    </td>
                    <td data-label="Règlement">
                      <StatusBadge status={a.settlementStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(succeeded.length > 0 || r.refunds.length > 0) && (
        <Card title="Remboursements" description={canRefund ? 'Le remboursement est exécuté par votre prestataire, sur la carte du client.' : undefined}>
          {r.refunds.length > 0 && (
            <div className="vp-list">
              {r.refunds.map((x) => (
                <div key={x.id} className="vp-row vp-between">
                  <span>
                    <strong className="vp-num">{formatMoney(x.amount)}</strong> <span className="vp-muted">— {x.reason}</span>
                    <div className="vp-small vp-muted">{formatDate(x.createdAt)}</div>
                  </span>
                  <StatusBadge status={x.status} />
                </div>
              ))}
            </div>
          )}
          {canRefund && succeeded.map((a) => <RefundForm key={a.id} attempt={a} onDone={load} />)}
          {!canRefund && !r.refunds.length && <p className="vp-muted" style={{ margin: 0 }}>Seul un administrateur de l’organisation peut rembourser.</p>}
        </Card>
      )}

      {r.disputes.length > 0 && (
        <Card title="Litiges">
          <div className="vp-list">
            {r.disputes.map((d) => (
              <div key={d.id} className="vp-row vp-between">
                <span>
                  {formatMoney(d.amount)} — {d.reason ?? 'Contestation du payeur'}
                </span>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Historique des événements" description="Journal infalsifiable (chaîné) : chaque changement de statut est tracé.">
        <ol className="vp-timeline">
          {r.events.map((e) => (
            <li key={e.id}>
              <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
              {e.to && (
                <>
                  {' : '}
                  {e.from ? `${STATUS_LABELS[e.from] ?? e.from} → ` : ''}
                  {STATUS_LABELS[e.to] ?? e.to}
                </>
              )}
              <div className="vp-small vp-muted">
                {formatDate(e.at)} · {ACTOR_LABELS[e.actor] ?? e.actor}
                {e.reason && <> · {e.reason}</>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
