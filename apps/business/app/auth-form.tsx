'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { Alert, Button, Icon, Logo } from '@vitpay/ui';
import { LangSwitch, useT, type MsgKey } from './i18n';

const POINTS: MsgKey[] = ['auth.p1', 'auth.p2', 'auth.p3'];

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="vp-auth">
      <aside className="vp-auth-side">
        <Logo suffix="Business" />
        <div>
          <h2>{t('auth.tagline')}</h2>
          <p>{t('auth.pitch')}</p>
          <ul className="vp-auth-points">
            {POINTS.map((p) => (
              <li key={p}>
                <Icon name="check" />
                {t(p)}
              </li>
            ))}
          </ul>
        </div>
        <p className="vp-small" style={{ color: '#8fb3a0' }}>
          {t('auth.product')}
        </p>
      </aside>
      <main className="vp-auth-main">
        <div className="vp-auth-card">
          <div className="vp-row vp-between">
            <span className="vp-auth-mobile-logo">
              <Logo suffix="Business" />
            </span>
            <span style={{ marginInlineStart: 'auto' }}>
              <LangSwitch />
            </span>
          </div>
          <div>
            <h1>{title}</h1>
            {subtitle && (
              <p className="vp-muted" style={{ margin: '6px 0 0' }}>
                {subtitle}
              </p>
            )}
          </div>
          {children}
          {footer}
        </div>
      </main>
    </div>
  );
}

export function useSubmit(fn: (data: FormData) => Promise<void>) {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError(err instanceof TypeError ? t('auth.netError') : (err as Error).message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  return {
    onSubmit,
    error,
    busy,
    ErrorBox: () => (error ? <Alert kind="danger">{error}</Alert> : null),
    Submit: ({ label }: { label: string }) => (
      <Button type="submit" block size="lg" busy={busy}>
        {label}
      </Button>
    ),
  };
}
