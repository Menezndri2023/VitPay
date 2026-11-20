'use client';

import { use, useEffect, useRef, useState } from 'react';
import { api, formatMoney, Icon, Logo, SandboxBanner, Skeleton } from '@vitpay/ui';
import { PublicRequest, useLocale } from '../use-locale';

const POLL_MS = 2000;
const MAX_POLLS = 90;
const REDIRECT_MS = 5000;
const LIVE = ['created', 'pending', 'requires_action', 'processing', 'authorized', 'captured'];

/**
 * Page de retour : elle n'utilise JAMAIS les paramètres d'URL renvoyés par le prestataire.
 * Le statut affiché vient uniquement de l'API VITPAY, qui interroge le prestataire côté serveur.
 */
export default function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t, tag } = useLocale();
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<PublicRequest>(`/v1/public/requests/${encodeURIComponent(token)}/status`);
        if (stop) return;
        setReq(r);
        const pending = r.status === 'open' && r.latestAttempt && LIVE.includes(r.latestAttempt.status);
        if (!pending) return;
      } catch {
        /* nouvel essai */
      }
      polls.current += 1;
      if (polls.current >= MAX_POLLS) setTimedOut(true);
      else timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [token]);

  const failed = req?.status === 'open' && req.latestAttempt && ['failed', 'cancelled', 'expired'].includes(req.latestAttempt.status);
  const pending = req?.status === 'open' && !failed;
  const paidReturn = req?.status === 'paid' ? req.returnUrl : null;

  // Paiement confirmé : retour automatique vers le site du commerçant après quelques secondes.
  useEffect(() => {
    if (!paidReturn) return;
    const timer = setTimeout(() => window.location.assign(paidReturn), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [paidReturn]);

  const result = !req
    ? null
    : req.status === 'paid'
      ? { cls: 'vp-result-ok', icon: 'check' as const, title: t('pay.status.paid'), desc: t('pay.status.paid.desc') }
      : failed
        ? { cls: 'vp-result-ko', icon: 'close' as const, title: t('pay.status.failed'), desc: t('pay.status.failed.desc') }
        : req.status === 'expired'
          ? { cls: 'vp-result-neutral', icon: 'clock' as const, title: t('pay.status.expired'), desc: '' }
          : req.status === 'cancelled'
            ? { cls: 'vp-result-neutral', icon: 'ban' as const, title: t('pay.status.cancelled'), desc: '' }
            : { cls: 'vp-result-wait', icon: 'clock' as const, title: t('pay.status.pending'), desc: t('pay.status.pending.desc') };

  return (
    <div className="vp-pay">
      {req?.sandbox && <SandboxBanner text={t('pay.sandbox')} />}
      <main className="vp-pay-wrap">
        <Logo href="#" />
        <section className="vp-ticket" aria-live="polite">
          <div className="vp-ticket-top vp-stack" style={{ textAlign: 'center', alignItems: 'center' }}>
            {!req || !result ? (
              <>
                <span className="vp-sr">{t('common.loading')}</span>
                <Skeleton height={64} width={64} style={{ borderRadius: '50%' }} />
                <Skeleton height={28} width="60%" />
              </>
            ) : (
              <>
                <div className={`vp-result-icon ${result.cls}`}>{pending && !timedOut ? <span className="vp-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} aria-hidden="true" /> : <Icon name={result.icon} />}</div>
                <h1 style={{ margin: 0, fontSize: 21 }}>{result.title}</h1>
                {result.desc && (
                  <p className="vp-muted" style={{ margin: 0, maxWidth: '36ch' }}>
                    {result.desc}
                  </p>
                )}
              </>
            )}
          </div>
          {req && (
            <>
              <div className="vp-ticket-tear" aria-hidden="true" />
              <div className="vp-ticket-bottom">
                <dl className="vp-kv">
                  <dt>{t('pay.beneficiary')}</dt>
                  <dd>{req.beneficiary.displayName}</dd>
                  <dt>{t('pay.amountDue')}</dt>
                  <dd className="vp-amount" style={{ fontSize: 20 }}>
                    {formatMoney(req.amount, tag)}
                  </dd>
                  <dt>{t('pay.reference')}</dt>
                  <dd className="vp-mono">{req.reference}</dd>
                </dl>
                {req.status === 'paid' && (
                  <a className="vp-btn vp-btn-ghost" href={`/api/v1/public/requests/${encodeURIComponent(token)}/receipt.pdf`}>
                    <Icon name="receipt" />
                    {t('pay.receipt')}
                  </a>
                )}
                {paidReturn && (
                  <>
                    <p className="vp-muted vp-small" style={{ margin: 0, textAlign: 'center' }}>
                      {t('pay.redirecting')}
                    </p>
                    <a className="vp-btn" href={paidReturn} rel="noreferrer">
                      {t('pay.backToMerchant')}
                    </a>
                  </>
                )}
                {failed && (
                  <a className="vp-btn" href={`/r/${encodeURIComponent(token)}`}>
                    <Icon name="refresh" />
                    {t('pay.retry')}
                  </a>
                )}
                {timedOut && pending && <p className="vp-muted vp-small" style={{ margin: 0 }}>{t('pay.status.pending.desc')}</p>}
                {req.returnUrl && req.status !== 'paid' && (failed || req.status !== 'open') && (
                  <a className="vp-btn vp-btn-ghost" href={req.returnUrl} rel="noreferrer">
                    {t('pay.backToMerchant')}
                  </a>
                )}
              </div>
            </>
          )}
        </section>
        <p className="vp-muted vp-small" style={{ textAlign: 'center', margin: 0 }}>
          {t('pay.processedBy')}
        </p>
      </main>
    </div>
  );
}
