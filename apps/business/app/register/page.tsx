'use client';

import { useRouter } from 'next/navigation';
import { api, ApiError, Field, Select } from '@vitpay/ui';
import { AuthCard, useSubmit } from '../auth-form';

export default function RegisterPage() {
  const router = useRouter();
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
        throw new Error(d?.password ? 'Mot de passe trop faible : 12 caractères minimum, sans votre e-mail.' : 'Vérifiez les champs du formulaire.');
      }
      throw new Error('Inscription impossible. Vérifiez vos informations.');
    }
  });
  return (
    <AuthCard title="Créer un compte" footer={<p className="vp-small" style={{ textAlign: 'center' }}>Déjà inscrit ? <a href="/login">Se connecter</a></p>}>
      <form className="vp-stack" onSubmit={onSubmit}>
        <Field label="Nom complet" name="fullName" autoComplete="name" required minLength={2} />
        <Field label="E-mail professionnel" name="email" type="email" autoComplete="email" required />
        <Field label="Mot de passe" name="password" type="password" autoComplete="new-password" required minLength={12} hint="12 caractères minimum" />
        <Field label="Nom commercial" name="organizationName" required minLength={2} hint="Affiché aux payeurs sur la page de paiement" />
        <Select label="Type de compte" name="organizationType" defaultValue="business">
          <option value="business">Entreprise / indépendant</option>
          <option value="personal">Particulier</option>
        </Select>
        <ErrorBox />
        <Submit label="Créer mon compte" />
        <p className="vp-muted vp-small" style={{ margin: 0 }}>
          En créant un compte, vous acceptez les conditions d’utilisation de VITPAY (à publier après validation juridique).
        </p>
      </form>
    </AuthCard>
  );
}
