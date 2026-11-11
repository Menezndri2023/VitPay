'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, ApiError, Button, Card, Field, formatMoney, MoneyView, Select, StatusBadge } from '@vitpay/ui';
import { useOrg } from '../org-context';

interface OrgInfo {
  displayName: string;
  legalName: string | null;
  ice: string | null;
  rc: string | null;
  address: string | null;
  kybStatus: string;
  status: string;
  vitpayFeeBps: number;
  myPermissions: string[];
}
interface Providers {
  available: { code: string; displayName: string; modes: string[] }[];
  connected: { id: string; providerCode: string; mode: string; label: string; status: string }[];
}
interface Member {
  userId: string;
  email: string;
  fullName: string;
  role: string;
}

const KYB_LABEL: Record<string, string> = { not_started: 'Non commencée', submitted: 'En cours d’examen', verified: 'Vérifiée', rejected: 'Refusée' };

export default function SettingsPage() {
  const { orgApi, refresh } = useOrg();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [welcome, setWelcome] = useState(false);

  const load = useCallback(async () => {
    setOrg(await orgApi<OrgInfo>(''));
    setProviders(await orgApi<Providers>('/providers'));
    setMembers(await orgApi<Member[]>('/members'));
  }, [orgApi]);

  useEffect(() => {
    void load();
    setWelcome(new URLSearchParams(window.location.search).has('welcome'));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'success', text: ok });
      await load();
      await refresh();
    } catch (e) {
      setMsg({ kind: 'danger', text: e instanceof ApiError ? e.message : 'Erreur' });
    }
  };

  if (!org || !providers) return <p className="vp-muted">Chargement…</p>;
  const can = (p: string) => org.myPermissions.includes(p);
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };

  return (
    <div className="vp-stack" style={{ maxWidth: 820 }}>
      <h1>Paramètres</h1>
      {welcome && <Alert kind="success">Bienvenue sur VITPAY ! Étape suivante : connectez votre compte prestataire de paiement ci-dessous.</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card title="Prestataires de paiement">
        <p className="vp-muted vp-small" style={{ marginTop: 0 }}>
          Les paiements sont exécutés par <strong>votre propre compte</strong> chez un prestataire agréé : les fonds vous sont reversés directement par ce prestataire. VITPAY ne détient jamais vos fonds.
        </p>
        {providers.connected.map((c) => (
          <div key={c.id} className="vp-row vp-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--vp-border)' }}>
            <span>
              {c.label} <span className="vp-badge vp-badge-neutral">{c.mode}</span>
            </span>
            <span className="vp-row">
              <StatusBadge status={c.status} />
              {can('providers:manage') && c.status === 'active' && (
                <Button variant="ghost" onClick={() => run(() => orgApi(`/providers/${c.id}`, { method: 'DELETE' }), 'Compte désactivé.')}>
                  Désactiver
                </Button>
              )}
            </span>
          </div>
        ))}
        {can('providers:manage') &&
          providers.available
            .filter((p) => !providers.connected.some((c) => c.providerCode === p.code && c.status === 'active'))
            .map((p) => (
              <div key={p.code} className="vp-row" style={{ marginTop: 12 }}>
                <Button variant="accent" onClick={() => run(() => orgApi('/providers', { method: 'POST', body: { providerCode: p.code, mode: 'sandbox' } }), `${p.displayName} connecté.`)}>
                  Connecter : {p.displayName}
                </Button>
              </div>
            ))}
        <p className="vp-muted vp-small">
          Mode réel (live) : désactivé tant que la validation juridique et réglementaire de VITPAY n’est pas finalisée et que votre KYB n’est pas vérifié.
        </p>
      </Card>

      <Card title={<>Vérification de l’entreprise (KYB) <StatusBadge status={org.kybStatus} label={KYB_LABEL[org.kybStatus]} /></>}>
        {org.kybStatus === 'verified' ? (
          <p>
            {org.legalName} — ICE {org.ice} — RC {org.rc}
          </p>
        ) : can('org:update') ? (
          <form className="vp-stack" onSubmit={(e) => { const d = form(e); void run(() => orgApi('/kyb', { method: 'POST', body: d }), 'Informations envoyées pour vérification.'); }}>
            <Field label="Raison sociale" name="legalName" defaultValue={org.legalName ?? ''} required />
            <Field label="ICE (15 chiffres)" name="ice" defaultValue={org.ice ?? ''} required pattern="\d{15}" />
            <Field label="Registre du commerce (RC)" name="rc" defaultValue={org.rc ?? ''} required />
            <Field label="Adresse du siège" name="address" defaultValue={org.address ?? ''} required />
            <p className="vp-muted vp-small" style={{ margin: 0 }}>Le téléversement des justificatifs sera ajouté avec le stockage documentaire sécurisé.</p>
            <Button type="submit">Soumettre</Button>
          </form>
        ) : (
          <p className="vp-muted">Seul un administrateur peut soumettre ces informations.</p>
        )}
      </Card>

      <Card title="Équipe">
        <div className="vp-table-wrap">
          <table className="vp-table">
            <tbody>
              {members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.fullName}</td>
                  <td className="vp-muted">{m.email}</td>
                  <td>
                    <span className="vp-badge vp-badge-neutral">{m.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('members:manage') && (
          <form className="vp-row" style={{ alignItems: 'flex-end', marginTop: 12 }} onSubmit={(e) => { const d = form(e); void run(() => orgApi('/members', { method: 'POST', body: d }), 'Collaborateur ajouté.'); }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Field label="E-mail d’un compte VITPAY existant" name="email" type="email" required />
            </div>
            <div style={{ width: 160 }}>
              <Select label="Rôle" name="role" defaultValue="cashier">
                <option value="admin">Administrateur</option>
                <option value="cashier">Caissier</option>
                <option value="viewer">Lecture seule</option>
              </Select>
            </div>
            <Button type="submit" variant="ghost">
              Ajouter
            </Button>
          </form>
        )}
      </Card>

      <Card title="Points de vente">
        <PosList />
      </Card>

      {can('billing:read') && (
        <Card title="Relevés de commissions VITPAY">
          <StatementList />
        </Card>
      )}

      <Card title="Tarification">
        <p style={{ margin: 0 }}>
          Commission VITPAY : <strong>{(org.vitpayFeeBps / 100).toFixed(2)} %</strong> par paiement confirmé (facturée séparément). Les frais de votre prestataire s’appliquent selon votre contrat avec lui.
        </p>
      </Card>
    </div>
  );
}

function StatementList() {
  const { orgApi, orgId } = useOrg();
  const [list, setList] = useState<{ id: string; number: string; periodStart: string; periodEnd: string; fees: MoneyView; status: string }[] | null>(null);
  useEffect(() => {
    orgApi<typeof list>('/billing/statements').then(setList).catch(() => setList([]));
  }, [orgApi]);
  if (!list) return <p className="vp-muted">Chargement…</p>;
  if (!list.length) return <p className="vp-muted">Aucun relevé pour le moment.</p>;
  return (
    <div className="vp-stack" style={{ gap: 6 }}>
      {list.map((s) => (
        <div key={s.id} className="vp-row vp-between">
          <span>
            <a href={`/api/v1/orgs/${orgId}/billing/statements/${s.id}/statement.pdf`} target="_blank" rel="noreferrer" className="vp-mono">
              {s.number}
            </a>{' '}
            <span className="vp-muted vp-small">
              {s.periodStart} → {s.periodEnd}
            </span>
          </span>
          <span className="vp-row" style={{ gap: 8 }}>
            <strong>{formatMoney(s.fees)}</strong>
            <StatusBadge status={s.status === 'issued' ? 'pending' : s.status === 'paid' ? 'paid' : 'cancelled'} label={s.status === 'issued' ? 'à régler' : s.status === 'paid' ? 'réglé' : 'annulé'} />
          </span>
        </div>
      ))}
    </div>
  );
}

function PosList() {
  const { orgApi } = useOrg();
  const [list, setList] = useState<{ id: string; name: string; status: string }[]>([]);
  const load = useCallback(() => orgApi<{ id: string; name: string; status: string }[]>('/points-of-sale').then(setList), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="vp-stack">
      {list.map((p) => (
        <div key={p.id} className="vp-row vp-between">
          <span>{p.name}</span>
          <StatusBadge status={p.status} />
        </div>
      ))}
      <form
        className="vp-row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const name = String(new FormData(formEl).get('name'));
          await orgApi('/points-of-sale', { method: 'POST', body: { name } }).catch(() => undefined);
          formEl.reset();
          await load();
        }}
      >
        <div style={{ flex: 1 }}>
          <Field label="Nouveau point de vente" name="name" required />
        </div>
        <Button type="submit" variant="ghost">
          Ajouter
        </Button>
      </form>
    </div>
  );
}
