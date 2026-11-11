'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, api, ApiError, Button, Field } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../../auth-form';

interface Invitation {
  organization: string;
  role: string;
  email: string;
  accountExists: boolean;
}
const ROLE: Record<string, string> = { admin: 'Administrateur', cashier: 'Caissier', viewer: 'Lecture seule' };

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [inv, setInv] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ email: string } | null>(null);

  useEffect(() => {
    api<Invitation>(`/v1/invitations/${encodeURIComponent(token)}`)
      .then(setInv)
      .catch(() => setError('Cette invitation est invalide, expirée ou déjà utilisée.'));
    api<{ user: { email: string } }>('/v1/auth/me')
      .then((m) => setMe(m.user))
      .catch(() => setMe(null));
  }, [token]);

  const goToOrg = (orgId: string) => {
    try {
      localStorage.setItem('vp_org', orgId);
    } catch {
      /* ignore */
    }
    router.push('/app');
  };

  const accept = async () => {
    try {
      const r = await api<{ orgId: string }>(`/v1/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      goToOrg(r.orgId);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'Vous êtes connecté avec un autre compte que celui invité.' : 'Impossible d’accepter l’invitation.');
    }
  };

  const { onSubmit, ErrorBox, Submit } = useSubmit(async (fd) => {
    try {
      const r = await api<{ organizationId: string }>(`/v1/invitations/${encodeURIComponent(token)}/register`, {
        method: 'POST',
        body: { fullName: fd.get('fullName'), password: fd.get('password') },
      });
      goToOrg(r.organizationId);
    } catch (e) {
      throw new Error(e instanceof ApiError && e.status === 422 ? 'Mot de passe trop faible : 12 caractères minimum.' : 'Création du compte impossible.');
    }
  });

  return (
    <AuthCard title="Invitation">
      {error && <Alert kind="danger">{error}</Alert>}
      {inv && (
        <>
          <p style={{ margin: 0 }}>
            Vous êtes invité à rejoindre <strong>{inv.organization}</strong> en tant que <strong>{ROLE[inv.role] ?? inv.role}</strong>.
          </p>
          <p className="vp-muted vp-small" style={{ margin: 0 }}>
            Invitation envoyée à {inv.email}
          </p>
          {me ? (
            me.email.toLowerCase() === inv.email.toLowerCase() ? (
              <Button block onClick={accept}>
                Accepter l’invitation
              </Button>
            ) : (
              <Alert kind="warning">Vous êtes connecté en tant que {me.email}. Déconnectez-vous puis connectez-vous avec {inv.email}.</Alert>
            )
          ) : inv.accountExists ? (
            <a className="vp-btn vp-btn-block" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
              Se connecter pour accepter
            </a>
          ) : (
            <form className="vp-stack" onSubmit={onSubmit}>
              <Field label="Nom complet" name="fullName" autoComplete="name" required minLength={2} />
              <Field label="Mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} hint="12 caractères minimum" />
              <ErrorBox />
              <Submit label="Créer mon compte et rejoindre" />
            </form>
          )}
        </>
      )}
    </AuthCard>
  );
}
