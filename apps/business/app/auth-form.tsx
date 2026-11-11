'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { Alert, Button, Footer, Logo } from '@vitpay/ui';

export function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="vp-narrow" style={{ paddingTop: 48 }}>
      <div className="vp-stack">
        <div style={{ textAlign: 'center' }}>
          <Logo />
          <div className="vp-muted vp-small">Business</div>
        </div>
        <section className="vp-card vp-stack">
          <h1>{title}</h1>
          {children}
        </section>
        {footer}
        <Footer />
      </div>
    </main>
  );
}

export function useSubmit(fn: (data: FormData) => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn(new FormData(e.currentTarget));
    } catch (err) {
      setError((err as Error).message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  return { onSubmit, error, busy, ErrorBox: () => (error ? <Alert kind="danger">{error}</Alert> : null), Submit: ({ label }: { label: string }) => <Button type="submit" block disabled={busy}>{label}</Button> };
}
