'use client';

import { FormEvent, useState } from 'react';
import { Alert, api, ApiError, Button, Card, Field, formatDate, formatMoney, MoneyView, Select, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Statement {
  id: string;
  orgId: string;
  orgName: string;
  number: string;
  mode: string;
  periodStart: string;
  periodEnd: string;
  fees: MoneyView;
  lineCount: number;
  status: string;
  issuedAt: string;
  paymentReference: string | null;
  voidReason: string | null;
}

export default function BillingPage() {
  const [status, setStatus] = useState('');
  const { data, reload } = useLoad<Statement[]>(`/v1/admin/billing/statements${status ? `?status=${status}` : ''}`);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'success', text: ok });
      reload();
    } catch (e) {
      setMsg({ kind: 'danger', text: e instanceof ApiError ? e.message : 'Erreur' });
    }
  };

  const issue = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await call(async () => {
      const r = await api<{ issued: Statement[] }>('/v1/admin/billing/statements', {
        method: 'POST',
        body: { periodStart: fd.get('periodStart'), periodEnd: fd.get('periodEnd'), mode: fd.get('mode') },
      });
      if (!r.issued.length) throw new ApiError(200, 'none', 'Aucune commission à facturer sur cette période.');
    }, 'Relevés émis.');
  };

  return (
    <div className="vp-stack">
      <h1>Commissions VITPAY</h1>
      <p className="vp-muted vp-small">
        Modèle A : la commission est facturée séparément, jamais prélevée sur les fonds. Les relevés sont <strong>pro forma</strong> tant que le format de facture et la TVA ne sont pas validés (COMPLIANCE E2).
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title="Émettre les relevés d’une période">
        <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={issue}>
          <div style={{ width: 170 }}>
            <Field label="Du" name="periodStart" type="date" defaultValue={monthStart} required />
          </div>
          <div style={{ width: 170 }}>
            <Field label="Au" name="periodEnd" type="date" defaultValue={today} required />
          </div>
          <div style={{ width: 170 }}>
            <Select label="Mode" name="mode" defaultValue="live">
              <option value="live">Réel</option>
              <option value="sandbox">Test (sandbox)</option>
            </Select>
          </div>
          <Button type="submit">Émettre</Button>
        </form>
      </Card>
      <Card
        title="Relevés"
        actions={
          <select className="vp-input" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous</option>
            <option value="issued">Émis</option>
            <option value="paid">Encaissés</option>
            <option value="void">Annulés</option>
          </select>
        }
      >
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Organisation</th>
                <th>Période</th>
                <th>Commission</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td className="vp-mono">{s.number}</td>
                  <td>
                    <a href={`/console/organizations/${s.orgId}`}>{s.orgName}</a>
                  </td>
                  <td className="vp-small">
                    {s.periodStart} → {s.periodEnd}
                    <div className="vp-muted">{s.lineCount} paiement(s) · émis {formatDate(s.issuedAt)}</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatMoney(s.fees)}</td>
                  <td>
                    <StatusBadge status={s.status === 'issued' ? 'pending' : s.status === 'paid' ? 'paid' : 'cancelled'} label={s.status === 'issued' ? 'émis' : s.status === 'paid' ? 'encaissé' : 'annulé'} />
                    {s.paymentReference && <div className="vp-small vp-muted">{s.paymentReference}</div>}
                  </td>
                  <td>
                    {s.status === 'issued' && (
                      <div className="vp-row" style={{ gap: 6 }}>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const ref = prompt('Référence du règlement reçu (virement, chèque…) :');
                            if (ref) void call(() => api(`/v1/admin/billing/statements/${s.id}/paid`, { method: 'POST', body: { reference: ref } }), 'Relevé marqué encaissé.');
                          }}
                        >
                          Encaissé
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const reason = prompt('Motif de l’annulation :');
                            if (reason) void call(() => api(`/v1/admin/billing/statements/${s.id}/void`, { method: 'POST', body: { reason } }), 'Relevé annulé ; les paiements redeviennent facturables.');
                          }}
                        >
                          Annuler
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="vp-muted">
                    Aucun relevé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
