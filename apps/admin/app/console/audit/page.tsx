'use client';

import { Fragment, useState } from 'react';
import { Alert, api, Button, Card, formatDate } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Entry {
  id: string;
  occurredAt: string;
  actorType: string;
  actorName: string | null;
  orgId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  ip: string | null;
  before: unknown;
  after: unknown;
  hash: string;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const { data } = useLoad<Entry[]>(`/v1/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; brokenAt: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="vp-stack">
      <div className="vp-row vp-between">
        <h1 style={{ margin: 0 }}>Journal d’audit</h1>
        <Button variant="ghost" onClick={async () => setVerify(await api('/v1/admin/audit/verify'))}>
          Vérifier l’intégrité de la chaîne
        </Button>
      </div>
      {verify && (
        <Alert kind={verify.ok ? 'success' : 'danger'}>
          {verify.ok ? `Chaîne intègre : ${verify.checked} entrées vérifiées.` : `ALTÉRATION DÉTECTÉE à l’entrée #${verify.brokenAt}. Escalader immédiatement.`}
        </Alert>
      )}
      <Card>
        <input className="vp-input" style={{ maxWidth: 300, marginBottom: 12 }} placeholder="Filtrer par action (ex. admin., refund.)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" />
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Acteur</th>
                <th>Action</th>
                <th>Cible</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((e) => (
                <Fragment key={e.id}>
                  <tr onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
                    <td className="vp-mono">{e.id}</td>
                    <td className="vp-small">{formatDate(e.occurredAt)}</td>
                    <td className="vp-small">
                      {e.actorType} {e.actorName && <span className="vp-muted">({e.actorName})</span>}
                    </td>
                    <td className="vp-mono">{e.action}</td>
                    <td className="vp-small vp-mono">
                      {e.targetType} {e.targetId?.slice(0, 8)}
                    </td>
                    <td className="vp-small">{e.reason ?? ''}</td>
                  </tr>
                  {open === e.id && (
                    <tr>
                      <td colSpan={6}>
                        <pre className="vp-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                          {JSON.stringify({ before: e.before, after: e.after, ip: e.ip, hash: e.hash }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
