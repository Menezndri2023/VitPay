import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <a className="vp-logo" href={href} aria-label="VITPAY">
      VIT<b>PAY</b>
    </a>
  );
}

export function Card({ children, title, actions }: { children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="vp-card">
      {(title || actions) && (
        <div className="vp-row vp-between" style={{ marginBottom: 12 }}>
          {title ? <h2 style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'accent' | 'ghost' | 'danger';
export function Button({ variant = 'primary', block, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  const v = variant === 'primary' ? '' : `vp-btn-${variant}`;
  return <button className={`vp-btn ${v} ${block ? 'vp-btn-block' : ''} ${className}`} {...rest} />;
}

export function Field({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = rest.id ?? rest.name;
  return (
    <div className="vp-field">
      <label className="vp-label" htmlFor={id}>
        {label}
      </label>
      <input className="vp-input" id={id} aria-invalid={!!error} {...rest} />
      {hint && !error && <span className="vp-muted vp-small">{hint}</span>}
      {error && <span className="vp-error">{error}</span>}
    </div>
  );
}

export function Select({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = rest.id ?? rest.name;
  return (
    <div className="vp-field">
      <label className="vp-label" htmlFor={id}>
        {label}
      </label>
      <select className="vp-input" id={id} {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return (
    <div className={`vp-alert vp-alert-${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

const STATUS_KIND: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  paid: 'success',
  succeeded: 'success',
  settled: 'success',
  verified: 'success',
  active: 'success',
  matched: 'success',
  processed: 'success',
  resolved: 'success',
  approved: 'success',
  completed: 'success',
  won: 'success',
  open: 'info',
  pending: 'warning',
  created: 'warning',
  processing: 'warning',
  requires_action: 'warning',
  submitted: 'warning',
  requested: 'warning',
  received: 'warning',
  partially_refunded: 'warning',
  completed_with_mismatches: 'warning',
  acknowledged: 'warning',
  failed: 'danger',
  rejected: 'danger',
  suspended: 'danger',
  disputed: 'danger',
  opened: 'danger',
  lost: 'danger',
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  refunded: 'neutral',
  unsettled: 'neutral',
  not_started: 'neutral',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`vp-badge vp-badge-${STATUS_KIND[status] ?? 'neutral'}`}>{label ?? status.replaceAll('_', ' ')}</span>;
}

export function SandboxBanner({ text = 'ENVIRONNEMENT DE TEST — AUCUN PAIEMENT RÉEL' }: { text?: string }) {
  return <div className="vp-sandbox-banner">{text}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="vp-card">
      <div className="vp-muted vp-small">{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div className="vp-muted vp-small">{hint}</div>}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="vp-muted vp-small" style={{ textAlign: 'center', padding: '24px 16px' }}>
      VITPAY — One platform. Every payment. · A VIT GLOBAL TECHNOLOGIES PRODUCT
    </footer>
  );
}
