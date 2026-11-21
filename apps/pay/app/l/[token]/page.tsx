'use client';

import { FormEvent, use, useEffect, useState } from 'react';
import { Alert, api, ApiError, Button, formatMoney, Icon, initials, Locale, LOCALES, Logo, SandboxBanner, Skeleton } from '@vitpay/ui';
import { useLocale } from '../../r/[token]/use-locale';

interface PublicLink {
  title: string;
  description: string | null;
  beneficiary: { displayName: string; verified: boolean };
  amount: { minor: string; value: string; currency: string } | null;
  currency: string;
  sandbox: boolean;
  active: boolean;
}

/**
 * Lien de paiement réutilisable : le client confirme (ou saisit) le montant, VITPAY crée une
 * demande à son nom puis l'envoie sur la page de paiement habituelle (/r/…).
 */
export default function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { locale, setLocale, t, tag } = useLocale();
  const [link, setLink] = useState<PublicLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicLink>(`/v1/public/links/${encodeURIComponent(token)}`)
      .then(setLink)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'notfound' : 'error'));
  }, [token]);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const amount = String(new FormData(e.currentTarget).get('amount') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>(`/v1/public/links/${encodeURIComponent(token)}/requests`, { method: 'POST', body: link?.amount ? {} : { amount } });
      window.location.assign(`/r/${encodeURIComponent(r.token)}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.status === 422 ? 'amount' : err instanceof ApiError && err.status === 409 ? 'inactive' : 'error');
    }
  };

  return (
    <div className="vp-pay">
      {link?.sandbox && <SandboxBanner text={t('pay.sandbox')} />}
      <main className="vp-pay-wrap">
        <div className="vp-row vp-between">
          <Logo href="#" />
          <select aria-label={t('pay.language')} className="vp-input vp-lang" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l === 'fr' ? 'Français' : l === 'ar' ? 'العربية' : 'English'}
              </option>
            ))}
          </select>
        </div>

        {!link && !error && (
          <div className="vp-ticket">
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

        {error === 'error' && !link && <Alert kind="danger">{t('common.error')}</Alert>}

        {link && (
          <form className="vp-ticket" onSubmit={submit}>
            <div className="vp-ticket-top">
              <div className="vp-ticket-merchant">
                <div className="vp-avatar" aria-hidden="true">
                  {initials(link.beneficiary.displayName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="vp-muted vp-small">{t('pay.beneficiary')}</div>
                  <div style={{ fontWeight: 700, fontSize: 17, overflowWrap: 'anywhere' }}>{link.beneficiary.displayName}</div>
                </div>
              </div>
              {link.beneficiary.verified && (
                <div className="vp-trust" style={{ marginTop: 10 }}>
                  <Icon name="shield" />
                  <span>{t('pay.verified')}</span>
                </div>
              )}
              <h1 style={{ margin: '20px 0 4px', fontSize: 19 }}>{link.title}</h1>
              {link.description && <p style={{ margin: 0 }}>{link.description}</p>}
              {link.amount ? (
                <div className="vp-ticket-amount">
                  <div className="vp-muted vp-small">{t('pay.amountDue')}</div>
                  <div className="vp-amount">{formatMoney(link.amount, tag)}</div>
                </div>
              ) : (
                link.active && (
                  <div className="vp-field" style={{ marginTop: 18 }}>
                    <label className="vp-label" htmlFor="amount">
                      {t('link.amount')} ({link.currency})
                    </label>
                    <input
                      id="amount"
                      name="amount"
                      className="vp-input vp-num"
                      inputMode="decimal"
                      required
                      autoFocus
                      dir="ltr"
                      pattern="^\s*\d[\d\s]*([.,]\d{1,2})?\s*$"
                      placeholder="0,00"
                      style={{ fontSize: 26, fontWeight: 750, minHeight: 60 }}
                      aria-describedby="amount-hint"
                    />
                    <span className="vp-hint" id="amount-hint">
                      {t('link.amountHint')}
                    </span>
                  </div>
                )
              )}
            </div>
            <div className="vp-ticket-tear" aria-hidden="true" />
            <div className="vp-ticket-bottom">
              {!link.active || error === 'inactive' ? (
                <Alert kind="warning">{t('link.inactive')}</Alert>
              ) : (
                <>
                  <Button type="submit" block size="lg" icon="card" busy={busy}>
                    {t('link.continue')}
                  </Button>
                  <div className="vp-trust">
                    <Icon name="lock" />
                    <span>{t('pay.redirect')}</span>
                  </div>
                </>
              )}
              {error === 'amount' && <Alert kind="danger">{t('link.invalidAmount')}</Alert>}
              {error === 'error' && <Alert kind="danger">{t('common.error')}</Alert>}
            </div>
          </form>
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
