'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, EmptyState, errorText, formatDate, formatMoney, Icon, LinkButton, PageHeader, Skeleton, StatusBadge, TestBadge, useDebounced } from '@vitpay/ui';
import { useOrg } from '../org-context';
import { useT, type MsgKey } from '../../i18n';
import { PaymentRequest, STATUS_LABELS } from '../types';

const FILTERS: readonly { id: string; label: MsgKey }[] = [
  { id: '', label: 'req.f.all' },
  { id: 'open', label: 'req.f.open' },
  { id: 'paid', label: 'req.f.paid' },
  { id: 'expired', label: 'req.f.expired' },
  { id: 'cancelled', label: 'req.f.cancelled' },
];

export default function RequestsPage() {
  const { orgApi, orgId, org } = useOrg();
  const { t, tr, tag } = useT();
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
        title={t('req.title')}
        subtitle={t('req.subtitle')}
        actions={
          <>
            <LinkButton variant="ghost" icon="download" href={`/api/v1/orgs/${orgId}/exports/payments.csv`}>
              {t('req.export')}
            </LinkButton>
            {org.role !== 'viewer' && (
              <LinkButton icon="plus" href="/app/requests/new">
                {t('nav.new')}
              </LinkButton>
            )}
          </>
        }
      />
      <Card>
        <div className="vp-row" style={{ marginBottom: 14, alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
            <Icon name="search" style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--vp-text-muted)' }} />
            <input className="vp-input" style={{ paddingInlineStart: 40 }} type="search" placeholder={t('req.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('req.searchLabel')} />
          </div>
          <div className="vp-tabs" role="tablist" aria-label={t('req.filter')} style={{ borderBottom: 0, flex: '1 1 auto' }}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={status === f.id} className="vp-tab" onClick={() => setStatus(f.id)}>
                {t(f.label)}
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
            <EmptyState icon="search" title={t('req.noMatch')} action={<Button variant="ghost" onClick={() => { setQ(''); setStatus(''); }}>{t('req.clear')}</Button>}>
              {t('req.noMatchText')}
            </EmptyState>
          ) : (
            <EmptyState icon="send" title={t('req.none')} action={org.role !== 'viewer' ? <LinkButton href="/app/requests/new" icon="plus">{t('dash.create')}</LinkButton> : undefined}>
              {t('req.noneText')}
            </EmptyState>
          )
        ) : (
          <div className="vp-table-wrap">
            <table className="vp-table vp-table-cards">
              <thead>
                <tr>
                  <th>{t('req.col.ref')}</th>
                  <th>{t('req.col.reason')}</th>
                  <th>{t('req.col.status')}</th>
                  <th>{t('req.col.created')}</th>
                  <th className="vp-end">{t('req.col.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a className="vp-mono" href={`/app/requests/${r.id}`}>
                        {r.reference}
                      </a>{' '}
                      {r.mode === 'sandbox' && <TestBadge label={t('common.test')} />}
                      {r.merchantReference && <div className="vp-small vp-muted vp-mono">{r.merchantReference}</div>}
                    </td>
                    <td className="vp-muted" data-label={t('req.col.reason')}>
                      {r.description ?? r.customerName ?? '—'}
                    </td>
                    <td>
                      <StatusBadge status={r.status} label={tr('status', r.status, STATUS_LABELS[r.status] ?? r.status)} />
                    </td>
                    <td className="vp-muted vp-small" data-label={t('req.col.created')}>
                      {formatDate(r.createdAt, tag)}
                    </td>
                    <td className="vp-end vp-num" style={{ fontWeight: 650 }}>
                      {formatMoney(r.amount, tag)}
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
              {t('req.more')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
