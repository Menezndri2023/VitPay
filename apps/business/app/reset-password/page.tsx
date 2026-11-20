'use client';

import { useEffect, useState } from 'react';
import { Alert, api, ApiError, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token')), []);
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    if (fd.get('password') !== fd.get('confirm')) throw new Error('Les deux mots de passe ne correspondent pas.');
    try {
      await api('/v1/auth/password/reset', { method: 'POST', body: { token, password: fd.get('password') } });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) throw new Error('Mot de passe trop faible : 12 caractères minimum, sans votre e-mail.');
      throw new Error('Lien invalide ou expiré. Refaites une demande.');
    }
  });
  return (
    <AuthCard title="Nouveau mot de passe">
      {done ? (
        <Alert kind="success">
          Mot de passe modifié. Toutes vos sessions ont été fermées. <a href="/login">Se connecter</a>
        </Alert>
      ) : !token ? (
        <Alert kind="danger">Lien incomplet.</Alert>
      ) : (
        <form className="vp-stack" onSubmit={onSubmit}>
          <Field label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} hint="12 caractères minimum" />
          <Field label="Confirmation" name="confirm" type="password" autoComplete="new-password" required minLength={12} />
          <ErrorBox />
          <Submit label="Enregistrer" />
        </form>
      )}
    </AuthCard>
  );
}
