'use client';

import { useEffect, useState } from 'react';
import { Alert, api, Button } from '@vitpay/ui';
import { AuthCard } from '../auth-form';

/**
 * Ouverture du lien reçu par e-mail : fonctionne aussi sur un autre appareil (pas de session requise).
 * La confirmation exige un clic : les analyseurs de liens des messageries ne valident rien en ouvrant la page.
 */
export default function VerifyEmailPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token')), []);
  const confirm = async () => {
    setState('busy');
    try {
      await api('/v1/auth/email/verify', { method: 'POST', body: { token } });
      setState('ok');
    } catch {
      setState('error');
    }
  };
  return (
    <AuthCard title="Confirmation de l’adresse e-mail">
      {token === null && <Alert kind="danger">Lien incomplet.</Alert>}
      {token && (state === 'idle' || state === 'busy') && (
        <div className="vp-stack">
          <p>Vous avez créé un compte VITPAY avec cette adresse ? Confirmez-la pour activer toutes les fonctions.</p>
          <Button onClick={confirm} disabled={state === 'busy'}>
            Confirmer mon adresse
          </Button>
          <p className="vp-small vp-muted">Si vous n’êtes pas à l’origine de cette inscription, fermez simplement cette page.</p>
        </div>
      )}
      {state === 'ok' && (
        <Alert kind="success">
          Adresse confirmée. <a href="/app">Accéder à mon espace</a>
        </Alert>
      )}
      {state === 'error' && <Alert kind="danger">Lien invalide, expiré ou déjà utilisé. Connectez-vous pour en recevoir un nouveau.</Alert>}
    </AuthCard>
  );
}
