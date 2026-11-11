'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, ApiError, Button, Card, Field, formatDate, StatusBadge } from '@vitpay/ui';
import { useOrg } from '../org-context';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface Endpoint {
  id: string;
  url: string;
  events: string[];
  previousSecretExpiresAt?: string | null;
  status: string;
}
interface Delivery {
  id: string;
  endpointId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

const SCOPE_LABEL: Record<string, string> = {
  'requests:create': 'Créer des demandes',
  'requests:read': 'Lire les demandes',
  'requests:cancel': 'Annuler des demandes',
  'refunds:create': 'Rembourser',
};

export default function DevelopersPage() {
  const { orgApi, orgId, org } = useOrg();
  const [catalog, setCatalog] = useState<{ scopes: string[]; events: string[] } | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hooks, setHooks] = useState<{ endpoints: Endpoint[]; recentDeliveries: Delivery[] }>({ endpoints: [], recentDeliveries: [] });
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setCatalog(await orgApi('/developers/catalog'));
    setKeys(await orgApi('/developers/api-keys'));
    setHooks(await orgApi('/developers/webhooks'));
  }, [orgApi]);
  useEffect(() => {
    if (org.role === 'owner' || org.role === 'admin') void load();
  }, [load, org.role]);

  if (org.role !== 'owner' && org.role !== 'admin') return <Alert kind="warning">Réservé aux propriétaires et administrateurs.</Alert>;
  if (!catalog) return <p className="vp-muted">Chargement…</p>;

  const rotate = (ep: Endpoint) =>
    run(async () => {
      if (
        !window.confirm(
          'Avant de changer le secret : pendant 24 h, chaque requête portera DEUX signatures v1 (nouveau et ancien secret). Votre code de vérification doit accepter plusieurs valeurs v1 (voir la documentation développeur), sinon vos réceptions échoueront.\n\nContinuer ?',
        )
      )
        return;
      const leaked = window.confirm(
        'Le secret actuel a-t-il fuité ?\n\nOK : il est révoqué immédiatement.\nAnnuler : il reste accepté 24 h, le temps de déployer le nouveau.',
      );
      const r = await orgApi<{ secret: string }>(`/developers/webhooks/${ep.id}/rotate-secret`, { method: 'POST', body: { overlapHours: leaked ? 0 : 24 } });
      setSecret({ label: `Nouveau secret de signature pour ${ep.url}`, value: r.secret });
    }, 'Secret remplacé.');

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: 'success', text: ok });
      await load();
    } catch (e) {
      setMsg({ kind: 'danger', text: e instanceof ApiError ? `${e.message}${e.details ? ` — ${JSON.stringify(e.details)}` : ''}` : 'Erreur' });
    }
  };

  const createKey = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const scopes = fd.getAll('scopes').map(String);
    void run(async () => {
      const r = await orgApi<{ secret: string; name: string }>('/developers/api-keys', { method: 'POST', body: { name: fd.get('name'), scopes } });
      setSecret({ label: `Clé « ${r.name} »`, value: r.secret });
    });
  };

  const createHook = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(async () => {
      const r = await orgApi<{ secret: string; url: string }>('/developers/webhooks', { method: 'POST', body: { url: fd.get('url'), events: fd.getAll('events').map(String) } });
      setSecret({ label: `Secret de signature pour ${r.url}`, value: r.secret });
    });
  };

  return (
    <div className="vp-stack" style={{ maxWidth: 900 }}>
      <h1>Développeurs</h1>
      <p className="vp-muted" style={{ margin: 0 }}>
        Intégrez VITPAY à votre site ou à votre logiciel : créez des demandes de paiement par API et recevez les confirmations par webhook. Identifiant d’organisation : <code>{orgId}</code>
      </p>
      {secret && (
        <Alert kind="warning">
          <strong>{secret.label}</strong> — copiez-la maintenant, elle ne sera plus jamais affichée :
          <div style={{ marginTop: 8 }}>
            <input className="vp-input vp-mono" readOnly value={secret.value} onFocus={(e) => e.currentTarget.select()} aria-label="Secret" />
          </div>
          <Button variant="ghost" style={{ marginTop: 8 }} onClick={() => setSecret(null)}>
            J’ai copié le secret
          </Button>
        </Alert>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card title="Clés API">
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Clé</th>
                <th>Périmètres</th>
                <th>Dernière utilisation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="vp-mono">{k.prefix}…</td>
                  <td className="vp-small">{k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}</td>
                  <td className="vp-small">{formatDate(k.lastUsedAt)}</td>
                  <td>
                    {k.revokedAt ? (
                      <StatusBadge status="cancelled" label="révoquée" />
                    ) : (
                      <Button variant="ghost" onClick={() => confirm(`Révoquer la clé « ${k.name} » ? Les intégrations qui l’utilisent cesseront de fonctionner.`) && run(() => orgApi(`/developers/api-keys/${k.id}`, { method: 'DELETE' }), 'Clé révoquée.')}>
                        Révoquer
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!keys.length && (
                <tr>
                  <td colSpan={5} className="vp-muted">
                    Aucune clé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form className="vp-stack" style={{ marginTop: 12 }} onSubmit={createKey}>
          <Field label="Nom de la clé" name="name" placeholder="Site e-commerce" required minLength={2} />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="vp-label">Périmètres (accorder le strict nécessaire)</legend>
            <div className="vp-row">
              {catalog.scopes.map((s) => (
                <label key={s} className="vp-row vp-small" style={{ gap: 6 }}>
                  <input type="checkbox" name="scopes" value={s} defaultChecked={s === 'requests:create' || s === 'requests:read'} /> {SCOPE_LABEL[s] ?? s}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit">Créer une clé</Button>
        </form>
      </Card>

      <Card title="Webhooks">
        {hooks.endpoints.map((ep) => (
          <div key={ep.id} className="vp-row vp-between" style={{ borderBottom: '1px solid var(--vp-border)', padding: '8px 0' }}>
            <span>
              <span className="vp-mono">{ep.url}</span>
              <div className="vp-small vp-muted">{ep.events.join(', ')}</div>
              {ep.previousSecretExpiresAt && new Date(ep.previousSecretExpiresAt) > new Date() && (
                <div className="vp-small vp-muted">Ancien secret encore accepté jusqu’au {new Date(ep.previousSecretExpiresAt).toLocaleString('fr-MA', { timeZone: 'Africa/Casablanca' })}</div>
              )}
            </span>
            <span className="vp-row" style={{ gap: 6 }}>
              <StatusBadge status={ep.status} />
              {ep.status === 'active' && (
                <>
                  <Button variant="ghost" onClick={() => run(() => orgApi(`/developers/webhooks/${ep.id}/test`, { method: 'POST' }), 'Événement de test programmé.')}>
                    Tester
                  </Button>
                  <Button variant="ghost" onClick={() => rotate(ep)}>
                    Changer le secret
                  </Button>
                  <Button variant="ghost" onClick={() => run(() => orgApi(`/developers/webhooks/${ep.id}`, { method: 'DELETE' }), 'Endpoint désactivé.')}>
                    Désactiver
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
        <form className="vp-stack" style={{ marginTop: 12 }} onSubmit={createHook}>
          <Field label="URL HTTPS de réception" name="url" type="url" placeholder="https://monsite.ma/webhooks/vitpay" required />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="vp-label">Événements</legend>
            <div className="vp-row">
              {catalog.events.map((ev) => (
                <label key={ev} className="vp-row vp-small" style={{ gap: 6 }}>
                  <input type="checkbox" name="events" value={ev} defaultChecked={ev === 'payment.succeeded'} /> {ev}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit">Ajouter l’endpoint</Button>
        </form>
        {hooks.recentDeliveries.length > 0 && (
          <>
            <h3 style={{ marginTop: 20 }}>Livraisons récentes</h3>
            <div className="vp-table-wrap">
              <table className="vp-table">
                <tbody>
                  {hooks.recentDeliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="vp-small">{formatDate(d.createdAt)}</td>
                      <td className="vp-mono vp-small">{d.eventType}</td>
                      <td>
                        <StatusBadge status={d.status === 'succeeded' ? 'succeeded' : d.status === 'failed' ? 'failed' : 'pending'} label={d.status} />
                      </td>
                      <td className="vp-small vp-muted">
                        {d.attempts} essai(s) {d.lastStatusCode ? `· HTTP ${d.lastStatusCode}` : ''} {d.lastError ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <p className="vp-muted vp-small">
        Documentation : <code>docs/DEVELOPERS.md</code> — authentification, idempotence, vérification des signatures.
      </p>
    </div>
  );
}
