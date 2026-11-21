'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CopyButton, EmptyState, errorText, Field, formatMoney, Icon, MoneyView, PageHeader, Skeleton, StatusBadge, TestBadge, useToast } from '@vitpay/ui';
import { useOrg } from '../org-context';

interface PaymentLink {
  id: string;
  title: string;
  description: string | null;
  amount: MoneyView | null;
  currency: string;
  mode: 'sandbox' | 'live';
  status: 'active' | 'disabled';
  url: string;
  createdAt: string;
  paidCount: number;
  paidTotal: MoneyView;
}

function LinkCard({ l, orgId, canManage, onDisable }: { l: PaymentLink; orgId: string; canManage: boolean; onDisable: () => void }) {
  const text = `${l.title}${l.amount ? ` — ${formatMoney(l.amount)}` : ''} : ${l.url}`;
  const qr = `/api/v1/orgs/${orgId}/payment-links/${l.id}/qr.svg`;
  const active = l.status === 'active';
  return (
    <div className="vp-card vp-row" style={{ alignItems: 'flex-start', gap: 20, opacity: active ? 1 : 0.6 }}>
      {active && (
        <a href={qr} download={`qr-${l.title}.svg`} title="Télécharger le QR code (à imprimer)">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR code du lien ${l.title}`} width={120} height={120} style={{ background: '#fff', borderRadius: 10, padding: 6, border: '1px solid var(--vp-border)', display: 'block' }} />
        </a>
      )}
      <div className="vp-stack" style={{ flex: 1, minWidth: 220, gap: 8 }}>
        <div className="vp-row vp-between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {l.title} {l.mode === 'sandbox' && <TestBadge />} {!active && <StatusBadge status="disabled" />}
            </h3>
            <div className="vp-muted vp-small">
              {l.amount ? formatMoney(l.amount) : 'Montant libre, saisi par le client'}
              {l.description ? ` · ${l.description}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="vp-num" style={{ fontWeight: 700 }}>
              {formatMoney(l.paidTotal)}
            </div>
            <div className="vp-muted vp-small">
              {l.paidCount} paiement{l.paidCount > 1 ? 's' : ''}
            </div>
          </div>
        </div>
        {active && (
          <>
            <div className="vp-row" style={{ flexWrap: 'nowrap', gap: 8 }}>
              <input className="vp-input vp-mono" readOnly value={l.url} aria-label={`Lien ${l.title}`} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={l.url} variant="primary" />
            </div>
            <div className="vp-row" style={{ gap: 8 }}>
              <a className="vp-btn vp-btn-ghost vp-btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
                <Icon name="message" />
                WhatsApp
              </a>
              <a className="vp-btn vp-btn-ghost vp-btn-sm" href={qr} download={`qr-${l.title}.svg`}>
                <Icon name="download" />
                QR à imprimer
              </a>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={onDisable}>
                  Désactiver
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function LinksPage() {
  const { orgApi, orgId, org } = useOrg();
  const toast = useToast();
  const [links, setLinks] = useState<PaymentLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [free, setFree] = useState(false);
  const canCreate = org.role !== 'viewer';
  const canManage = org.role === 'owner' || org.role === 'admin';

  const load = useCallback(
    () =>
      orgApi<PaymentLink[]>('/payment-links')
        .then(setLinks)
        .catch((e) => setError(errorText(e))),
    [orgApi],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await orgApi('/payment-links', {
        method: 'POST',
        body: {
          title: String(fd.get('title')).trim(),
          description: String(fd.get('description') || '').trim() || undefined,
          amount: free ? undefined : String(fd.get('amount')).trim().replace(/\s/g, ''),
          currency: 'MAD',
        },
      });
      form.reset();
      toast('Lien créé : partagez-le ou imprimez son QR code.');
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (l: PaymentLink) => {
    if (!confirm(`Désactiver « ${l.title} » ? Le lien et son QR code ne permettront plus de payer.`)) return;
    try {
      await orgApi(`/payment-links/${l.id}/disable`, { method: 'POST', body: {} });
      toast('Lien désactivé.');
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const active = links?.filter((l) => l.status === 'active') ?? [];
  const disabled = links?.filter((l) => l.status !== 'active') ?? [];

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Liens de paiement"
        subtitle="Un lien ou un QR code permanent, payable par tous vos clients : tarif fixe (consultation, cotisation, produit) ou montant libre. Chaque paiement apparaît dans vos demandes."
      />
      {error && <Alert kind="danger">{error}</Alert>}

      {canCreate && (
        <Card title="Nouveau lien">
          <form className="vp-stack" onSubmit={create}>
            <div className="vp-form-grid">
              <Field label="Intitulé (visible par le client)" name="title" required minLength={2} maxLength={80} placeholder="Ex. Consultation, Cotisation mensuelle" />
              {!free && (
                <Field label="Montant (MAD)" name="amount" inputMode="decimal" required placeholder="300,00" pattern="^\s*\d[\d\s]*([.,]\d{1,2})?\s*$" title="Exemple : 300 ou 300,50" />
              )}
            </div>
            <label className="vp-row vp-small" style={{ gap: 8 }}>
              <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Montant libre (le client saisit le montant)
            </label>
            <Field label="Précision (facultatif)" name="description" maxLength={200} placeholder="Ex. Séance de 45 minutes" />
            <div>
              <Button type="submit" icon="link" busy={busy}>
                Créer le lien
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!links ? (
        <Skeleton height={160} />
      ) : !active.length ? (
        <Card>
          <EmptyState icon="link" title="Aucun lien actif">
            Créez un lien pour un tarif que vous encaissez souvent : il se partage une fois, ou s’imprime en QR code sur votre comptoir.
          </EmptyState>
        </Card>
      ) : (
        <div className="vp-stack">
          {active.map((l) => (
            <LinkCard key={l.id} l={l} orgId={orgId} canManage={canManage} onDisable={() => disable(l)} />
          ))}
        </div>
      )}
      {disabled.length > 0 && (
        <details>
          <summary className="vp-muted" style={{ cursor: 'pointer' }}>
            {disabled.length} lien{disabled.length > 1 ? 's' : ''} désactivé{disabled.length > 1 ? 's' : ''}
          </summary>
          <div className="vp-stack" style={{ marginTop: 12 }}>
            {disabled.map((l) => (
              <LinkCard key={l.id} l={l} orgId={orgId} canManage={false} onDisable={() => undefined} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
