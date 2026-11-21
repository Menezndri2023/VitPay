'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, CopyButton, EmptyState, errorText, Field, formatDate, LinkButton, PageHeader, PageSkeleton, StatusBadge, TestBadge } from '@vitpay/ui';
import { useOrg } from '../org-context';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  mode: 'test' | 'live';
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
  const [liveKeysAvailable, setLiveKeysAvailable] = useState(false);
  const [hooks, setHooks] = useState<{ endpoints: Endpoint[]; recentDeliveries: Delivery[] }>({ endpoints: [], recentDeliveries: [] });
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [c, k, st, h] = await Promise.all([
      orgApi<{ scopes: string[]; events: string[] }>('/developers/catalog'),
      orgApi<ApiKey[]>('/developers/api-keys'),
      orgApi<{ liveKeysAvailable: boolean }>('/developers/settings'),
      orgApi<{ endpoints: Endpoint[]; recentDeliveries: Delivery[] }>('/developers/webhooks'),
    ]);
    setCatalog(c);
    setKeys(k);
    setLiveKeysAvailable(st.liveKeysAvailable);
    setHooks(h);
  }, [orgApi]);
  useEffect(() => {
    if (org.role === 'owner' || org.role === 'admin') load().catch((e) => setMsg({ kind: 'danger', text: errorText(e) }));
  }, [load, org.role]);

  if (org.role !== 'owner' && org.role !== 'admin') return <Alert kind="warning">Réservé aux propriétaires et administrateurs de l’organisation.</Alert>;
  if (!catalog) return msg ? <Alert kind={msg.kind}>{msg.text}</Alert> : <PageSkeleton />;

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
    if (busy) return;
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      if (ok) setMsg({ kind: 'success', text: ok });
      await load();
    } catch (e) {
      setMsg({ kind: 'danger', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const createKey = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const scopes = fd.getAll('scopes').map(String);
    void run(async () => {
      const r = await orgApi<{ secret: string; name: string }>('/developers/api-keys', { method: 'POST', body: { name: fd.get('name'), scopes, mode: fd.get('mode') ?? 'test' } });
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
    <div className="vp-stack-lg" style={{ maxWidth: 920 }}>
      <PageHeader
        title="Développeurs"
        subtitle="Intégrez VITPAY à votre site ou à votre logiciel : créez des demandes de paiement par API et recevez les confirmations par webhook."
        actions={
          <LinkButton variant="ghost" icon="external" href="https://vitpay-ma.com/developpeurs.html" target="_blank" rel="noreferrer">
            Documentation
          </LinkButton>
        }
      />
      <div className="vp-card vp-row vp-between">
        <span>
          <span className="vp-muted vp-small" style={{ display: 'block' }}>
            Identifiant d’organisation (dans l’URL des appels API)
          </span>
          <code style={{ fontSize: 14 }}>{orgId}</code>
        </span>
        <CopyButton text={orgId} size="sm" />
      </div>
      {secret && (
        <Alert kind="warning">
          <strong>{secret.label}</strong> — copiez-la maintenant, elle ne sera plus jamais affichée :
          <div className="vp-row" style={{ marginTop: 8, flexWrap: 'nowrap', gap: 8 }}>
            <input className="vp-input vp-mono" readOnly value={secret.value} onFocus={(e) => e.currentTarget.select()} aria-label="Secret" />
            <CopyButton text={secret.value} variant="primary" />
          </div>
          <Button variant="ghost" size="sm" style={{ marginTop: 8 }} onClick={() => setSecret(null)}>
            J’ai mis le secret en lieu sûr
          </Button>
        </Alert>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card title="Clés API" description="Une clé de test crée des demandes payables avec le prestataire simulé ou vos clés sandbox : aucun argent réel. Gardez les clés côté serveur, jamais dans une application mobile ou une page web.">
        {keys.length === 0 ? (
          <EmptyState icon="key" title="Aucune clé API">
            Créez une clé de test ci-dessous pour faire vos premiers appels.
          </EmptyState>
        ) : (
        <div className="vp-table-wrap">
          <table className="vp-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Mode</th>
                <th>Clé</th>
                <th>Périmètres</th>
                <th>Dernière utilisation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...keys].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt)).map((k) => (
                <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td>{k.name}</td>
                  <td>{k.mode === 'live' ? <span className="vp-badge vp-badge-success vp-badge-plain">Réel</span> : <TestBadge />}</td>
                  <td className="vp-mono">{k.prefix}…</td>
                  <td className="vp-small">{k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}</td>
                  <td className="vp-small">{formatDate(k.lastUsedAt)}</td>
                  <td>
                    {k.revokedAt ? (
                      <StatusBadge status="revoked" />
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => confirm(`Révoquer la clé « ${k.name} » ? Les intégrations qui l’utilisent cesseront de fonctionner.`) && run(() => orgApi(`/developers/api-keys/${k.id}`, { method: 'DELETE' }), 'Clé révoquée.')}>
                        Révoquer
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <form className="vp-stack" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--vp-border)' }} onSubmit={createKey}>
          <h3 style={{ margin: 0 }}>Nouvelle clé</h3>
          <Field label="Nom de la clé" name="name" placeholder="Site e-commerce" required minLength={2} />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="vp-label">Mode</legend>
            <div className="vp-row">
              <label className="vp-row vp-small" style={{ gap: 6 }}>
                <input type="radio" name="mode" value="test" defaultChecked /> Test (paiements simulés, aucun débit réel)
              </label>
              <label className="vp-row vp-small" style={{ gap: 6 }}>
                <input type="radio" name="mode" value="live" disabled={!liveKeysAvailable} /> Réel
              </label>
            </div>
            {!liveKeysAvailable && <p className="vp-small vp-muted" style={{ margin: '4px 0 0' }}>Les clés réelles seront disponibles à l’ouverture des paiements réels.</p>}
          </fieldset>
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
          <div>
            <Button type="submit" icon="key" busy={busy}>
              Créer une clé
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Webhooks" description="VITPAY envoie un événement signé à votre serveur à chaque changement : paiement confirmé, échoué, remboursé… Vérifiez toujours la signature VitPay-Signature.">
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
                  <Button variant="ghost" size="sm" onClick={() => run(() => orgApi(`/developers/webhooks/${ep.id}/test`, { method: 'POST' }), 'Événement de test programmé : il apparaîtra dans les livraisons récentes.')}>
                    Tester
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => rotate(ep)}>
                    Changer le secret
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => confirm(`Désactiver l’envoi des événements vers ${ep.url} ?`) && run(() => orgApi(`/developers/webhooks/${ep.id}`, { method: 'DELETE' }), 'Endpoint désactivé.')}>
                    Désactiver
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
        {!hooks.endpoints.length && (
          <p className="vp-muted" style={{ marginTop: 0 }}>
            Aucun endpoint. Sans webhook, interrogez l’API pour connaître le statut d’un paiement.
          </p>
        )}
        <form className="vp-stack" style={{ marginTop: 16, paddingTop: 16, borderTop: hooks.endpoints.length ? '1px solid var(--vp-border)' : 0 }} onSubmit={createHook}>
          <h3 style={{ margin: 0 }}>Nouvel endpoint</h3>
          <Field label="URL HTTPS de réception" name="url" type="url" placeholder="https://monsite.ma/webhooks/vitpay" required />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="vp-label">Événements</legend>
            <div className="vp-row">
              {catalog.events.map((ev) => (
                <label key={ev} className="vp-row vp-small" style={{ gap: 6 }}>
                  <input type="checkbox" name="events" value={ev} defaultChecked={ev === 'payment.succeeded'} /> <code>{ev}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Button type="submit" busy={busy}>
              Ajouter l’endpoint
            </Button>
          </div>
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
                        <StatusBadge status={d.status === 'succeeded' || d.status === 'delivered' ? 'succeeded' : d.status === 'failed' || d.status === 'dead' ? 'failed' : 'pending'} label={d.status === 'succeeded' || d.status === 'delivered' ? 'Livré' : d.status === 'failed' || d.status === 'dead' ? 'Échec' : 'En attente'} />
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
      <p className="vp-muted vp-small" style={{ margin: 0 }}>
        Documentation complète (authentification, modes test et réel, idempotence, signatures, kit Node.js) : <a href="https://vitpay-ma.com/developpeurs.html" target="_blank" rel="noreferrer">vitpay-ma.com/developpeurs</a>.
      </p>
    </div>
  );
}
