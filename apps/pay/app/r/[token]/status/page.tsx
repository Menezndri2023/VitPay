'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Alert, api, Footer, formatMoney, Logo, SandboxBanner } from '@vitpay/ui';
import { PublicRequest, useLocale } from '../use-locale';

const POLL_MS = 2000;
const MAX_POLLS = 90;

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
        const pending = r.status === 'open' && r.latestAttempt && ['created', 'pending', 'requires_action', 'processing', 'authorized', 'captured'].includes(r.latestAttempt.status);
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

  return (
    <>
      {req?.sandbox && <SandboxBanner text={t('pay.sandbox')} />}
      <main className="vp-narrow vp-stack" style={{ paddingTop: 24 }}>
        <Logo href="#" />
        <section className="vp-card vp-stack" aria-live="polite">
          {!req && <p className="vp-muted">{t('common.loading')}</p>}
          {req && (
            <>
              <div className="vp-muted vp-small">{req.beneficiary.displayName}</div>
              <div className="vp-amount">{formatMoney(req.amount, tag)}</div>
            </>
          )}
          {req?.status === 'paid' && (
            <>
              <Alert kind="success">
                <strong>{t('pay.status.paid')}</strong> — {t('pay.status.paid.desc')}
              </Alert>
              <a className="vp-btn vp-btn-ghost" href={`/api/v1/public/requests/${encodeURIComponent(token)}/receipt.pdf`}>
                {t('pay.receipt')}
              </a>
            </>
          )}
          {pending && !timedOut && (
            <Alert kind="info">
              <strong>{t('pay.status.pending')}</strong> {t('pay.status.pending.desc')}
            </Alert>
          )}
          {failed && (
            <>
              <Alert kind="danger">
                <strong>{t('pay.status.failed')}</strong> — {t('pay.status.failed.desc')}
              </Alert>
              <a className="vp-btn" href={`/r/${encodeURIComponent(token)}`}>
                {t('pay.retry')}
              </a>
            </>
          )}
          {req?.status === 'expired' && <Alert kind="warning">{t('pay.status.expired')}</Alert>}
          {req?.status === 'cancelled' && <Alert kind="warning">{t('pay.status.cancelled')}</Alert>}
          {timedOut && <Alert kind="warning">{t('pay.status.pending.desc')}</Alert>}
        </section>
        <Footer />
      </main>
    </>
  );
}
