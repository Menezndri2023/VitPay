'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  api,
  Button,
  Card,
  EmptyState,
  errorText,
  Field,
  formatDate,
  formatMoney,
  Icon,
  MoneyView,
  PageHeader,
  PageSkeleton,
  ROLE_LABELS_FR,
  Select,
  StatusBadge,
  Tabs,
  TestBadge,
  useTab,
  useToast,
} from '@vitpay/ui';
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
  available: { code: string; displayName: string; modes: string[]; credentialFields: { key: string; label: string; secret: boolean }[] | null }[];
  connected: { id: string; providerCode: string; mode: string; label: string; status: string; webhookUrl: string }[];
}
interface Member {
  userId: string;
  email: string;
  fullName: string;
  role: string;
}

const KYB_LABEL: Record<string, string> = { not_started: 'Non commencée', submitted: 'En cours d’examen', verified: 'Vérifiée', rejected: 'Refusée' };
const TABS = ['providers', 'company', 'team', 'pos', 'billing'] as const;
type Tab = (typeof TABS)[number];

/** Nom lisible d'un compte prestataire (sans la mention technique du mode, affichée en badge). */
const providerName = (label: string) => label.replace(/(\s*\((sandbox|live)\))+$/i, '').replace(/\s*\(sandbox\)/i, '');

