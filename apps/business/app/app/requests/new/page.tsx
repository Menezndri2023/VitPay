'use client';

import { FormEvent, useState } from 'react';
import { Alert, ApiError, Button, Card, errorText, Field, formatMoney, LinkButton, newIdempotencyKey, PageHeader, Select, TestBadge } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { useT, type MsgKey } from '../../../i18n';
import { SharePanel } from '../../share-panel';
import { PaymentRequest } from '../../types';

const VALIDITY: { h: number; label: MsgKey }[] = [
  { h: 24, label: 'new.v24' },
  { h: 72, label: 'new.v72' },
  { h: 168, label: 'new.v168' },
  { h: 720, label: 'new.v720' },
];

export default function NewRequestPage() {
  const { orgApi, orgId } = useOrg();
  const { t, tag } = useT();
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<{ text: string; settings?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Une clé par formulaire : un double clic ou un renvoi réseau ne crée pas deux demandes.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await orgApi<PaymentRequest>('/payment-requests', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: {
          amount: String(fd.get('amount')).trim().replace(/\s/g, ''),
          currency: 'MAD',
          merchantReference: String(fd.get('merchantReference') || '').trim() || undefined,
          description: String(fd.get('description') || '').trim() || undefined,
          customerName: String(fd.get('customerName') || '').trim() || undefined,
          customerEmail: String(fd.get('customerEmail') || '').trim() || undefined,
          expiresInHours: Number(fd.get('expiresInHours')) || undefined,
        },
      });
      setCreated(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError({ text: t('new.badAmount') });
      else if (err instanceof ApiError && err.code === 'invalid_state' && /prestataire/i.test(err.message)) setError({ text: err.message, settings: true });
      else setError({ text: errorText(err, 'Création impossible. Réessayez.') });
      // Après un refus définitif, une nouvelle tentative doit porter une nouvelle clé.
      if (err instanceof ApiError && err.status < 500 && err.code !== 'idempotency_in_progress') setIdemKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <div className="vp-stack-lg" style={{ maxWidth: 820 }}>
        <PageHeader
          back={{ href: '/app/requests', label: t('nav.requests') }}
          title={t('new.created', { amount: formatMoney(created.amount, tag) })}
          subtitle={t('new.createdSub', { ref: created.reference, reason: created.description ? ` · ${created.description}` : '' })}
        />
        {created.mode === 'sandbox' && (
          <Alert kind="warning">
            <TestBadge label={t('common.test')} /> {t('new.testNote')}
          </Alert>
        )}
        <Card title={t('new.share')}>
          <SharePanel req={created} orgId={orgId} />
        </Card>
        <div className="vp-row">
          <LinkButton href={`/app/requests/${created.id}`}>{t('new.follow')}</LinkButton>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => {
              setCreated(null);
              setIdemKey(newIdempotencyKey());
            }}
          >
            {t('new.again')}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 620 }}>
      <PageHeader back={{ href: '/app/requests', label: t('nav.requests') }} title={t('new.title')} subtitle={t('new.subtitle')} />
      <Card>
        <form className="vp-stack" onSubmit={submit} style={{ gap: 16 }}>
          <div className="vp-field">
            <label className="vp-label" htmlFor="amount">
              {t('new.amount')}
            </label>
            <div style={{ position: 'relative' }}>
              <input
                className="vp-input vp-num"
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="0,00"
                required
                autoFocus
                pattern="^\s*\d[\d\s]*([.,]\d{1,2})?\s*$"
                title="500 / 500,50"
                dir="ltr"
                style={{ fontSize: 28, fontWeight: 750, minHeight: 64, paddingInlineEnd: 70 }}
                aria-describedby="amount-hint"
              />
              <span className="vp-muted" style={{ position: 'absolute', insetInlineEnd: 16, top: 20, fontWeight: 700 }}>
                MAD
              </span>
            </div>
            <span className="vp-hint" id="amount-hint">
              {t('new.amountHint')}
            </span>
          </div>
          <Field label={t('new.reason')} name="description" maxLength={200} placeholder={t('new.reasonPh')} />
          <Field
            label={t('new.ref')}
            name="merchantReference"
            maxLength={64}
            pattern="^[A-Za-z0-9._:\/#\-]{1,64}$"
            placeholder="Ex. CMD-2026-0042"
            hint={t('new.refHint')}
          />
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>{t('new.more')}</summary>
            <div className="vp-form-grid" style={{ marginTop: 14 }}>
              <Field label={t('new.customer')} name="customerName" maxLength={120} hint={t('new.customerHint')} />
              <Field label={t('new.customerEmail')} name="customerEmail" type="email" maxLength={254} autoComplete="off" dir="ltr" hint={t('new.customerEmailHint')} />
              <Select label={t('new.validity')} name="expiresInHours" defaultValue="72">
                {VALIDITY.map((v) => (
                  <option key={v.h} value={v.h}>
                    {t(v.label)}
                  </option>
                ))}
              </Select>
            </div>
          </details>
          {error && (
            <Alert kind="danger">
              {error.text} {error.settings && <a href="/app/settings?tab=providers">{t('new.openSettings')}</a>}
            </Alert>
          )}
          <Button type="submit" size="lg" busy={busy}>
            {t('new.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
