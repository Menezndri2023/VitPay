'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, api, ApiError, Button, Card, Field, formatMoney, MoneyView, Select, StatusBadge } from '@vitpay/ui';
import { useOrg } from '../org-context';
import type { Terminal } from '../types';

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
            <Button type="submit">Soumettre</Button>
          </form>
        ) : (
          <p className="vp-muted">Seul un administrateur peut soumettre ces informations.</p>
        )}
      </Card>

      {can('org:update') && (
        <Card title="Justificatifs KYB">
          <KybDocuments />
        </Card>
      )}

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
        {can('members:manage') && <Invitations onChange={load} />}
      </Card>

      <Card title="Terminaux de paiement (TPE)">
        <TerminalList canManage={can('pos:manage')} />
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

function Invitations({ onChange }: { onChange: () => Promise<void> }) {
  const { orgApi } = useOrg();
  const [pending, setPending] = useState<{ id: string; email: string; role: string; expiresAt: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const load = useCallback(() => orgApi<typeof pending>('/invitations').then(setPending), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="vp-stack" style={{ marginTop: 12 }}>
      {pending.map((p) => (
        <div key={p.id} className="vp-row vp-between vp-small">
          <span>
            ✉️ {p.email} <span className="vp-badge vp-badge-warning">invitation en attente · {p.role}</span>
          </span>
          <Button variant="ghost" onClick={async () => { await orgApi(`/invitations/${p.id}`, { method: 'DELETE' }); await load(); }}>
            Révoquer
          </Button>
        </div>
      ))}
      <form
        className="vp-row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const d = Object.fromEntries(new FormData(formEl)) as Record<string, string>;
          try {
            await orgApi('/invitations', { method: 'POST', body: d });
            setMsg({ kind: 'success', text: `Invitation envoyée à ${d.email}.` });
            formEl.reset();
            await load();
            await onChange();
          } catch (err) {
            setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Erreur' });
          }
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <Field label="Inviter par e-mail" name="email" type="email" required />
        </div>
        <div style={{ width: 160 }}>
          <Select label="Rôle" name="role" defaultValue="cashier">
            <option value="admin">Administrateur</option>
            <option value="cashier">Caissier</option>
            <option value="viewer">Lecture seule</option>
          </Select>
        </div>
        <Button type="submit" variant="ghost">
          Inviter
        </Button>
      </form>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}

const KYB_KIND_LABEL: Record<string, string> = {
  rc_extract: 'Extrait du registre du commerce',
  ice_certificate: 'Attestation ICE',
  id_document: 'Pièce d’identité du dirigeant',
  statutes: 'Statuts',
  bank_details: 'RIB',
  other: 'Autre',
};

function KybDocuments() {
  const { orgId } = useOrg();
  const [docs, setDocs] = useState<{ id: string; kind: string; filename: string; status: string; reviewNote: string | null; createdAt: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<typeof docs>(`/v1/orgs/${orgId}/kyb/documents`).then(setDocs), [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="vp-stack">
      <p className="vp-muted vp-small" style={{ margin: 0 }}>
        PDF, PNG ou JPEG, 5 Mo maximum. Les documents sont chiffrés et ne sont consultables que par votre organisation et l’équipe conformité VITPAY (chaque consultation est journalisée).
      </p>
      {docs.map((d) => (
        <div key={d.id} className="vp-row vp-between vp-small">
          <span>
            <a href={`/api/v1/orgs/${orgId}/kyb/documents/${d.id}/download`}>{d.filename}</a> <span className="vp-muted">— {KYB_KIND_LABEL[d.kind] ?? d.kind}</span>
            {d.reviewNote && <div className="vp-muted">{d.reviewNote}</div>}
          </span>
          <StatusBadge status={d.status === 'accepted' ? 'verified' : d.status === 'rejected' ? 'rejected' : 'pending'} label={d.status === 'accepted' ? 'accepté' : d.status === 'rejected' ? 'refusé' : 'en examen'} />
        </div>
      ))}
      <form
        className="vp-row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(`/api/v1/orgs/${orgId}/kyb/documents`, { method: 'POST', body: new FormData(formEl), headers: { 'x-vitpay-csrf': '1' }, credentials: 'same-origin' });
            if (!res.ok) throw new Error(res.status === 422 ? 'Fichier refusé : PDF, PNG ou JPEG uniquement.' : res.status === 413 ? 'Fichier trop volumineux (5 Mo maximum).' : 'Envoi impossible.');
            formEl.reset();
            setMsg({ kind: 'success', text: 'Document envoyé.' });
            await load();
          } catch (err) {
            setMsg({ kind: 'danger', text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={{ width: 240 }}>
          <Select label="Type de document" name="kind" defaultValue="rc_extract">
            {Object.entries(KYB_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <Field label="Fichier" name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
        </div>
        <Button type="submit" variant="ghost" disabled={busy}>
          Envoyer
        </Button>
      </form>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </div>
  );
}

function StatementList() {
  const { orgApi, orgId } = useOrg();
  const [list, setList] = useState<{ id: string; number: string; periodStart: string; periodEnd: string; fees: MoneyView; status: string }[] | null>(null);
  const [credits, setCredits] = useState<{ mode: string; credit: MoneyView }[]>([]);
  useEffect(() => {
    orgApi<typeof list>('/billing/statements').then(setList).catch(() => setList([]));
    orgApi<{ mode: string; credit: MoneyView }[]>('/billing/statements/pending-credits').then(setCredits).catch(() => setCredits([]));
  }, [orgApi]);
  if (!list) return <p className="vp-muted">Chargement…</p>;
  const creditNote = credits.map((c) => (
    <p key={c.mode + c.credit.currency} className="vp-small vp-muted" style={{ margin: 0 }}>
      Avoir à imputer sur votre prochain relevé{c.mode === 'sandbox' ? ' (test)' : ''} : <strong>{formatMoney(c.credit)}</strong> — commission annulée suite à un remboursement ou un litige perdu.
    </p>
  ));
  if (!list.length) return <>{creditNote}<p className="vp-muted">Aucun relevé pour le moment.</p></>;
  return (
    <div className="vp-stack" style={{ gap: 6 }}>
      {creditNote}
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
            <strong>{formatMoney(s.fees)}{s.fees.minor.startsWith('-') ? ' (avoir)' : ''}</strong>
            <StatusBadge status={s.status === 'issued' ? 'pending' : s.status === 'paid' ? 'paid' : 'cancelled'} label={s.status === 'issued' ? 'à régler' : s.status === 'paid' ? 'réglé' : 'annulé'} />
          </span>
        </div>
      ))}
    </div>
  );
}

function TerminalList({ canManage }: { canManage: boolean }) {
  const { orgApi } = useOrg();
  const [list, setList] = useState<Terminal[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const load = useCallback(() => orgApi<Terminal[]>('/terminals').then(setList).catch(() => setList([])), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setMsg(null);
    try {
      await orgApi('/terminals/sandbox', { method: 'POST', body: { label: String(new FormData(form).get('label')) } });
      form.reset();
      setMsg({ kind: 'success', text: 'TPE simulé ajouté.' });
      await load();
    } catch (err) {
      setMsg({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Erreur' });
    }
  };
  const disable = async (id: string) => {
    await orgApi(`/terminals/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };
  return (
    <div className="vp-stack" style={{ gap: 8 }}>
      <p className="vp-muted vp-small" style={{ margin: 0 }}>
        Encaissement carte présente : la carte est lue par le terminal certifié, jamais par VITPAY. Aucun terminal réel n’est disponible à ce jour
        (contrat et documentation du fournisseur requis) : seul un <strong>TPE simulé</strong> peut être ajouté en sandbox.
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {list.map((t) => (
        <div key={t.id} className="vp-row vp-between" style={{ borderBottom: '1px solid var(--vp-border)', padding: '6px 0' }}>
          <span>
            {t.label} <span className="vp-mono vp-small vp-muted">{t.terminalRef}</span>
            {t.simulatorUrl && t.status === 'active' && (
              <>
                {' · '}
                <a href={t.simulatorUrl} target="_blank" rel="noreferrer" className="vp-small">
                  écran du TPE simulé
                </a>
              </>
            )}
          </span>
          <span className="vp-row" style={{ gap: 6 }}>
            <StatusBadge status={t.status} />
            {canManage && t.status === 'active' && (
              <Button variant="ghost" onClick={() => disable(t.id)}>
                Désactiver
              </Button>
            )}
          </span>
        </div>
      ))}
      {canManage && (
        <form className="vp-row" style={{ alignItems: 'flex-end' }} onSubmit={add}>
          <div style={{ flex: 1 }}>
            <Field label="Nom du TPE simulé" name="label" required minLength={2} maxLength={60} placeholder="Caisse 1" />
          </div>
          <Button type="submit" variant="ghost">
            Ajouter un TPE simulé
          </Button>
        </form>
      )}
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
