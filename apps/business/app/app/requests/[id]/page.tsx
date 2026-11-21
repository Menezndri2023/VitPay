'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, errorText, Field, formatDate, formatMoney, LinkButton, newIdempotencyKey, PageHeader, PageSkeleton, StatusBadge, TestBadge, usePaidChime, useToast } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { useT } from '../../../i18n';
import { SharePanel } from '../../share-panel';
import { ACTOR_LABELS, Attempt, EVENT_LABELS, RequestDetail, STATUS_LABELS } from '../../types';

const LIVE_ATTEMPT = ['created', 'pending', 'requires_action', 'processing', 'authorized', 'captured'];

/** Formulaire de remboursement : une clé d'idempotence par saisie, aucun double envoi. */
function RefundForm({ attempt, onDone }: { attempt: Attempt; onDone: () => Promise<void> }) {
  const { orgApi } = useOrg();
  const { t, tag } = useT();
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
    if (!confirm(t('det.refundConfirm', { what: amount ? `${amount} MAD` : t('det.refundAll', { amount: formatMoney(attempt.amount, tag) }) }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgApi<{ status: string }>('/refunds', {
        method: 'POST',
        idempotencyKey: key,
        body: { attemptId: attempt.id, amount: amount || undefined, reason: String(fd.get('reason')).trim() },
      });
      toast(res.status === 'succeeded' ? t('det.refundOk') : t('det.refundSent'));
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
          <Field id={`amount-${attempt.id}`} label={t('det.refundAmount')} name="amount" inputMode="decimal" dir="ltr" placeholder={attempt.amount.value.replace('.', ',')} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field id={`reason-${attempt.id}`} label={t('det.refundReason')} name="reason" required minLength={3} placeholder={t('det.refundReasonPh')} />
        </div>
        <Button type="submit" variant="ghost" icon="refresh" busy={busy}>
          {t('det.refund')}
        </Button>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
    </form>
  );
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { orgApi, orgId, org } = useOrg();
  const { t, tr, tag } = useT();
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
    if (!confirm(t('det.cancelConfirm'))) return;
    setBusy(true);
    try {
      await orgApi(`/payment-requests/${id}/cancel`, { method: 'POST', body: {} });
      toast(t('det.cancelled'));
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
      setMsg({ kind: 'success', text: t('det.simDone') });
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e, 'Simulation impossible.') });
    }
    setTimeout(() => void load(), 1200);
  };

  if (loadError && !r)
    return (
      <Alert kind="danger">
        {loadError} <a href="/app/requests">{t('det.backToList')}</a>
      </Alert>
    );
  if (!r) return <PageSkeleton />;
  const succeeded = r.attempts.filter((a) => a.status === 'succeeded');

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 920 }}>
      <PageHeader
        back={{ href: '/app/requests', label: t('nav.requests') }}
        title={
          <>
            <span className="vp-num">{formatMoney(r.amount, tag)}</span> <StatusBadge status={r.displayStatus} label={tr('status', r.displayStatus, STATUS_LABELS[r.displayStatus] ?? r.displayStatus)} />
          </>
        }
        subtitle={
          <span className="vp-mono vp-small">
            {r.reference}
            {r.merchantReference && <> · {t('det.order', { ref: r.merchantReference })}</>}
          </span>
        }
        actions={
          <>
            {r.receipt && (
              <LinkButton variant="ghost" icon="receipt" href={`/api/v1/orgs/${orgId}/payments/${r.receipt.attemptId}/receipt.pdf`} target="_blank" rel="noreferrer">
                {t('det.receipt', { n: r.receipt.number })}
              </LinkButton>
            )}
            {r.status === 'open' && org.role !== 'viewer' && (
              <Button variant="danger" icon="ban" onClick={cancel} busy={busy}>
                {t('det.cancel')}
              </Button>
            )}
          </>
        }
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {r.mode === 'sandbox' && (
        <Alert kind="warning">
          <TestBadge label={t('common.test')} /> {t('det.testNote')}
        </Alert>
      )}

      <Card title={t('det.details')}>
        <dl className="vp-grid" style={{ margin: 0 }}>
          {[
            [t('det.reason'), r.description ?? '—'],
            [t('det.customer'), [r.customerName, r.customerEmail].filter(Boolean).join(' · ') || '—'],
            [t('det.created'), formatDate(r.createdAt, tag)],
            [r.paidAt ? t('det.paidAt') : r.status === 'open' ? t('det.expires') : t('det.validity'), formatDate(r.paidAt ?? r.expiresAt, tag)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="vp-muted vp-small">{k}</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {r.status === 'open' && (
        <Card title={t('det.share')}>
          <SharePanel req={r} orgId={orgId} />
        </Card>
      )}

      <Card title={t('det.attempts')} description={t('det.attemptsDesc')}>
        {!r.attempts.length ? (
          <p className="vp-muted" style={{ margin: 0 }}>
            {t('det.noAttempt')}
          </p>
        ) : (
          <div className="vp-table-wrap">
            <table className="vp-table vp-table-cards">
              <thead>
                <tr>
                  <th>{t('det.col.date')}</th>
                  <th>{t('det.col.provider')}</th>
                  <th>{t('req.col.status')}</th>
                  <th>{t('det.col.fee')}</th>
                  <th>{t('det.col.settlement')}</th>
                </tr>
              </thead>
              <tbody>
                {r.attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="vp-small">{formatDate(a.createdAt, tag)}</td>
                    <td className="vp-small" data-label={t('det.col.provider')}>
                      {a.providerCode === 'mock' ? 'Prestataire simulé' : a.providerCode === 'youcanpay' ? 'YouCan Pay' : a.providerCode} <span className="vp-mono vp-muted">{a.providerRef ?? ''}</span>
                      {a.method === 'card_present' && <div className="vp-small vp-muted">{t('det.cardPresent')}</div>}
                    </td>
                    <td>
                      <StatusBadge status={a.status} label={tr('status', a.status, STATUS_LABELS[a.status] ?? a.status)} />
                      {a.failureCode && <div className="vp-small vp-muted">{a.failureCode}</div>}
                      {r.mode === 'sandbox' && a.status === 'processing' && a.providerCode === 'mock' && org.role !== 'viewer' && (
                        <div className="vp-row" style={{ gap: 6, marginTop: 6 }}>
                          <Button variant="ghost" size="sm" onClick={() => resolvePending(a.id, 'succeeded')}>
                            {t('det.simOk')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => resolvePending(a.id, 'failed')}>
                            {t('det.simKo')}
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="vp-num" data-label={t('det.col.fee')}>
                      {formatMoney(a.providerFee, tag)}
                    </td>
                    <td data-label={t('det.col.settlement')}>
                      <StatusBadge status={a.settlementStatus} label={tr('status', a.settlementStatus, STATUS_LABELS[a.settlementStatus] ?? a.settlementStatus)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(succeeded.length > 0 || r.refunds.length > 0) && (
        <Card title={t('det.refunds')} description={canRefund ? t('det.refundsDesc') : undefined}>
          {r.refunds.length > 0 && (
            <div className="vp-list">
              {r.refunds.map((x) => (
                <div key={x.id} className="vp-row vp-between">
                  <span>
                    <strong className="vp-num">{formatMoney(x.amount, tag)}</strong> <span className="vp-muted">— {x.reason}</span>
                    <div className="vp-small vp-muted">{formatDate(x.createdAt, tag)}</div>
                  </span>
                  <StatusBadge status={x.status} label={tr('status', x.status, STATUS_LABELS[x.status] ?? x.status)} />
                </div>
              ))}
            </div>
          )}
          {canRefund && succeeded.map((a) => <RefundForm key={a.id} attempt={a} onDone={load} />)}
          {!canRefund && !r.refunds.length && <p className="vp-muted" style={{ margin: 0 }}>{t('det.refundOnlyAdmin')}</p>}
        </Card>
      )}

      {r.disputes.length > 0 && (
        <Card title={t('det.disputes')}>
          <div className="vp-list">
            {r.disputes.map((d) => (
              <div key={d.id} className="vp-row vp-between">
                <span>
                  {formatMoney(d.amount, tag)} — {d.reason ?? t('det.disputeDefault')}
                </span>
                <StatusBadge status={d.status} label={tr('status', d.status, STATUS_LABELS[d.status] ?? d.status)} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={t('det.history')} description={t('det.historyDesc')}>
        <ol className="vp-timeline">
          {r.events.map((e) => (
            <li key={e.id}>
              <strong>{tr('event', e.type, EVENT_LABELS[e.type] ?? e.type)}</strong>
              {e.to && (
                <>
                  {' : '}
                  {e.from ? `${tr('status', e.from, STATUS_LABELS[e.from] ?? e.from)} → ` : ''}
                  {tr('status', e.to, STATUS_LABELS[e.to] ?? e.to)}
                </>
              )}
              <div className="vp-small vp-muted">
                {formatDate(e.at, tag)} · {tr('actor', e.actor, ACTOR_LABELS[e.actor] ?? e.actor)}
                {e.reason && <> · {e.reason}</>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
