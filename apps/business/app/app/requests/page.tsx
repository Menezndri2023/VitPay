'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, EmptyState, errorText, formatDate, formatMoney, Icon, LinkButton, PageHeader, Skeleton, StatusBadge, TestBadge, useDebounced } from '@vitpay/ui';
import { useOrg } from '../org-context';
import { PaymentRequest, STATUS_LABELS } from '../types';

const FILTERS = [
  { id: '', label: 'Toutes' },
  { id: 'open', label: 'En attente' },
  { id: 'paid', label: 'Payées' },
  { id: 'expired', label: 'Expirées' },
  { id: 'cancelled', label: 'Annulées' },
] as const;

export default function RequestsPage() {
  const { orgApi, orgId, org } = useOrg();
  const [rows, setRows] = useState<PaymentRequest[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const query = useDebounced(q.trim(), 300);
  // Seule la réponse de la DERNIÈRE recherche est affichée (les réponses plus lentes sont ignorées).
  const seq = useRef(0);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status') ?? '';
    if (FILTERS.some((f) => f.id === s)) setStatus(s);
  }, []);

  const fetchPage = (before?: string) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    if (before) p.set('before', before);
    return orgApi<{ data: PaymentRequest[]; nextCursor: string | null }>(`/payment-requests?${p}`);
  };

  useEffect(() => {
    const n = ++seq.current;
    setError(null);
    fetchPage()
      .then((r) => {
        if (n !== seq.current) return;
        setRows(r.data);
        setCursor(r.nextCursor);
      })
      .catch((e) => n === seq.current && setError(errorText(e)));
    const u = new URL(window.location.href);
    if (status) u.searchParams.set('status', status);
    else u.searchParams.delete('status');
    window.history.replaceState(null, '', u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgApi, status, query]);

  const loadMore = async () => {
    if (!cursor) return;
    const n = seq.current;
    setMore(true);
    try {
      const r = await fetchPage(cursor);
      if (n !== seq.current) return;
      setRows((prev) => [...(prev ?? []), ...r.data]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMore(false);
    }
  };

  const filtered = !!(status || query);

  return (
    <div className="vp-stack-lg">
      <PageHeader
        title="Demandes de paiement"
        subtitle="Chaque demande est un lien unique que votre client paie par carte."
        actions={
          <>
            <LinkButton variant="ghost" icon="download" href={`/api/v1/orgs/${orgId}/exports/payments.csv`}>
              Export CSV
            </LinkButton>
            {org.role !== 'viewer' && (
              <LinkButton icon="plus" href="/app/requests/new">
                Nouvelle demande
              </LinkButton>
            )}
          </>
        }
      />
      <Card>
        <div className="vp-row" style={{ marginBottom: 14, alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Icon name="search" style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--vp-text-muted)' }} />
            <input className="vp-input" style={{ paddingInlineStart: 40 }} type="search" placeholder="Référence, motif, client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une demande" />
          </div>
          <div className="vp-tabs" role="tablist" aria-label="Filtrer par statut" style={{ borderBottom: 0, flex: '1 1 auto' }}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={status === f.id} className="vp-tab" onClick={() => setStatus(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {error && <Alert kind="danger">{error}</Alert>}
        {!rows ? (
          <div className="vp-stack">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} />
            ))}
          </div>
        ) : !rows.length ? (
          filtered ? (
            <EmptyState icon="search" title="Aucune demande ne correspond" action={<Button variant="ghost" onClick={() => { setQ(''); setStatus(''); }}>Effacer les filtres</Button>}>
              Essayez une autre référence ou un autre statut.
            </EmptyState>
          ) : (
            <EmptyState icon="send" title="Aucune demande pour le moment" action={org.role !== 'viewer' ? <LinkButton href="/app/requests/new" icon="plus">Créer une demande</LinkButton> : undefined}>
              Créez un lien de paiement et partagez-le par WhatsApp, SMS ou e-mail.
            </EmptyState>
          )
        ) : (
          <div className="vp-table-wrap">
            <table className="vp-table vp-table-cards">
              <thead>
                <tr>
                  <th>Référence</th>
                  <th>Motif</th>
                  <th>Statut</th>
                  <th>Créée le</th>
                  <th className="vp-end">Montant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a className="vp-mono" href={`/app/requests/${r.id}`}>
                        {r.reference}
                      </a>{' '}
                      {r.mode === 'sandbox' && <TestBadge />}
                      {r.merchantReference && <div className="vp-small vp-muted vp-mono">{r.merchantReference}</div>}
                    </td>
                    <td className="vp-muted" data-label="Motif">
                      {r.description ?? r.customerName ?? '—'}
                    </td>
                    <td>
                      <StatusBadge status={r.status} label={STATUS_LABELS[r.status]} />
                    </td>
                    <td className="vp-muted vp-small" data-label="Créée le">
                      {formatDate(r.createdAt)}
                    </td>
                    <td className="vp-end vp-num" style={{ fontWeight: 650 }}>
                      {formatMoney(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && rows && rows.length > 0 && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <Button variant="ghost" onClick={loadMore} busy={more}>
              Afficher plus
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
