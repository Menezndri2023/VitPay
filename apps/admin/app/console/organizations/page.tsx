'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, api, Button, Card, EmptyState, errorText, formatDate, Icon, PageHeader, Skeleton, StatusBadge, TestBadge, useDebounced } from '@vitpay/ui';

interface Org {
  id: string;
  type: string;
  displayName: string;
  legalName: string | null;
  ice: string | null;
  status: string;
  kybStatus: string;
  vitpayFeeBps: number;
  requestCount: number;
  liveActivity: boolean;
  createdAt: string;
}

const PAGE = 50;

export default function OrganizationsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [activity, setActivity] = useState('');
  const [rows, setRows] = useState<Org[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useDebounced(q.trim(), 300);
  const seq = useRef(0);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s) setStatus(s);
  }, []);

  const path = (before?: string) => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    if (activity) p.set('activity', activity);
    if (before) p.set('before', before);
    return `/v1/admin/organizations?${p}`;
  };

  useEffect(() => {
    const n = ++seq.current;
    setError(null);
    api<Org[]>(path())
      .then((r) => n === seq.current && setRows(r))
      .catch((e) => n === seq.current && setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, activity]);

  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    const n = seq.current;
    setMore(true);
    try {
      const r = await api<Org[]>(path(last.createdAt));
      if (n === seq.current) setRows((prev) => [...(prev ?? []), ...r]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMore(false);
    }
  };

  return (
    <>
      <PageHeader title="Organisations et KYB" subtitle="Commerçants inscrits, état de leur dossier et de leur activité." />
      <Card>
        <div className="vp-row" style={{ marginBottom: 14 }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
            <Icon name="search" style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--vp-text-muted)' }} />
            <input className="vp-input" style={{ paddingInlineStart: 40 }} type="search" placeholder="Nom, raison sociale, ICE" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une organisation" />
          </div>
          <select className="vp-input" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut ou KYB">
            <option value="">Tous les statuts</option>
            <option value="submitted">KYB à examiner</option>
            <option value="verified">KYB vérifié</option>
            <option value="rejected">KYB refusé</option>
            <option value="active">Actives</option>
            <option value="suspended">Suspendues</option>
          </select>
          <select className="vp-input" style={{ maxWidth: 230 }} value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Activité">
            <option value="">Toute activité</option>
            <option value="live">Avec activité réelle</option>
            <option value="test">Test uniquement</option>
          </select>
        </div>
        {error && <Alert kind="danger">{error}</Alert>}
        {!rows ? (
          <div className="vp-stack">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={44} />
            ))}
          </div>
        ) : !rows.length ? (
          <EmptyState icon="building" title="Aucune organisation ne correspond">
            Modifiez la recherche ou les filtres.
          </EmptyState>
        ) : (
          <div className="vp-table-wrap">
            <table className="vp-table vp-table-cards">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Raison sociale / ICE</th>
                  <th>Statut</th>
                  <th>KYB</th>
                  <th className="vp-end">Frais</th>
                  <th className="vp-end">Demandes</th>
                  <th>Créée</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <a href={`/console/organizations/${o.id}`}>{o.displayName}</a> {!o.liveActivity && <TestBadge />}
                      <div className="vp-small vp-muted">{o.type === 'business' ? 'Entreprise' : 'Particulier'}</div>
                    </td>
                    <td className="vp-small" data-label="Raison sociale">
                      {o.legalName ?? '—'}
                      <div className="vp-mono vp-muted">{o.ice ?? ''}</div>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>
                      <StatusBadge status={o.kybStatus} />
                    </td>
                    <td className="vp-end vp-num" data-label="Frais">
                      {(o.vitpayFeeBps / 100).toFixed(2).replace('.', ',')} %
                    </td>
                    <td className="vp-end vp-num" data-label="Demandes">
                      {o.requestCount}
                    </td>
                    <td className="vp-small vp-muted" data-label="Créée">
                      {formatDate(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length > 0 && rows.length % PAGE === 0 && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <Button variant="ghost" onClick={loadMore} busy={more}>
              Afficher plus
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
