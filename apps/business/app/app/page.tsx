'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, formatDate, formatMoney, Icon, LinkButton, MoneyView, PageHeader, Skeleton, Stat, StatusBadge, TestBadge } from '@vitpay/ui';
import { useOrg } from './org-context';
import { useT } from '../i18n';
import { PaymentRequest, STATUS_LABELS } from './types';

interface Dashboard {
  last30Days: { status: string; count: number; total: MoneyView }[];
  dailyReceived: { day: string; count: number; total: MoneyView }[];
}

/** Somme de montants d'une même devise (chaînes décimales exactes : calcul en unités mineures). */
function sum(list: { total: MoneyView }[], tag = 'fr-MA'): string {
  const byCur = new Map<string, bigint>();
  for (const x of list) byCur.set(x.total.currency, (byCur.get(x.total.currency) ?? 0n) + BigInt(x.total.minor));
  if (!byCur.size) return formatMoney({ minor: '0', value: '0.00', currency: 'MAD' }, tag);
  return [...byCur]
    .map(([currency, minor]) => {
      const neg = minor < 0n;
      const abs = neg ? -minor : minor;
      const value = `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
      return formatMoney({ minor: String(minor), value, currency }, tag);
    })
    .join(' · ');
}

function Checklist({ steps }: { steps: { title: string; text: string; done: boolean; href: string; action: string }[] }) {
  const { t } = useT();
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card
      title={t('dash.ready')}
      actions={
        <span className="vp-muted vp-small">
          {t('dash.steps', { done, total: steps.length })}
        </span>
      }
    >
      <div className="vp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={t('dash.ready')}>
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
  const { t, tag } = useT();
  // 30 jours complets (les jours sans encaissement comptent aussi) ; une devise principale : MAD.
  const series = useMemo(() => {
    const map = new Map(days.filter((d) => d.total.currency === 'MAD').map((d) => [d.day, d]));
    const out: { day: string; minor: number; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const x = map.get(key);
      out.push({ day: key, minor: x ? Number(x.total.minor) : 0, label: x ? formatMoney(x.total, tag) : '0 MAD', count: x?.count ?? 0 });
    }
    return out;
  }, [days, tag]);
  const max = Math.max(1, ...series.map((s) => s.minor));
  const fmt = (iso: string) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
  return (
    <>
      <div className="vp-bars" role="img" aria-label={t('dash.chart')}>
        {series.map((s) => (
          <div key={s.day} className="vp-bar" title={`${fmt(s.day)} : ${s.label} (${s.count})`}>
            <span style={{ height: `${(s.minor / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="vp-bars-axis">
        <span>{fmt(series[0]!.day)}</span>
        <span>{fmt(series[15]!.day)}</span>
        <span>{t('dash.today')}</span>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { orgApi, org, me } = useOrg();
  const { t, tr, tag } = useT();
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
    { title: t('dash.step.email'), text: t('dash.step.email.text'), done: me.user.emailVerified, href: '/app', action: t('dash.step.email.action') },
    { title: t('dash.step.provider'), text: t('dash.step.provider.text'), done: (providers ?? 0) > 0, href: '/app/settings?tab=providers', action: t('dash.step.provider.action') },
    { title: t('dash.step.kyb'), text: t('dash.step.kyb.text'), done: org.kybStatus === 'submitted' || org.kybStatus === 'verified', href: '/app/settings?tab=company', action: t('dash.step.kyb.action') },
    { title: t('dash.step.first'), text: t('dash.step.first.text'), done: anyRequest, href: '/app/requests/new', action: t('dash.step.first.action') },
  ];
  const showChecklist = isAdmin && providers !== null && recent !== null && steps.some((s) => !s.done);

  return (
    <div className="vp-stack-lg">
      <PageHeader title={t('dash.hello', { name: me.user.fullName.split(' ')[0] ?? '' })} subtitle={t('dash.subtitle', { org: org.displayName })} />

      {showChecklist && <Checklist steps={steps} />}

      <div className="vp-grid">
        {d ? (
          <>
            <Stat icon="wallet" label={t('dash.collected')} value={sum(by('paid'), tag)} hint={t('dash.confirmed', { n: count('paid') })} href="/app/requests?status=paid" />
            <Stat icon="clock" label={t('dash.open')} value={count('open')} hint={by('open').length ? sum(by('open'), tag) : t('dash.noOpen')} href="/app/requests?status=open" />
            <Stat icon="ban" label={t('dash.closed')} value={count('expired') + count('cancelled')} hint={t('dash.30days')} />
          </>
        ) : (
          <>
            <Skeleton height={118} />
            <Skeleton height={118} />
            <Skeleton height={118} />
          </>
        )}
      </div>

      <Card title={t('dash.chart')}>
        {d ? (
          d.dailyReceived.length ? (
            <DailyChart days={d.dailyReceived} />
          ) : (
            <EmptyState icon="activity" title={t('dash.chart.empty')}>
              {t('dash.chart.emptyText')}
            </EmptyState>
          )
        ) : (
          <Skeleton height={150} />
        )}
      </Card>

      <Card
        title={t('dash.recent')}
        actions={
          anyRequest ? (
            <a href="/app/requests" className="vp-small">
              {t('common.seeAll')}
            </a>
          ) : undefined
        }
      >
        {!recent ? (
          <Skeleton height={120} />
        ) : !recent.length ? (
          <EmptyState
            icon="send"
            title={t('dash.recent.empty')}
            action={
              org.role !== 'viewer' ? (
                <LinkButton href="/app/requests/new" icon="plus">
                  {t('dash.create')}
                </LinkButton>
              ) : undefined
            }
          >
            {t('dash.recent.emptyText')}
          </EmptyState>
        ) : (
          <div className="vp-list">
            {recent.map((r) => (
              <a key={r.id} href={`/app/requests/${r.id}`} className="vp-row vp-between" style={{ color: 'inherit', textDecoration: 'none', rowGap: 6 }}>
                <span style={{ minWidth: 0, flex: '1 1 220px' }}>
                  <span style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description ?? r.customerName ?? r.reference}</span>
                  <span className="vp-muted vp-small">
                    {formatDate(r.createdAt, tag)} {r.mode === 'sandbox' && <TestBadge label={t('common.test')} />}
                  </span>
                </span>
                <span className="vp-row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                  <strong className="vp-num">{formatMoney(r.amount, tag)}</strong>
                  <StatusBadge status={r.status} label={tr('status', r.status, STATUS_LABELS[r.status] ?? r.status)} />
                </span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <p className="vp-muted vp-small" style={{ margin: 0 }}>
        {t('common.disclaimer')}
      </p>
    </div>
  );
}
