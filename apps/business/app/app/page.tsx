'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, formatDate, formatMoney, Icon, LinkButton, MoneyView, PageHeader, Skeleton, Stat, StatusBadge, TestBadge } from '@vitpay/ui';
import { useOrg } from './org-context';
import { PaymentRequest, STATUS_LABELS } from './types';

interface Dashboard {
  last30Days: { status: string; count: number; total: MoneyView }[];
  dailyReceived: { day: string; count: number; total: MoneyView }[];
}

/** Somme de montants d'une même devise (chaînes décimales exactes : calcul en unités mineures). */
function sum(list: { total: MoneyView }[]): string {
  const byCur = new Map<string, bigint>();
  for (const x of list) byCur.set(x.total.currency, (byCur.get(x.total.currency) ?? 0n) + BigInt(x.total.minor));
  if (!byCur.size) return formatMoney({ minor: '0', value: '0.00', currency: 'MAD' });
  return [...byCur]
    .map(([currency, minor]) => {
      const neg = minor < 0n;
      const abs = neg ? -minor : minor;
      const value = `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
      return formatMoney({ minor: String(minor), value, currency });
    })
    .join(' · ');
}

function Checklist({ steps }: { steps: { title: string; text: string; done: boolean; href: string; action: string }[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card
      title="Prêt à encaisser"
      actions={
        <span className="vp-muted vp-small vp-num">
          {done} sur {steps.length} étapes
        </span>
      }
    >
      <div className="vp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Avancement de l’activation">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="vp-steps" style={{ marginTop: 8 }}>
        {steps.map((s, i) => (
          <li key={s.title} className="vp-step" data-done={s.done} data-next={i === next}>
            <span className="vp-step-mark" aria-hidden="true">
              {s.done ? <Icon name="check" /> : i + 1}
            </span>
            <div className="vp-step-body">
              <div className="vp-step-title">
                {s.title}
                {s.done && <span className="vp-sr"> (fait)</span>}
              </div>
              {!s.done && <div className="vp-muted vp-small">{s.text}</div>}
            </div>
            {!s.done && (
              <LinkButton href={s.href} variant={i === next ? 'primary' : 'ghost'} size="sm">
                {s.action}
              </LinkButton>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function DailyChart({ days }: { days: Dashboard['dailyReceived'] }) {
  // 30 jours complets (les jours sans encaissement comptent aussi) ; une devise principale : MAD.
  const series = useMemo(() => {
    const map = new Map(days.filter((d) => d.total.currency === 'MAD').map((d) => [d.day, d]));
    const out: { day: string; minor: number; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const x = map.get(key);
      out.push({ day: key, minor: x ? Number(x.total.minor) : 0, label: x ? formatMoney(x.total) : '0 MAD', count: x?.count ?? 0 });
    }
    return out;
  }, [days]);
  const max = Math.max(1, ...series.map((s) => s.minor));
  const fmt = (iso: string) => new Intl.DateTimeFormat('fr-MA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
  return (
    <>
      <div className="vp-bars" role="img" aria-label="Encaissements confirmés par jour sur 30 jours">
        {series.map((s) => (
          <div key={s.day} className="vp-bar" title={`${fmt(s.day)} : ${s.label} (${s.count} paiement${s.count > 1 ? 's' : ''})`}>
            <span style={{ height: `${(s.minor / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="vp-bars-axis">
        <span>{fmt(series[0]!.day)}</span>
        <span>{fmt(series[15]!.day)}</span>
        <span>Aujourd’hui</span>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { orgApi, org, me } = useOrg();
  const [d, setD] = useState<Dashboard | null>(null);
  const [providers, setProviders] = useState<number | null>(null);
  const [recent, setRecent] = useState<PaymentRequest[] | null>(null);

  useEffect(() => {
    orgApi<Dashboard>('/dashboard').then(setD).catch(() => setD({ last30Days: [], dailyReceived: [] }));
    orgApi<{ connected: { status: string }[] }>('/providers')
      .then((p) => setProviders(p.connected.filter((c) => c.status === 'active').length))
      .catch(() => setProviders(null));
    orgApi<{ data: PaymentRequest[] }>('/payment-requests')
      .then((r) => setRecent(r.data.slice(0, 6)))
      .catch(() => setRecent([]));
  }, [orgApi]);

  const by = (s: string) => d?.last30Days.filter((x) => x.status === s) ?? [];
  const count = (s: string) => by(s).reduce((n, p) => n + p.count, 0);
  const isAdmin = org.role === 'owner' || org.role === 'admin';
  const anyRequest = (recent?.length ?? 0) > 0;

  const steps = [
    { title: 'Confirmer votre adresse e-mail', text: 'Le lien vous a été envoyé à l’inscription.', done: me.user.emailVerified, href: '/app', action: 'Voir le bandeau' },
    { title: 'Connecter votre prestataire de paiement', text: 'Les fonds vont directement de votre client à votre compte chez le prestataire.', done: (providers ?? 0) > 0, href: '/app/settings?tab=providers', action: 'Connecter' },
    { title: 'Envoyer votre dossier entreprise (KYB)', text: 'Raison sociale, ICE, RC et justificatifs : requis pour passer en paiements réels.', done: org.kybStatus === 'submitted' || org.kybStatus === 'verified', href: '/app/settings?tab=company', action: 'Compléter' },
    { title: 'Créer votre première demande de paiement', text: 'Un lien et un QR code à envoyer par WhatsApp, SMS ou e-mail.', done: anyRequest, href: '/app/requests/new', action: 'Créer' },
  ];
  const showChecklist = isAdmin && providers !== null && recent !== null && steps.some((s) => !s.done);

  return (
    <div className="vp-stack-lg">
      <PageHeader title={`Bonjour, ${me.user.fullName.split(' ')[0]}`} subtitle={`${org.displayName} — activité des 30 derniers jours`} />

      {showChecklist && <Checklist steps={steps} />}

      <div className="vp-grid">
        {d ? (
          <>
            <Stat icon="wallet" label="Encaissé (30 jours)" value={sum(by('paid'))} hint={`${count('paid')} paiement${count('paid') > 1 ? 's' : ''} confirmé${count('paid') > 1 ? 's' : ''}`} href="/app/requests?status=paid" />
            <Stat icon="clock" label="En attente de paiement" value={count('open')} hint={by('open').length ? sum(by('open')) : 'Aucune demande ouverte'} href="/app/requests?status=open" />
            <Stat icon="ban" label="Expirées ou annulées" value={count('expired') + count('cancelled')} hint="Sur 30 jours" />
          </>
        ) : (
          <>
            <Skeleton height={118} />
            <Skeleton height={118} />
            <Skeleton height={118} />
          </>
        )}
      </div>

      <Card title="Encaissements confirmés par jour">
        {d ? (
          d.dailyReceived.length ? (
            <DailyChart days={d.dailyReceived} />
          ) : (
            <EmptyState icon="activity" title="Aucun encaissement sur 30 jours">
              Les paiements confirmés par votre prestataire apparaîtront ici, jour par jour.
            </EmptyState>
          )
        ) : (
          <Skeleton height={150} />
        )}
      </Card>

      <Card
        title="Dernières demandes"
        actions={
          anyRequest ? (
            <a href="/app/requests" className="vp-small">
              Tout voir
            </a>
          ) : undefined
        }
      >
        {!recent ? (
          <Skeleton height={120} />
        ) : !recent.length ? (
          <EmptyState
            icon="send"
            title="Aucune demande pour l’instant"
            action={
              org.role !== 'viewer' ? (
                <LinkButton href="/app/requests/new" icon="plus">
                  Créer une demande
                </LinkButton>
              ) : undefined
            }
          >
            Créez un lien de paiement, envoyez-le à votre client : il paie par carte depuis son téléphone.
          </EmptyState>
        ) : (
          <div className="vp-list">
            {recent.map((r) => (
              <a key={r.id} href={`/app/requests/${r.id}`} className="vp-row vp-between" style={{ color: 'inherit', textDecoration: 'none', rowGap: 6 }}>
                <span style={{ minWidth: 0, flex: '1 1 220px' }}>
                  <span style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description ?? r.customerName ?? r.reference}</span>
                  <span className="vp-muted vp-small">
                    {formatDate(r.createdAt)} {r.mode === 'sandbox' && <TestBadge />}
                  </span>
                </span>
                <span className="vp-row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                  <strong className="vp-num">{formatMoney(r.amount)}</strong>
                  <StatusBadge status={r.status} label={STATUS_LABELS[r.status]} />
                </span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <p className="vp-muted vp-small" style={{ margin: 0 }}>
        Les montants reflètent les confirmations reçues de votre prestataire de paiement. Les fonds sont détenus et reversés par votre prestataire, pas par VITPAY.
      </p>
    </div>
  );
}
