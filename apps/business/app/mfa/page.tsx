'use client';

import { useRouter } from 'next/navigation';
import { api, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';
import { safeNext } from '../safe-next';

export default function MfaPage() {
  const router = useRouter();
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      await api('/v1/auth/mfa/verify', { method: 'POST', body: { code: String(fd.get('code') ?? '').trim() } });
      router.push(safeNext(new URLSearchParams(window.location.search).get('next')));
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
