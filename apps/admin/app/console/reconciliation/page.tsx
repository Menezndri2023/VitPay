'use client';

import { FormEvent, useState } from 'react';
import { Alert, api, ApiError, Button, Card, Field, formatDate, Select, StatusBadge } from '@vitpay/ui';
import { useLoad } from '../admin-context';

interface Account {
  id: string;
  orgName: string;
  providerCode: string;
  mode: string;
  status: string;
}
interface Run {
  id: string;
  orgName: string;
  reportDate: string;
  status: string;
  stats: Record<string, number>;
  createdAt: string;
}

export default function ReconciliationPage() {
  const accounts = useLoad<Account[]>('/v1/admin/provider-accounts');
  const runs = useLoad<Run[]>('/v1/admin/reconciliation/runs');
  const [msg, setMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await api<{ status: string; stats: Record<string, number> }>('/v1/admin/reconciliation/runs', {
        method: 'POST',
        body: { providerAccountId: fd.get('providerAccountId'), date: fd.get('date') },
      });
      setMsg({ kind: r.status === 'completed' ? 'success' : 'warning', text: `Rapprochement ${r.status} — ${JSON.stringify(r.stats)}` });
      runs.reload();
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Erreur' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vp-stack">
      <h1>Rapprochement prestataires</h1>
      <p className="vp-muted vp-small">
        Compare le rapport de règlement du prestataire avec les paiements confirmés et le grand livre. Seules les lignes concordantes sont marquées « réglées » ; tout écart ouvre un incident.
      </p>
      <Card title="Lancer un rapprochement">
        <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={submit}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Select label="Compte prestataire" name="providerAccountId" required>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.orgName} — {a.providerCode} ({a.mode})
                </option>
              ))}
            </Select>
          </div>
          <div style={{ width: 180 }}>
            <Field label="Date du rapport" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <Button type="submit" disabled={busy}>
            Rapprocher
          </Button>
        </form>
        {msg && <div style={{ marginTop: 12 }}><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      </Card>
      <Card title="Historique">
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Exécuté</th>
                <th>Organisation</th>
                <th>Date du rapport</th>
                <th>Résultat</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {runs.data?.map((r) => (
                <tr key={r.id}>
                  <td className="vp-small">{formatDate(r.createdAt)}</td>
                  <td>{r.orgName}</td>
                  <td>{String(r.reportDate).slice(0, 10)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="vp-mono vp-small">{JSON.stringify(r.stats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
