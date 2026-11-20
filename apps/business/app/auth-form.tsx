'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { Alert, Button, Icon, Logo } from '@vitpay/ui';

const POINTS = [
  'Liens et QR codes de paiement par carte, partagés par WhatsApp, SMS ou e-mail',
  'Votre propre compte prestataire : les fonds vous sont versés directement',
  'Suivi en temps réel, reçus, remboursements et export comptable',
];

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="vp-auth">
      <aside className="vp-auth-side">
        <Logo suffix="Business" />
        <div>
          <h2>Encaissez vos clients en un lien.</h2>
          <p>VITPAY relie votre activité à votre prestataire de paiement agréé, sans détenir vos fonds.</p>
          <ul className="vp-auth-points">
            {POINTS.map((p) => (
              <li key={p}>
                <Icon name="check" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="vp-small" style={{ color: '#8fb3a0' }}>
          VITPAY · un produit VIT GLOBAL TECHNOLOGIES
        </p>
      </aside>
      <main className="vp-auth-main">
        <div className="vp-auth-card">
          <div className="vp-auth-mobile-logo">
            <Logo suffix="Business" />
          </div>
          <div>
            <h1>{title}</h1>
            {subtitle && (
              <p className="vp-muted" style={{ margin: '6px 0 0' }}>
                {subtitle}
              </p>
            )}
          </div>
          {children}
          {footer}
        </div>
      </main>
    </div>
  );
}

export function useSubmit(fn: (data: FormData) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError(err instanceof TypeError ? 'Connexion impossible. Vérifiez votre accès à Internet puis réessayez.' : (err as Error).message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  return {
    onSubmit,
    error,
    busy,
    ErrorBox: () => (error ? <Alert kind="danger">{error}</Alert> : null),
    Submit: ({ label }: { label: string }) => (
      <Button type="submit" block size="lg" busy={busy}>
        {label}
      </Button>
    ),
  };
}
