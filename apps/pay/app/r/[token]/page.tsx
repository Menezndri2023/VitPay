'use client';

import { use, useEffect, useState } from 'react';
import { Alert, api, ApiError, Button, Footer, formatDate, formatMoney, Locale, LOCALES, Logo, SandboxBanner } from '@vitpay/ui';
import { PublicRequest, useLocale } from './use-locale';

export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { locale, setLocale, t, tag } = useLocale();
  const [req, setReq] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicRequest>(`/v1/public/requests/${encodeURIComponent(token)}`)
      .then(setReq)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'notfound' : 'error'));
  }, [token]);

  const pay = async (method: PublicRequest['methods'][number]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ checkoutUrl: string }>(`/v1/public/requests/${encodeURIComponent(token)}/attempts`, { method: 'POST', body: { method } });
      window.location.assign(r.checkoutUrl);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.code === 'attempt_in_progress' ? 'pending' : 'error');
    }
  };

  if (!req && !error) return <main className="vp-narrow vp-muted" style={{ paddingTop: 80, textAlign: 'center' }}>{t('common.loading')}</main>;

  return (
    <>
      {req?.sandbox && <SandboxBanner text={t('pay.sandbox')} />}
      <main className="vp-narrow vp-stack" style={{ paddingTop: 24 }}>
        <div className="vp-row vp-between">
          <Logo href="#" />
          <select aria-label="Langue" className="vp-input" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
              </option>
            ))}
          </select>
        </div>

        {error === 'notfound' && <Alert kind="danger">{t('pay.notfound')}</Alert>}

        {req && (
          <section className="vp-card vp-stack">
            <div className="vp-muted vp-small">{t('pay.title')}</div>
            <div>
              <div className="vp-muted vp-small">{t('pay.beneficiary')}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                {req.beneficiary.displayName}{' '}
                {req.beneficiary.verified && <span className="vp-badge vp-badge-success">✓ {t('pay.verified')}</span>}
              </div>
            </div>
            <div className="vp-amount">{formatMoney(req.amount, tag)}</div>
            {req.description && (
              <div>
                <div className="vp-muted vp-small">{t('pay.reason')}</div>
                <div>{req.description}</div>
              </div>
            )}
            <div className="vp-row vp-between vp-small vp-muted">
              <span>
                {t('pay.reference')} <span className="vp-mono">{req.reference}</span>
              </span>
              {req.status === 'open' && (
                <span>
                  {t('pay.expires')} {formatDate(req.expiresAt, tag)}
                </span>
              )}
            </div>

            {req.status === 'paid' && (
              <>
                <Alert kind="success">{t('pay.status.paid')}</Alert>
                <a className="vp-btn vp-btn-ghost" href={`/api/v1/public/requests/${encodeURIComponent(token)}/receipt.pdf`}>
                  {t('pay.receipt')}
                </a>
              </>
            )}
            {req.status === 'expired' && <Alert kind="warning">{t('pay.status.expired')}</Alert>}
            {req.status === 'cancelled' && <Alert kind="warning">{t('pay.status.cancelled')}</Alert>}
            {req.status === 'open' && !req.payable && <Alert kind="warning">{t('pay.unavailable')}</Alert>}

            {req.payable && (
              <div className="vp-stack">
                <h2 style={{ margin: '8px 0 0' }}>{t('pay.choose')}</h2>
                {req.methods.map((m) => (
                  <Button key={m} block variant="accent" disabled={busy} onClick={() => pay(m)}>
                    {t(`pay.method.${m}`)}
                  </Button>
                ))}
                <p className="vp-muted vp-small" style={{ margin: 0 }}>
                  {t('pay.redirect')}
                </p>
                {error === 'pending' && (
                  <Alert kind="info">
                    {t('pay.status.pending')} <a href={`/r/${encodeURIComponent(token)}/status`}>→</a>
                  </Alert>
                )}
                {error === 'error' && <Alert kind="danger">{t('common.error')}</Alert>}
              </div>
            )}
          </section>
        )}

        <Alert kind="info">🔒 {t('pay.never')}</Alert>
        <p className="vp-muted vp-small" style={{ textAlign: 'center' }}>
          {t('pay.processedBy')}
        </p>
        <Footer />
      </main>
    </>
  );
}
