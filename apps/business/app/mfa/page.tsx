'use client';

import { useRouter } from 'next/navigation';
import { api, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';

export default function MfaPage() {
  const router = useRouter();
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      await api('/v1/auth/mfa/verify', { method: 'POST', body: { code: String(fd.get('code') ?? '').trim() } });
      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/app');
    } catch {
      throw new Error('Code invalide.');
    }
  });
  return (
    <AuthCard title="Vérification en deux étapes">
      <form className="vp-stack" onSubmit={onSubmit}>
        <Field label="Code à 6 chiffres" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
        <ErrorBox />
        <Submit label="Vérifier" />
      </form>
    </AuthCard>
  );
}
