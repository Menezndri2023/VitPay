'use client';

import { FormEvent, useState } from 'react';
import { Alert, ApiError, Button, Card, errorText, Field, formatMoney, LinkButton, newIdempotencyKey, PageHeader, Select, TestBadge } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { SharePanel } from '../../share-panel';
import { PaymentRequest } from '../../types';

const VALIDITY = [
  { h: 24, label: '24 heures' },
  { h: 72, label: '3 jours' },
  { h: 168, label: '7 jours' },
  { h: 720, label: '30 jours' },
];

export default function NewRequestPage() {
  const { orgApi, orgId } = useOrg();
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
          expiresInHours: Number(fd.get('expiresInHours')) || undefined,
        },
      });
      setCreated(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError({ text: 'Montant invalide : saisissez par exemple 500 ou 500,50 (minimum 1 MAD).' });
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
          back={{ href: '/app/requests', label: 'Demandes' }}
          title={<>Demande créée — {formatMoney(created.amount)}</>}
          subtitle={
            <>
              Référence <span className="vp-mono">{created.reference}</span>
              {created.description ? ` · ${created.description}` : ''}. Envoyez le lien ou faites scanner le QR code.
            </>
          }
        />
        {created.mode === 'sandbox' && (
          <Alert kind="warning">
            <TestBadge /> Mode test : le paiement passera par le prestataire simulé. Aucun argent réel ne circule.
          </Alert>
        )}
        <Card title="Partager avec votre client">
          <SharePanel req={created} orgId={orgId} />
        </Card>
        <div className="vp-row">
          <LinkButton href={`/app/requests/${created.id}`}>Suivre le paiement</LinkButton>
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => {
              setCreated(null);
              setIdemKey(newIdempotencyKey());
            }}
          >
            Nouvelle demande
          </Button>
        </div>
      </div>
    );

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 620 }}>
      <PageHeader back={{ href: '/app/requests', label: 'Demandes' }} title="Nouvelle demande de paiement" subtitle="Vous obtenez un lien et un QR code. Votre client paie par carte, depuis son téléphone." />
      <Card>
        <form className="vp-stack" onSubmit={submit} style={{ gap: 16 }}>
          <div className="vp-field">
            <label className="vp-label" htmlFor="amount">
              Montant (MAD)
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
                title="Exemple : 500 ou 500,50"
                style={{ fontSize: 28, fontWeight: 750, minHeight: 64, paddingInlineEnd: 70 }}
                aria-describedby="amount-hint"
              />
              <span className="vp-muted" style={{ position: 'absolute', insetInlineEnd: 16, top: 20, fontWeight: 700 }}>
                MAD
              </span>
            </div>
            <span className="vp-hint" id="amount-hint">
              Virgule ou point pour les centimes.
            </span>
          </div>
          <Field label="Motif (visible par le payeur)" name="description" maxLength={200} placeholder="Ex. Facture n° 2026-104, acompte commande…" />
          <Field
            label="Référence de commande (facultatif, unique)"
            name="merchantReference"
            maxLength={64}
            pattern="^[A-Za-z0-9._:\/#\-]{1,64}$"
            placeholder="Ex. CMD-2026-0042"
            hint="Une commande ne donne lieu qu’à une seule demande : protège contre les doublons."
          />
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Plus d’options</summary>
            <div className="vp-form-grid" style={{ marginTop: 14 }}>
              <Field label="Nom du client (privé)" name="customerName" maxLength={120} hint="Pour vos recherches ; jamais affiché au payeur." />
              <Select label="Validité du lien" name="expiresInHours" defaultValue="72">
                {VALIDITY.map((v) => (
                  <option key={v.h} value={v.h}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
          </details>
          {error && (
            <Alert kind="danger">
              {error.text} {error.settings && <a href="/app/settings?tab=providers">Ouvrir les paramètres</a>}
            </Alert>
          )}
          <Button type="submit" size="lg" busy={busy}>
            Générer le lien et le QR code
          </Button>
        </form>
      </Card>
    </div>
  );
}
