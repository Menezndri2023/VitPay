'use client';

import { useEffect, useState } from 'react';
import { Alert, ApiError, Button, errorText, formatMoney, Icon, newIdempotencyKey, PageHeader, TestBadge, usePaidChime } from '@vitpay/ui';
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
  const [busy, setBusy] = useState(false);
  // Une clé par encaissement : un double appui sur « Générer » ne crée qu'une seule demande.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [sound, setSound] = useState(true);
  useEffect(() => {
    try {
      setSound(localStorage.getItem('vp_pos_sound') !== 'off');
    } catch {
      /* stockage indisponible */
    }
  }, []);
  const toggleSound = () => {
    setSound((v) => {
      try {
        localStorage.setItem('vp_pos_sound', v ? 'off' : 'on');
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  useEffect(() => {
    orgApi<{ id: string; name: string }[]>('/points-of-sale')
      .then((p) => {
        setPos(p);
        setPosId(p[0]?.id ?? '');
      })
      .catch(() => setPos([]));
    orgApi<Terminal[]>('/terminals')
      .then((t) => {
        const active = t.filter((x) => x.status === 'active');
        setTerminals(active);
        setTerminalId(active[0]?.id ?? '');
      })
      .catch(() => setTerminals([]));
  }, [orgApi]);

  usePaidChime(current?.status, sound);

  useEffect(() => {
    if (!current || current.status !== 'open') return;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
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

  // Saisie au clavier physique (caisse sur ordinateur) : chiffres, virgule ou point, retour arrière, Entrée.
  useEffect(() => {
    if (current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === ',' || e.key === '.') press(',');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter' && amount && amount !== '0' && !amount.endsWith(',')) void charge();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const charge = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const created = await orgApi<{ id: string }>('/payment-requests', {
        method: 'POST',
        idempotencyKey: idemKey,
        body: { amount: amount.replace(',', '.'), currency: 'MAD', description: 'Paiement en caisse', posId: posId || undefined, expiresInHours: 1 },
      });
      setCurrent(await orgApi<RequestDetail>(`/payment-requests/${created.id}`));
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status < 500) setIdemKey(newIdempotencyKey());
    } finally {
      setBusy(false);
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
      setError(errorText(e));
    }
    await refresh();
  };

  const cancelOnTerminal = async (attemptId: string) => {
    setError(null);
    try {
      await orgApi(`/terminal-payments/${attemptId}/cancel`, { method: 'POST' });
    } catch (e) {
      setError(errorText(e));
    }
    await refresh();
  };

  const reset = () => {
    setCurrent(null);
    setAmount('');
    setIdemKey(newIdempotencyKey());
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
        {current.mode === 'sandbox' && (
          <div>
            <TestBadge label="Mode test" />
          </div>
        )}
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
            <div className="vp-result-icon vp-result-ok" style={{ width: 88, height: 88 }}>
              <Icon name="check" style={{ width: 44, height: 44 }} />
            </div>
            <Alert kind="success">
              <strong>Paiement confirmé</strong> — référence {current.reference}
            </Alert>
            <Button size="lg" icon="plus" onClick={reset}>
              Nouvel encaissement
            </Button>
            <a className="vp-small" href={`/app/requests/${current.id}`}>
              Voir le détail et le reçu
            </a>
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
      <PageHeader title="Caisse" subtitle="Saisissez le montant : le client scanne le QR code ou paie sur le TPE." />
      {pos.length > 1 && (
        <select className="vp-input" value={posId} onChange={(e) => setPosId(e.target.value)} aria-label="Point de vente">
          {pos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <div className="vp-card" style={{ textAlign: 'end', background: 'var(--vp-cedar-900)', color: '#fff', borderColor: 'transparent' }}>
        <div className="vp-small" style={{ color: '#a9c9b8' }}>Montant à encaisser</div>
        <div className="vp-amount" aria-live="polite">
          {amount || '0'} <span style={{ fontSize: 20, color: 'var(--vp-saffron-500)' }}>MAD</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {KEYS.map((k) => (
          <button key={k} type="button" className="vp-btn vp-btn-ghost vp-num" style={{ minHeight: 64, fontSize: 24, fontWeight: 650 }} onClick={() => press(k)} aria-label={k === '⌫' ? 'Effacer' : k}>
            {k === '⌫' ? <Icon name="back" style={{ width: 24, height: 24 }} /> : k}
          </button>
        ))}
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      <Button block size="lg" icon="qr" busy={busy} disabled={!amount || amount === '0' || amount.endsWith(',')} onClick={charge}>
        Générer le QR d’encaissement
      </Button>
      <p className="vp-hint" style={{ textAlign: 'center', margin: 0 }}>
        Astuce : sur ordinateur, tapez le montant au clavier puis Entrée.
      </p>
      <button type="button" className="vp-link-btn vp-small vp-muted" style={{ alignSelf: 'center' }} onClick={toggleSound} aria-pressed={sound}>
        Signal sonore à la confirmation : {sound ? 'activé' : 'désactivé'}
      </button>
    </div>
  );
}
