'use client';

import { FormEvent, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, api, ApiError, Button, Field, Footer, Logo } from '@vitpay/ui';

type Step = 'credentials' | 'enroll' | 'verify';

export default function AdminLogin() {
  const [step, setStep] = useState<Step>('credentials');
  const [error, setError] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [enrollmentToken, setEnrollmentToken] = useState('');

  const startEnrollment = async () => {
    setError(null);
    try {
      const r = await api<{ secret: string; otpauthUrl: string }>('/v1/admin/auth/mfa/setup', { method: 'POST', body: { enrollmentToken: enrollmentToken.trim() } });
      setEnroll({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200 }) });
    } catch {
      setError('Jeton d’enrôlement invalide ou expiré. Demandez-en un nouveau au Super Admin.');
    }
  };
  useEffect(() => setError(null), [step]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      if (step === 'credentials') {
        const r = await api<{ mfaRequired: boolean; mfaEnrollmentRequired: boolean }>('/v1/admin/auth/login', {
          method: 'POST',
          body: { email: fd.get('email'), password: fd.get('password') },
        });
        setStep(r.mfaEnrollmentRequired ? 'enroll' : 'verify');
      } else {
        const code = String(fd.get('code') ?? '').trim();
        await api(step === 'enroll' ? '/v1/admin/auth/mfa/enable' : '/v1/admin/auth/mfa/verify', {
          method: 'POST',
          body: step === 'enroll' ? { code, enrollmentToken: enrollmentToken.trim() } : { code },
        });
        window.location.assign('/console');
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Trop de tentatives. Compte temporairement verrouillé.' : step === 'credentials' ? 'Identifiants invalides.' : 'Code invalide.');
    }
  };

  return (
    <main className="vp-narrow" style={{ paddingTop: 48 }}>
      <div className="vp-stack">
        <div style={{ textAlign: 'center' }}>
          <Logo />
          <div className="vp-muted vp-small">ADMIN — accès restreint, toutes les actions sont journalisées</div>
        </div>
        <form className="vp-card vp-stack" onSubmit={submit}>
          {step === 'credentials' && (
            <>
              <h1>Connexion administrateur</h1>
              <Field label="E-mail" name="email" type="email" autoComplete="username" required />
              <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" required />
            </>
          )}
          {step === 'enroll' && (
            <>
              <h1>Activer la double authentification</h1>
              <p className="vp-muted">La MFA est obligatoire pour l’administration. Saisissez le jeton d’enrôlement reçu hors bande, puis scannez le QR code avec votre application d’authentification.</p>
              {!enroll ? (
                <>
                  <Field label="Jeton d’enrôlement" name="enrollmentToken" value={enrollmentToken} onChange={(e) => setEnrollmentToken(e.target.value)} autoComplete="off" required />
                  <Button type="button" variant="ghost" onClick={startEnrollment} disabled={enrollmentToken.trim().length < 16}>
                    Afficher le QR code
                  </Button>
                </>
              ) : (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={enroll.qr} alt="QR code MFA" width={200} height={200} style={{ margin: '0 auto', background: '#fff', padding: 6, borderRadius: 8 }} />
                  <code style={{ wordBreak: 'break-all', textAlign: 'center' }}>{enroll.secret}</code>
                  <Field label="Code à 6 chiffres" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
                </>
              )}
            </>
          )}
          {step === 'verify' && (
            <>
              <h1>Double authentification</h1>
              <Field label="Code à 6 chiffres" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus />
            </>
          )}
          {error && <Alert kind="danger">{error}</Alert>}
          {(step !== 'enroll' || enroll) && (
            <Button type="submit" block>
              {step === 'credentials' ? 'Continuer' : 'Valider'}
            </Button>
          )}
        </form>
        <Footer />
      </div>
    </main>
  );
}
