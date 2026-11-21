'use client';

import { useRouter } from 'next/navigation';
import { api, ApiError, Field, Select } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';
import { useT } from '../i18n';

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useT();
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      const r = await api<{ organizationId: string }>('/v1/auth/register', {
        method: 'POST',
        body: {
          email: fd.get('email'),
          password: fd.get('password'),
          fullName: fd.get('fullName'),
          organizationName: fd.get('organizationName'),
          organizationType: fd.get('organizationType'),
        },
      });
      try {
        localStorage.setItem('vp_org', r.organizationId);
      } catch {
        /* ignore */
      }
      router.push('/app/settings?welcome=1');
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const d = e.details as { password?: string } | undefined;
        throw new Error(d?.password ? t('reg.weak') : t('reg.check'));
      }
      throw new Error(t('reg.failed'));
    }
  });
  return (
    <AuthCard title={t('reg.title')} subtitle={t('reg.subtitle')} footer={<p className="vp-small" style={{ textAlign: 'center', margin: 0 }}>{t('reg.already')} <a href="/login">{t('login.submit')}</a></p>}>
      <form className="vp-stack" onSubmit={onSubmit}>
        <Field label={t('reg.name')} name="fullName" autoComplete="name" required minLength={2} />
        <Field label={t('reg.email')} name="email" type="email" autoComplete="email" required dir="ltr" />
        <Field label={t('reg.password')} name="password" type="password" autoComplete="new-password" required minLength={12} dir="ltr" hint={t('reg.passwordHint')} />
        <Field label={t('reg.org')} name="organizationName" required minLength={2} hint={t('reg.orgHint')} />
        <Select label={t('reg.type')} name="organizationType" defaultValue="business">
          <option value="business">{t('reg.business')}</option>
          <option value="personal">{t('reg.personal')}</option>
        </Select>
        <ErrorBox />
        <Submit label={t('reg.submit')} />
        <p className="vp-muted vp-small" style={{ margin: 0 }}>
          {t('reg.terms')}
        </p>
      </form>
    </AuthCard>
  );
}
