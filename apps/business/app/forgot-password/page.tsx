'use client';

import { useState } from 'react';
import { Alert, api, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    await api('/v1/auth/password/forgot', { method: 'POST', body: { email: fd.get('email') } }).catch(() => {
      throw new Error('Trop de demandes. Réessayez dans une minute.');
    });
    setSent(true);
  });
  return (
    <AuthCard title="Mot de passe oublié" footer={<p className="vp-small" style={{ textAlign: 'center' }}><a href="/login">Retour à la connexion</a></p>}>
      {sent ? (
        <Alert kind="success">Si un compte existe pour cette adresse, un lien de réinitialisation (valable 30 minutes) vient d’être envoyé.</Alert>
      ) : (
        <form className="vp-stack" onSubmit={onSubmit}>
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <ErrorBox />
          <Submit label="Recevoir un lien" />
        </form>
      )}
    </AuthCard>
  );
}
