'use client';

import { useState } from 'react';
import { Button, formatMoney } from '@vitpay/ui';
import { PaymentRequest } from './types';

/** Partage du lien : WhatsApp, SMS, e-mail, copie, partage natif. */
export function SharePanel({ req, orgId }: { req: PaymentRequest; orgId: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Demande de paiement de ${formatMoney(req.amount)}${req.description ? ` — ${req.description}` : ''} : ${req.payUrl}`;
  const copy = async () => {
    await navigator.clipboard.writeText(req.payUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const native = async () => {
    if (navigator.share) await navigator.share({ title: 'Demande de paiement VITPAY', text, url: req.payUrl }).catch(() => undefined);
  };
  return (
    <div className="vp-stack">
      <div className="vp-row" style={{ alignItems: 'flex-start', gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/orgs/${orgId}/payment-requests/${req.id}/qr.svg`} alt={`QR code de paiement ${req.reference}`} width={180} height={180} style={{ background: '#fff', borderRadius: 8, padding: 6 }} />
        <div className="vp-stack" style={{ flex: 1, minWidth: 220 }}>
          <input className="vp-input vp-mono" readOnly value={req.payUrl} aria-label="Lien de paiement" onFocus={(e) => e.currentTarget.select()} />
          <div className="vp-row">
            <Button onClick={copy}>{copied ? 'Copié ✓' : 'Copier le lien'}</Button>
            <a className="vp-btn vp-btn-accent" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
            <a className="vp-btn vp-btn-ghost" href={`sms:?&body=${encodeURIComponent(text)}`}>
              SMS
            </a>
            <a className="vp-btn vp-btn-ghost" href={`mailto:?subject=${encodeURIComponent('Demande de paiement')}&body=${encodeURIComponent(text)}`}>
              E-mail
            </a>
            <Button variant="ghost" onClick={native}>
              Autre…
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