export default function SettingsPage() {
  const { orgApi, refresh } = useOrg();
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useTab<Tab>(TABS, 'providers');

  const load = useCallback(async () => {
    try {
      const [o, p, m] = await Promise.all([orgApi<OrgInfo>(''), orgApi<Providers>('/providers'), orgApi<Member[]>('/members')]);
      setOrg(o);
      setProviders(p);
      setMembers(m);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [orgApi]);

  useEffect(() => {
    void load();
    setWelcome(new URLSearchParams(window.location.search).has('welcome'));
  }, [load]);

  /** Exécute une action ; le message de réussite apparaît en confirmation éphémère ET dans la page. */
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setMsg(null);
    setBusy(key);
    try {
      await fn();
      setMsg({ kind: 'success', text: ok });
      await load();
      await refresh();
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  if (loadError && !org) return <Alert kind="danger">{loadError}</Alert>;
  if (!org || !providers) return <PageSkeleton />;
  const can = (p: string) => org.myPermissions.includes(p);
  const form = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
  };
  const activeProviders = providers.connected.filter((c) => c.status === 'active');

  return (
    <div className="vp-stack-lg" style={{ maxWidth: 880 }}>
      <PageHeader title="Paramètres" subtitle={org.displayName} />
      {welcome && <Alert kind="success">Bienvenue sur VITPAY ! Étape suivante : connectez votre compte prestataire de paiement ci-dessous.</Alert>}
      <Tabs<Tab>
        label="Sections des paramètres"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMsg(null);
        }}
        tabs={[
          { id: 'providers', label: 'Prestataires', dot: !activeProviders.length },
          { id: 'company', label: 'Entreprise', dot: org.kybStatus === 'not_started' || org.kybStatus === 'rejected' },
          { id: 'team', label: 'Équipe' },
          { id: 'pos', label: 'Points de vente et TPE' },
          { id: 'billing', label: 'Facturation' },
        ]}
      />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="vp-stack-lg">
        {tab === 'providers' && (
          <Card
            title="Prestataires de paiement"
            description={
              <>
                Les paiements sont exécutés par <strong>votre propre compte</strong> chez un prestataire agréé : les fonds vous sont reversés directement par ce prestataire. VITPAY ne détient jamais vos fonds.
              </>
            }
          >
            {providers.connected.length > 0 ? (
              <div className="vp-list">
                {providers.connected.map((c) => (
                  <div key={c.id} className="vp-row vp-between" style={{ alignItems: 'flex-start' }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{providerName(c.label)}</span> {c.mode === 'sandbox' ? <TestBadge label="Mode test" /> : <span className="vp-badge vp-badge-success vp-badge-plain">Mode réel</span>}
                      {c.status === 'active' && providers.available.find((p) => p.code === c.providerCode)?.credentialFields && (
                        <span className="vp-hint" style={{ display: 'block', wordBreak: 'break-all', marginTop: 4 }}>
                          URL de webhook à déclarer chez le prestataire : <code>{c.webhookUrl}</code>
                        </span>
                      )}
                    </span>
                    <span className="vp-row" style={{ gap: 8 }}>
                      <StatusBadge status={c.status} />
                      {can('providers:manage') && c.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busy === c.id}
                          onClick={() => confirm(`Désactiver ${providerName(c.label)} ? Les nouvelles demandes ne pourront plus l’utiliser.`) && run(c.id, () => orgApi(`/providers/${c.id}`, { method: 'DELETE' }), 'Compte désactivé.')}
                        >
                          Désactiver
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="link" title="Aucun prestataire connecté">
                Connectez votre compte pour commencer à encaisser. En attendant, le prestataire simulé permet de tout essayer sans argent réel.
              </EmptyState>
            )}
            {can('providers:manage') &&
              providers.available
                .filter((p) => !providers.connected.some((c) => c.providerCode === p.code && c.status === 'active'))
                .map((p) =>
                  p.credentialFields ? (
                    // Modèle A : le commerçant saisit les clés de SON compte (mode test tant que le réel est verrouillé).
                    <form
                      key={p.code}
                      className="vp-stack"
                      style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--vp-border)' }}
                      autoComplete="off"
                      onSubmit={(e) => {
                        const credentials = form(e);
                        const el = e.currentTarget;
                        void run(
                          p.code,
                          async () => {
                            await orgApi('/providers', { method: 'POST', body: { providerCode: p.code, mode: 'sandbox', credentials } });
                            el.reset();
                          },
                          `${p.displayName} (mode test) connecté. Pensez à désactiver le prestataire simulé pour utiliser ce compte.`,
                        );
                      }}
                    >
                      <h3 style={{ margin: 0 }}>
                        {providerName(p.displayName)} <TestBadge label="Mode test" />
                      </h3>
                      <span className="vp-hint">Clés « sandbox » de votre compte, dans ses paramètres développeur. Elles sont vérifiées auprès du prestataire puis stockées chiffrées.</span>
                      <div className="vp-form-grid">
                        {p.credentialFields.map((f) => (
                          <Field key={f.key} label={f.label} name={f.key} type={f.secret ? 'password' : 'text'} required spellCheck={false} />
                        ))}
                      </div>
                      <div>
                        <Button type="submit" busy={busy === p.code}>
                          Connecter : {p.displayName}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div key={p.code} className="vp-row" style={{ marginTop: 16 }}>
                      <Button icon="link" busy={busy === p.code} onClick={() => run(p.code, () => orgApi('/providers', { method: 'POST', body: { providerCode: p.code, mode: 'sandbox' } }), `${p.displayName} connecté.`)}>
                        Connecter : {p.displayName}
                      </Button>
                    </div>
                  ),
                )}
            <p className="vp-hint" style={{ marginBottom: 0 }}>
              Mode réel : disponible quand la validation juridique et réglementaire de VITPAY sera finalisée et que votre dossier entreprise sera vérifié.
            </p>
          </Card>
        )}

        {tab === 'company' && (
          <>
            <Card
              title={
                <>
                  Vérification de l’entreprise (KYB) <StatusBadge status={org.kybStatus} label={KYB_LABEL[org.kybStatus]} />
                </>
              }
              description="Requise pour passer en paiements réels. L’équipe conformité VITPAY examine le dossier et les justificatifs."
            >
              {org.kybStatus === 'verified' ? (
                <dl className="vp-kv" style={{ maxWidth: 520 }}>
                  <dt>Raison sociale</dt>
                  <dd>{org.legalName}</dd>
                  <dt>ICE</dt>
                  <dd className="vp-mono">{org.ice}</dd>
                  <dt>RC</dt>
                  <dd>{org.rc}</dd>
                  <dt>Adresse</dt>
                  <dd>{org.address}</dd>
                </dl>
              ) : can('org:update') ? (
                <form
                  className="vp-stack"
                  onSubmit={(e) => {
                    const d = form(e);
                    void run('kyb', () => orgApi('/kyb', { method: 'POST', body: d }), 'Informations envoyées pour vérification.');
                  }}
                >
                  {org.kybStatus === 'rejected' && <Alert kind="danger">Dossier refusé : corrigez les informations ou les justificatifs indiqués, puis soumettez à nouveau.</Alert>}
                  <div className="vp-form-grid">
                    <Field label="Raison sociale" name="legalName" defaultValue={org.legalName ?? ''} required />
                    <Field label="ICE (15 chiffres)" name="ice" defaultValue={org.ice ?? ''} required pattern="\d{15}" inputMode="numeric" maxLength={15} title="15 chiffres" />
                    <Field label="Registre du commerce (RC)" name="rc" defaultValue={org.rc ?? ''} required />
                    <Field label="Adresse du siège" name="address" defaultValue={org.address ?? ''} required />
                  </div>
                  <div>
                    <Button type="submit" busy={busy === 'kyb'}>
                      {org.kybStatus === 'submitted' ? 'Mettre à jour le dossier' : 'Soumettre le dossier'}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="vp-muted">Seul un administrateur peut soumettre ces informations.</p>
              )}
            </Card>
            {can('org:update') && (
              <Card title="Justificatifs" description="PDF, PNG ou JPEG, 5 Mo maximum. Les documents sont chiffrés ; seuls votre organisation et l’équipe conformité VITPAY peuvent les consulter (chaque consultation est journalisée).">
                <KybDocuments />
              </Card>
            )}
          </>
        )}

        {tab === 'team' && (
          <Card title="Équipe" description="Caissier : encaisse et crée des demandes. Lecture seule : consulte. Administrateur : tout, sauf supprimer le propriétaire.">
            <div className="vp-list">
              {members.map((m) => (
                <div key={m.userId} className="vp-row vp-between">
                  <span>
                    <strong>{m.fullName}</strong>
                    <div className="vp-muted vp-small">{m.email}</div>
                  </span>
                  <span className="vp-badge vp-badge-neutral vp-badge-plain">{ROLE_LABELS_FR[m.role] ?? m.role}</span>
                </div>
              ))}
            </div>
            {can('members:manage') && <Invitations onChange={load} />}
          </Card>
        )}

        {tab === 'pos' && (
          <>
            <Card title="Points de vente" description="Vos boutiques ou caisses : chaque encaissement en caisse est rattaché à un point de vente.">
              <PosList canManage={can('pos:manage') || can('org:update')} />
            </Card>
            <Card
              title="Terminaux de paiement (TPE)"
              description={
                <>
                  Encaissement carte présente : la carte est lue par le terminal certifié, jamais par VITPAY. Aucun terminal réel n’est disponible à ce jour (contrat et documentation du fournisseur requis) : seul un <strong>TPE simulé</strong> peut être ajouté en mode test.
                </>
              }
            >
              <TerminalList canManage={can('pos:manage')} />
            </Card>
          </>
        )}

        {tab === 'billing' && (
          <>
            <Card title="Tarification">
              <p style={{ margin: 0 }}>
                Commission VITPAY : <strong>{(org.vitpayFeeBps / 100).toFixed(2).replace('.', ',')} %</strong> par paiement confirmé, facturée séparément chaque mois. Les frais de votre prestataire s’appliquent selon votre contrat avec lui.
              </p>
            </Card>
            {can('billing:read') && (
              <Card title="Relevés de commissions VITPAY">
                <StatementList />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Invitations({ onChange }: { onChange: () => Promise<void> }) {
  const { orgApi } = useOrg();
  const toast = useToast();
  const [pending, setPending] = useState<{ id: string; email: string; role: string; expiresAt: string }[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => orgApi<typeof pending>('/invitations').then(setPending).catch(() => setPending([])), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="vp-stack" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--vp-border)' }}>
      {pending.length > 0 && (
        <div className="vp-list">
          {pending.map((p) => (
            <div key={p.id} className="vp-row vp-between vp-small">
              <span>
                <Icon name="mail" style={{ verticalAlign: 'middle', marginInlineEnd: 6, color: 'var(--vp-text-muted)' }} />
                {p.email} <span className="vp-badge vp-badge-warning">Invitation en attente · {ROLE_LABELS_FR[p.role] ?? p.role}</span>
                <span className="vp-muted"> · expire le {formatDate(p.expiresAt)}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    await orgApi(`/invitations/${p.id}`, { method: 'DELETE' });
                    toast('Invitation révoquée.');
                    await load();
                  } catch (e) {
                    setMsg({ kind: 'danger', text: errorText(e) });
                  }
                }}
              >
                Révoquer
              </Button>
            </div>
          ))}
        </div>
      )}
      <form
        className="vp-row"
        style={{ alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const formEl = e.currentTarget;
          const d = Object.fromEntries(new FormData(formEl)) as Record<string, string>;
          setBusy(true);
          setMsg(null);
          try {
            await orgApi('/invitations', { method: 'POST', body: d });
            setMsg({ kind: 'success', text: `Invitation envoyée à ${d.email}.` });
            formEl.reset();
            await load();
            await onChange();
          } catch (err) {
            setMsg({ kind: 'danger', text: errorText(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <Field label="Inviter par e-mail" name="email" type="email" required placeholder="prenom@entreprise.ma" />
        </div>
        <div style={{ width: 170 }}>
          <Select label="Rôle" name="role" defaultValue="cashier">
            <option value="admin">Administrateur</option>
            <option value="cashier">Caissier</option>
            <option value="viewer">Lecture seule</option>
          </Select>
        </div>
        <Button type="submit" icon="send" busy={busy}>
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
  const load = useCallback(() => api<typeof docs>(`/v1/orgs/${orgId}/kyb/documents`).then(setDocs).catch(() => setDocs([])), [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  // Documents regroupés par type : le plus récent d'abord, les versions précédentes repliées.
  const kinds = Object.keys(KYB_KIND_LABEL).filter((k) => docs.some((d) => d.kind === k));
  const missing = ['rc_extract', 'ice_certificate', 'id_document', 'statutes', 'bank_details'].filter((k) => !docs.some((d) => d.kind === k && d.status !== 'rejected'));
  return (
    <div className="vp-stack">
      {missing.length > 0 && (
        <Alert kind="info">
          Justificatifs demandés par la conformité, encore à fournir : {missing.map((k) => KYB_KIND_LABEL[k]).join(', ')}.
        </Alert>
      )}
      {kinds.length > 0 && (
        <div className="vp-list">
          {kinds.map((k) => {
            const list = docs.filter((d) => d.kind === k).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const [latest, ...older] = list;
            const row = (d: (typeof docs)[number]) => (
              <div key={d.id} className="vp-row vp-between vp-small" style={{ padding: '4px 0' }}>
                <span>
                  <a href={`/api/v1/orgs/${orgId}/kyb/documents/${d.id}/download`}>{d.filename}</a> <span className="vp-muted">· {formatDate(d.createdAt)}</span>
                  {d.reviewNote && <div className="vp-muted">{d.reviewNote}</div>}
                </span>
                <StatusBadge status={d.status === 'accepted' ? 'verified' : d.status === 'rejected' ? 'rejected' : 'pending'} label={d.status === 'accepted' ? 'Accepté' : d.status === 'rejected' ? 'Refusé' : 'En examen'} />
              </div>
            );
            return (
              <div key={k}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{KYB_KIND_LABEL[k]}</div>
                {latest && row(latest)}
                {older.length > 0 && (
                  <details>
                    <summary className="vp-small vp-muted" style={{ cursor: 'pointer' }}>
                      {older.length} version{older.length > 1 ? 's' : ''} précédente{older.length > 1 ? 's' : ''}
                    </summary>
                    {older.map(row)}
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
      <form
        className="vp-row"
        style={{ alignItems: 'flex-end', paddingTop: 12, borderTop: kinds.length ? '1px solid var(--vp-border)' : 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(`/api/v1/orgs/${orgId}/kyb/documents`, { method: 'POST', body: new FormData(formEl), headers: { 'x-vitpay-csrf': '1' }, credentials: 'same-origin' });
            if (!res.ok) throw new Error(res.status === 422 ? 'Fichier refusé : PDF, PNG ou JPEG uniquement.' : res.status === 413 ? 'Fichier trop volumineux (5 Mo maximum).' : res.status === 409 ? 'Nombre maximal de documents atteint (30).' : 'Envoi impossible.');
            formEl.reset();
            setMsg({ kind: 'success', text: 'Document envoyé.' });
            await load();
          } catch (err) {
            setMsg({ kind: 'danger', text: err instanceof TypeError ? 'Connexion impossible. Réessayez.' : (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div style={{ width: 260 }}>
          <Select label="Type de document" name="kind" defaultValue={missing[0] ?? 'rc_extract'}>
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
        <Button type="submit" icon="file" busy={busy}>
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
    <Alert key={c.mode + c.credit.currency} kind="info">
      Avoir à imputer sur votre prochain relevé{c.mode === 'sandbox' ? ' (test)' : ''} : <strong>{formatMoney(c.credit)}</strong> — commission annulée suite à un remboursement ou un litige perdu.
    </Alert>
  ));
  if (!list.length)
    return (
      <>
        {creditNote}
        <EmptyState icon="receipt" title="Aucun relevé pour le moment">
          Un relevé est émis chaque début de mois pour les paiements confirmés du mois précédent.
        </EmptyState>
      </>
    );
  return (
    <div className="vp-stack">
      {creditNote}
      <div className="vp-list">
        {list.map((s) => (
          <div key={s.id} className="vp-row vp-between">
            <span>
              <a href={`/api/v1/orgs/${orgId}/billing/statements/${s.id}/statement.pdf`} target="_blank" rel="noreferrer" className="vp-mono">
                {s.number}
              </a>{' '}
              <span className="vp-muted vp-small">
                du {s.periodStart} au {s.periodEnd}
              </span>
            </span>
            <span className="vp-row" style={{ gap: 8 }}>
              <strong className="vp-num">
                {formatMoney(s.fees)}
                {s.fees.minor.startsWith('-') ? ' (avoir)' : ''}
              </strong>
              <StatusBadge status={s.status === 'issued' ? 'pending' : s.status === 'paid' ? 'paid' : 'cancelled'} label={s.status === 'issued' ? 'À régler' : s.status === 'paid' ? 'Réglé' : 'Annulé'} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalList({ canManage }: { canManage: boolean }) {
  const { orgApi } = useOrg();
  const [list, setList] = useState<Terminal[]>([]);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => orgApi<Terminal[]>('/terminals').then(setList).catch(() => setList([])), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    setMsg(null);
    setBusy(true);
    try {
      await orgApi('/terminals/sandbox', { method: 'POST', body: { label: String(new FormData(form).get('label')).trim() } });
      form.reset();
      setMsg({ kind: 'success', text: 'TPE simulé ajouté.' });
      await load();
    } catch (err) {
      setMsg({ kind: 'danger', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const disable = async (t: Terminal) => {
    if (!confirm(`Désactiver le TPE « ${t.label} » ?`)) return;
    try {
      await orgApi(`/terminals/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e) });
    }
  };
  const active = list.filter((t) => t.status === 'active');
  const inactive = list.filter((t) => t.status !== 'active');
  return (
    <div className="vp-stack">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {active.length > 0 ? (
        <div className="vp-list">
          {active.map((t) => (
            <div key={t.id} className="vp-row vp-between">
              <span>
                <Icon name="terminal" style={{ verticalAlign: 'middle', marginInlineEnd: 8, color: 'var(--vp-text-muted)' }} />
                <strong>{t.label}</strong> <span className="vp-mono vp-small vp-muted">{t.terminalRef}</span>
                {t.simulatorUrl && (
                  <>
                    {' · '}
                    <a href={t.simulatorUrl} target="_blank" rel="noreferrer" className="vp-small">
                      écran du TPE simulé
                    </a>
                  </>
                )}
              </span>
              <span className="vp-row" style={{ gap: 8 }}>
                <StatusBadge status={t.status} />
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => disable(t)}>
                    Désactiver
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="vp-muted" style={{ margin: 0 }}>
          Aucun TPE actif.
        </p>
      )}
      {inactive.length > 0 && (
        <details>
          <summary className="vp-small vp-muted" style={{ cursor: 'pointer' }}>
            {inactive.length} TPE désactivé{inactive.length > 1 ? 's' : ''}
          </summary>
          {inactive.map((t) => (
            <div key={t.id} className="vp-small vp-muted" style={{ padding: '4px 0' }}>
              {t.label} <span className="vp-mono">{t.terminalRef}</span>
            </div>
          ))}
        </details>
      )}
      {canManage && (
        <form className="vp-row" style={{ alignItems: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--vp-border)' }} onSubmit={add}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Nom du TPE simulé" name="label" required minLength={2} maxLength={60} placeholder="Caisse 1" />
          </div>
          <Button type="submit" variant="ghost" icon="plus" busy={busy}>
            Ajouter un TPE simulé
          </Button>
        </form>
      )}
    </div>
  );
}

function PosList({ canManage }: { canManage: boolean }) {
  const { orgApi } = useOrg();
  const [list, setList] = useState<{ id: string; name: string; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => orgApi<{ id: string; name: string; status: string }[]>('/points-of-sale').then(setList).catch(() => setList([])), [orgApi]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="vp-stack">
      <div className="vp-list">
        {list.map((p) => (
          <div key={p.id} className="vp-row vp-between">
            <span>
              <Icon name="store" style={{ verticalAlign: 'middle', marginInlineEnd: 8, color: 'var(--vp-text-muted)' }} />
              {p.name}
            </span>
            <StatusBadge status={p.status} />
          </div>
        ))}
      </div>
      {canManage && (
        <form
          className="vp-row"
          style={{ alignItems: 'flex-end', paddingTop: 12, borderTop: '1px solid var(--vp-border)' }}
          onSubmit={async (e) => {
            e.preventDefault();
            const formEl = e.currentTarget;
            const name = String(new FormData(formEl).get('name')).trim();
            setError(null);
            try {
              await orgApi('/points-of-sale', { method: 'POST', body: { name } });
              formEl.reset();
              await load();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="Nouveau point de vente" name="name" required minLength={2} maxLength={80} placeholder="Ex. Boutique Maârif" />
          </div>
          <Button type="submit" variant="ghost" icon="plus">
            Ajouter
          </Button>
        </form>
      )}
      {error && <Alert kind="danger">{error}</Alert>}
    </div>
  );
}
