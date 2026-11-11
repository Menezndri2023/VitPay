'use client';

import { FormEvent, useState } from 'react';
import { Alert, ApiError, Button, Card, Field, formatMoney, newIdempotencyKey } from '@vitpay/ui';
import { useOrg } from '../../org-context';
import { SharePanel } from '../../share-panel';
import { PaymentRequest } from '../../types';

export default function NewRequestPage() {
  const { orgApi, orgId } = useOrg();
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Une clé par formulaire : un double clic ou un renvoi réseau ne crée pas deux demandes.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await orgApi<PaymentRequest>('/payment-requests', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: {
          amount: String(fd.get('amount')).trim(),
          currency: 'MAD',
          description: String(fd.get('description') || '') || undefined,
          customerName: String(fd.get('customerName') || '') || undefined,
          expiresInHours: Number(fd.get('expiresInHours')) || undefined,
        },
      });
      setCreated(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError('Montant invalide (exemple : 500 ou 500,50).');
      else if (err instanceof ApiError && err.code === 'invalid_state') setError(err.message.includes('provider') ? 'Connectez d’abord un prestataire de paiement (Paramètres).' : err.message);
      else setError('Création impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <div className="vp-stack" style={{ maxWidth: 760 }}>
        <h1>Demande créée — {formatMoney(created.amount)}</h1>
        {created.mode === 'sandbox' && <Alert kind="warning">Mode test : le paiement passera par le prestataire simulé. Aucun argent réel ne circule.</Alert>}
        <Card title={`Référence ${created.reference}`}>
          <SharePanel req={created} orgId={orgId} />
        </Card>
        <div className="vp-row">
          <a className="vp-btn" href={`/app/requests/${created.id}`}>
            Suivre le paiement
          </a>
          <Button
            variant="ghost"
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
    <div className="vp-stack" style={{ maxWidth: 560 }}>
      <h1>Nouvelle demande de paiement</h1>
      <Card>
        <form className="vp-stack" onSubmit={submit}>
          <Field label="Montant (MAD)" name="amount" inputMode="decimal" placeholder="500,00" required autoFocus pattern="^\d+([.,]\d{1,2})?$" />
          <Field label="Motif (visible par le payeur)" name="description" maxLength={200} placeholder="Ex. Remboursement, Facture n° 2026-104" />
          <Field label="Nom du client (privé, non affiché au payeur)" name="customerName" maxLength={120} />
          <Field label="Validité (heures)" name="expiresInHours" type="number" min={1} max={720} defaultValue={72} />
          {error && <Alert kind="danger">{error}</Alert>}
          <Button type="submit" variant="accent" disabled={busy}>
            Générer le lien et le QR code
          </Button>
        </form>
      </Card>
    </div>
  );
}
