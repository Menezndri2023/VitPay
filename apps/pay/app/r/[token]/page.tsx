'use client';

import { use, useEffect, useState } from 'react';
import { Alert, api, ApiError, Button, formatDate, formatMoney, Icon, initials, Locale, LOCALES, Logo, SandboxBanner, Skeleton } from '@vitpay/ui';
import { PublicRequest, useLocale } from './use-locale';

const METHOD_ICON = { card: 'card', bank_transfer: 'building', mobile_money: 'wallet' } as const;

export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { locale, setLocale, t, tag } = useLocale();
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api<PublicRequest>(`/v1/public/requests/${encodeURIComponent(token)}`)
      .then((r) => {
        setReq(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'notfound' : 'loaderror'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Retour arrière depuis la page du prestataire (cache navigateur) : le bouton ne doit pas rester bloqué.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setBusy(null);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const pay = async (method: PublicRequest['methods'][number]) => {
    if (busy) return;
    setBusy(method);
    setError(null);
    try {
      const r = await api<{ checkoutUrl: string }>(`/v1/public/requests/${encodeURIComponent(token)}/attempts`, { method: 'POST', body: { method } });
      window.location.assign(r.checkoutUrl);
    } catch (e) {
      setBusy(null);
      setError(e instanceof ApiError && e.code === 'attempt_in_progress' ? 'pending' : 'error');
      if (e instanceof ApiError && e.status === 409) void load();
    }
  };

  const langSelect = (
    <select aria-label={t('pay.language')} className="vp-input vp-lang" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
        </option>
      ))}
    </select>
  );

  return (
    <div className="vp-pay">
      {req?.sandbox && <SandboxBanner text={t('pay.sandbox')} />}
      <main className="vp-pay-wrap">
        <div className="vp-row vp-between">
          <Logo href="#" />
          {langSelect}
        </div>

        {!req && !error && (
          <div className="vp-ticket" aria-busy="true">
            <div className="vp-ticket-top vp-stack">
              <span className="vp-sr">{t('common.loading')}</span>
              <Skeleton height={44} width="60%" />
              <Skeleton height={48} width="70%" style={{ marginTop: 18 }} />
            </div>
          </div>
        )}

        {error === 'notfound' && (
          <div className="vp-ticket">
            <div className="vp-ticket-top vp-stack" style={{ textAlign: 'center' }}>
              <div className="vp-result-icon vp-result-neutral">
                <Icon name="link" />
              </div>
              <h1 style={{ margin: 0, fontSize: 20 }}>{t('pay.notfound')}</h1>
              <p className="vp-muted" style={{ margin: 0 }}>
                {t('pay.notfound.desc')}
              </p>
            </div>
          </div>
        )}
        {error === 'loaderror' && !req && (
          <Alert kind="danger">
            {t('common.error')}{' '}
            <button type="button" className="vp-link-btn" onClick={() => void load()}>
              {t('pay.retry')}
            </button>
          </Alert>
        )}

        {req && (
          <section className="vp-ticket" aria-labelledby="pay-amount">
            <div className="vp-ticket-top">
              <div className="vp-ticket-merchant">
                <div className="vp-avatar" aria-hidden="true">
                  {initials(req.beneficiary.displayName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="vp-muted vp-small">{t('pay.beneficiary')}</div>
                  <div style={{ fontWeight: 700, fontSize: 17, overflowWrap: 'anywhere' }}>{req.beneficiary.displayName}</div>
                </div>
              </div>
              {req.beneficiary.verified && (
                <div className="vp-trust" style={{ marginTop: 10 }}>
                  <Icon name="shield" />
                  <span>{t('pay.verified')}</span>
                </div>
              )}
              <div className="vp-ticket-amount">
                <div className="vp-muted vp-small">{t('pay.amountDue')}</div>
                <div className="vp-amount" id="pay-amount">
                  {formatMoney(req.amount, tag)}
                </div>
              </div>
              {req.description && <div style={{ fontSize: 15 }}>{req.description}</div>}
            </div>

            <div className="vp-ticket-tear" aria-hidden="true" />

            <div className="vp-ticket-bottom">
              <dl className="vp-kv">
                <dt>{t('pay.reference')}</dt>
                <dd className="vp-mono">{req.reference}</dd>
                {req.status === 'open' && (
                  <>
                    <dt>{t('pay.expires')}</dt>
                    <dd>{formatDate(req.expiresAt, tag)}</dd>
                  </>
                )}
              </dl>

              {req.status === 'paid' && (
                <>
                  <Alert kind="success">{t('pay.status.paid')}</Alert>
                  <a className="vp-btn vp-btn-ghost" href={`/api/v1/public/requests/${encodeURIComponent(token)}/receipt.pdf`}>
                    <Icon name="receipt" />
                    {t('pay.receipt')}
                  </a>
                </>
              )}
              {req.status === 'expired' && <Alert kind="warning">{t('pay.status.expired')}</Alert>}
              {req.status === 'cancelled' && <Alert kind="warning">{t('pay.status.cancelled')}</Alert>}
              {req.status === 'open' && !req.payable && <Alert kind="warning">{t('pay.unavailable')}</Alert>}

              {req.payable && (
                <div className="vp-stack">
                  <h2 style={{ margin: '4px 0 0', fontSize: 16 }}>{t('pay.choose')}</h2>
                  {req.methods.map((m) => (
                    <Button key={m} block size="lg" disabled={!!busy} busy={busy === m} icon={METHOD_ICON[m]} onClick={() => pay(m)}>
                      {t(`pay.method.${m}`)}
                    </Button>
                  ))}
                  <div className="vp-trust">
                    <Icon name="lock" />
                    <span>{t('pay.redirect')}</span>
                  </div>
                  {error === 'pending' && (
                    <Alert kind="info">
                      {t('pay.status.pending')} <a href={`/r/${encodeURIComponent(token)}/status`}>{t('pay.status.pending.desc')}</a>
                    </Alert>
                  )}
                  {error === 'error' && <Alert kind="danger">{t('common.error')}</Alert>}
                </div>
              )}
              {req.returnUrl && req.status !== 'paid' && (
                <a className="vp-btn vp-btn-ghost" href={req.returnUrl} rel="noreferrer">
                  {req.payable ? t('pay.cancelAndBack') : t('pay.backToMerchant')}
                </a>
              )}
              {req.returnUrl && req.status === 'paid' && (
                <a className="vp-btn" href={req.returnUrl} rel="noreferrer">
                  {t('pay.backToMerchant')}
                </a>
              )}
            </div>
          </section>
        )}

        <div className="vp-trust" style={{ padding: '0 4px' }}>
          <Icon name="shield" />
          <span>{t('pay.never')}</span>
        </div>
        <p className="vp-muted vp-small" style={{ textAlign: 'center', margin: '8px 0 0' }}>
          {t('pay.processedBy')}
        </p>
      </main>
    </div>
  );
}
