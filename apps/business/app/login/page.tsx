'use client';

import { useRouter } from 'next/navigation';
import { api, ApiError, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';
import { safeNext } from '../safe-next';
import { useT } from '../i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useT();
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      const r = await api<{ mfaRequired: boolean }>('/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      // Redirection interne uniquement (pas d'open redirect).
      const target = safeNext(new URLSearchParams(window.location.search).get('next'));
      router.push(r.mfaRequired ? `/mfa?next=${encodeURIComponent(target)}` : target);
    } catch (e) {
      throw new Error(e instanceof ApiError && e.status === 429 ? t('login.locked') : t('login.bad'));
    }
  });
  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')} footer={<p className="vp-small" style={{ textAlign: 'center', margin: 0 }}>{t('login.noAccount')} <a href="/register">{t('login.create')}</a></p>}>
      <form className="vp-stack" onSubmit={onSubmit}>
        <Field label={t('login.email')} name="email" type="email" autoComplete="email" required dir="ltr" />
        <Field label={t('login.password')} name="password" type="password" autoComplete="current-password" required dir="ltr" />
        <ErrorBox />
        <a className="vp-small" href="/forgot-password" style={{ alignSelf: 'flex-end', marginTop: -4 }}>
          {t('login.forgot')}
        </a>
        <Submit label={t('login.submit')} />
      </form>
    </AuthCard>
  );
}
