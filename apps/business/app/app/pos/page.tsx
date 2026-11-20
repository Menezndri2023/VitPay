'use client';

import { useEffect, useState } from 'react';
import { Alert, ApiError, Button, formatMoney, newIdempotencyKey } from '@vitpay/ui';
import { useOrg } from '../org-context';
import { RequestDetail, Terminal } from '../types';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'];

/**
 * Caisse : encaissement physique par QR dynamique (le client paie sur son téléphone) ou sur un
 * terminal de paiement (TPE, carte présente). VITPAY ne lit jamais la carte : le terminal certifié
 * s'en charge. Seul terminal disponible à ce jour : le TPE SIMULÉ (sandbox).
 */
export default function PosPage() {
  const { orgApi, orgId } = useOrg();
  const [pos, setPos] = useState<{ id: string; name: string }[]>([]);
  const [posId, setPosId] = useState('');
  const [amount, setAmount] = useState('');
  const [current, setCurrent] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState('');

  useEffect(() => {
    orgApi<{ id: string; name: string }[]>('/points-of-sale').then((p) => {
      setPos(p);
      setPosId(p[0]?.id ?? '');
    });
    orgApi<Terminal[]>('/terminals')
      .then((t) => {
        const active = t.filter((x) => x.status === 'active');
        setTerminals(active);
        setTerminalId(active[0]?.id ?? '');
      })
      .catch(() => setTerminals([]));
  }, [orgApi]);

  useEffect(() => {
    if (!current || current.status !== 'open') return;
    const t = setInterval(async () => {
      const r = await orgApi<RequestDetail>(`/payment-requests/${current.id}`).catch(() => null);
      if (r) setCurrent(r);
    }, 2000);
    return () => clearInterval(t);
  }, [current, orgApi]);

  const press = (k: string) => {
    if (k === '⌫') return setAmount((a) => a.slice(0, -1));
    if (k === ',' && (amount.includes(',') || !amount)) return;
    if (amount.includes(',') && (amount.split(',')[1]?.length ?? 0) >= 2) return;
    if (amount.length >= 9) return;
    setAmount((a) => (a === '0' && k !== ',' ? k : a + k));
  };

  const charge = async () => {
    setError(null);
    try {
      const created = await orgApi<{ id: string }>('/payment-requests', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: { amount: amount.replace(',', '.'), currency: 'MAD', description: 'Paiement en caisse', posId: posId || undefined, expiresInHours: 1 },
      });
      setCurrent(await orgApi<RequestDetail>(`/payment-requests/${created.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur');
    }
  };

  const refresh = async () => {
    if (current) setCurrent(await orgApi<RequestDetail>(`/payment-requests/${current.id}`));
  };

  const sendToTerminal = async () => {
    if (!current) return;
    setError(null);
    try {
      await orgApi(`/payment-requests/${current.id}/terminal-payment`, { method: 'POST', body: { terminalId } });
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'terminal_busy' ? 'Le TPE affiche déjà un autre encaissement.' : e.message) : 'Erreur');
    }
    await refresh();
  };

  const cancelOnTerminal = async (attemptId: string) => {
    setError(null);
    try {
      await orgApi(`/terminal-payments/${attemptId}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur');
    }
    await refresh();
  };

  const reset = () => {
    setCurrent(null);
    setAmount('');
  };

  /** Abandon en caisse : la demande est annulée pour que le QR affiché ne soit plus payable. */
  const abandon = async () => {
    if (current?.status === 'open') {
      try {
        await orgApi(`/payment-requests/${current.id}/cancel`, { method: 'POST', body: { reason: 'Abandon en caisse' } });
      } catch (e) {
        // Un paiement est en cours chez le prestataire : on ne masque pas la demande.
        setError(e instanceof ApiError ? 'Un paiement est en cours : attendez sa confirmation ou son échec.' : 'Erreur');
        return;
      }
    }
    reset();
  };

  if (current)
    return (
      <div className="vp-stack" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <div className="vp-amount">{formatMoney(current.amount)}</div>
        {current.status === 'open' && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/orgs/${orgId}/payment-requests/${current.id}/qr.svg`} alt="QR code à scanner par le client" style={{ width: '100%', maxWidth: 340, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 10 }} />
            <p className="vp-muted">Le client scanne ce QR code avec son téléphone pour payer.</p>
            <Alert kind="info">En attente de la confirmation du prestataire…</Alert>
            {(() => {
              const onTerminal = current.attempts.find((a) => a.terminalId && ['created', 'pending', 'requires_action', 'processing'].includes(a.status));
              const t = terminals.find((x) => x.id === (onTerminal?.terminalId ?? terminalId));
              if (onTerminal)
                return (
                  <div className="vp-card vp-stack" style={{ gap: 8 }}>
                    <strong>Montant envoyé au TPE « {t?.label ?? 'terminal'} »</strong>
                    <span className="vp-muted vp-small">{onTerminal.status === 'processing' ? 'Autorisation en cours…' : 'Le client présente ou insère sa carte sur le terminal.'}</span>
                    {t?.simulatorUrl && (
                      <a href={t.simulatorUrl} target="_blank" rel="noreferrer" className="vp-small">
                        Ouvrir le TPE simulé (sandbox)
                      </a>
                    )}
                    {onTerminal.status !== 'processing' && (
                      <Button variant="ghost" onClick={() => cancelOnTerminal(onTerminal.id)}>
                        Annuler sur le TPE
                      </Button>
                    )}
                  </div>
                );
              if (!terminals.length) return null;
              return (
                <div className="vp-card vp-stack" style={{ gap: 8 }}>
                  <strong>Ou encaisser par carte sur un TPE</strong>
                  {terminals.length > 1 && (
                    <select className="vp-input" aria-label="Terminal" value={terminalId} onChange={(e) => setTerminalId(e.target.value)}>
                      {terminals.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button onClick={sendToTerminal}>Envoyer au TPE{terminals.length === 1 ? ` « ${terminals[0]?.label} »` : ''}</Button>
                </div>
              );
            })()}
            {error && <Alert kind="danger">{error}</Alert>}
            <Button variant="ghost" onClick={abandon}>
              Abandonner
            </Button>
          </>
        )}
        {current.status === 'paid' && (
          <>
            <Alert kind="success">
              <strong>Paiement confirmé</strong> — référence {current.reference}
            </Alert>
            <Button variant="accent" onClick={reset}>
              Nouvel encaissement
            </Button>
          </>
        )}
        {(current.status === 'expired' || current.status === 'cancelled') && (
          <>
            <Alert kind="warning">Demande {current.status === 'expired' ? 'expirée' : 'annulée'}.</Alert>
            <Button onClick={reset}>Recommencer</Button>
          </>
        )}
      </div>
    );

  return (
    <div className="vp-stack" style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>Caisse</h1>
      {pos.length > 1 && (
        <select className="vp-input" value={posId} onChange={(e) => setPosId(e.target.value)} aria-label="Point de vente">
          {pos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <div className="vp-card" style={{ textAlign: 'end' }}>
        <div className="vp-muted vp-small">Montant à encaisser</div>
        <div className="vp-amount" aria-live="polite">
          {amount || '0'} <span style={{ fontSize: 20 }}>MAD</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {KEYS.map((k) => (
          <button key={k} className="vp-btn vp-btn-ghost" style={{ minHeight: 64, fontSize: 22 }} onClick={() => press(k)} aria-label={k === '⌫' ? 'Effacer' : k}>
            {k}
          </button>
        ))}
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      <Button variant="accent" block disabled={!amount || amount === '0' || amount.endsWith(',')} onClick={charge} style={{ minHeight: 56, fontSize: 18 }}>
        Générer le QR d’encaissement
      </Button>
    </div>
  );
}
