'use client';

import { useRouter } from 'next/navigation';
import { api, ApiError, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';
import { safeNext } from '../safe-next';

export default function LoginPage() {
  const router = useRouter();
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      const r = await api<{ mfaRequired: boolean }>('/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      // Redirection interne uniquement (pas d'open redirect).
      const target = safeNext(new URLSearchParams(window.location.search).get('next'));
      router.push(r.mfaRequired ? `/mfa?next=${encodeURIComponent(target)}` : target);
    } catch (e) {
      throw new Error(e instanceof ApiError && e.status === 429 ? 'Compte temporairement verrouillé. Réessayez dans 15 minutes.' : 'E-mail ou mot de passe incorrect.');
    }
  });
  return (
    <AuthCard title="Connexion" footer={<p className="vp-small" style={{ textAlign: 'center' }}>Pas encore de compte ? <a href="/register">Créer un compte</a></p>}>
      <form className="vp-stack" onSubmit={onSubmit}>
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" required />
        <ErrorBox />
        <Submit label="Se connecter" />
        <a className="vp-small" href="/forgot-password" style={{ textAlign: 'center' }}>
          Mot de passe oublié ?
        </a>
      </form>
    </AuthCard>
  );
}
