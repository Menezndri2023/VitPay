'use client';

import { useEffect, useState } from 'react';
import { CopyButton, formatMoney, Icon } from '@vitpay/ui';
import { PaymentRequest } from './types';
import { useT } from '../i18n';

/** Partage du lien : copie, WhatsApp, SMS, e-mail, partage natif du téléphone. */
export function SharePanel({ req, orgId }: { req: PaymentRequest; orgId: string }) {
  const { t, tag } = useT();
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && !!navigator.share), []);
  const text = t('share.message', { amount: formatMoney(req.amount, tag), reason: req.description ? ` — ${req.description}` : '', url: req.payUrl });
  const native = async () => {
    await navigator.share({ title: 'Demande de paiement VITPAY', text, url: req.payUrl }).catch(() => undefined);
  };
  const qr = `/api/v1/orgs/${orgId}/payment-requests/${req.id}/qr.svg`;
  return (
    <div className="vp-row" style={{ alignItems: 'flex-start', gap: 24 }}>
      <div style={{ textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR code de paiement ${req.reference}`} width={184} height={184} style={{ background: '#fff', borderRadius: 12, padding: 8, border: '1px solid var(--vp-border)', display: 'block' }} />
        <a href={qr} download={`qr-${req.reference}.svg`} className="vp-small" style={{ display: 'inline-block', marginTop: 8 }}>
          {t('share.qr')}
        </a>
      </div>
      <div className="vp-stack" style={{ flex: 1, minWidth: 240 }}>
        <div className="vp-field">
          <label className="vp-label" htmlFor="pay-link">
            {t('share.link')}
          </label>
          <div className="vp-row" style={{ flexWrap: 'nowrap', gap: 8 }}>
            <input id="pay-link" dir="ltr" className="vp-input vp-mono" readOnly value={req.payUrl} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={req.payUrl} label={t('share.copy')} copiedLabel={t('share.copied')} variant="primary" />
          </div>
        </div>
        <div className="vp-row" style={{ gap: 8 }}>
          <a className="vp-btn vp-btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
            <Icon name="message" />
            WhatsApp
          </a>
          <a className="vp-btn vp-btn-ghost" href={`sms:?&body=${encodeURIComponent(text)}`}>
            <Icon name="send" />
            SMS
          </a>
          <a className="vp-btn vp-btn-ghost" href={`mailto:?subject=${encodeURIComponent('Demande de paiement')}&body=${encodeURIComponent(text)}`}>
            <Icon name="mail" />
            E-mail
          </a>
          {canShare && (
            <button type="button" className="vp-btn vp-btn-ghost" onClick={native}>
              <Icon name="share" />
              {t('share.other')}
            </button>
          )}
        </div>
        <p className="vp-hint" style={{ margin: 0 }}>
          {t('share.note')}
        </p>
      </div>
    </div>
  );
}
