import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';

export function Logo({ href = '/', suffix }: { href?: string; suffix?: string }) {
  return (
    // dir="ltr" : la marque reste « VITPAY » même dans une page en arabe (RTL).
    <a className="vp-logo" href={href} aria-label={suffix ? `VITPAY ${suffix}` : 'VITPAY'} dir="ltr">
      <span className="vp-logo-mark" aria-hidden="true">V</span>
      <span>
        VIT<b>PAY</b>
      </span>
      {suffix && (
        <span className="vp-small" style={{ fontWeight: 600, opacity: 0.7, letterSpacing: 0 }}>
          {suffix}
        </span>
      )}
    </a>
  );
}

export function Card({ children, title, actions, description, id }: { children: ReactNode; title?: ReactNode; actions?: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <section className="vp-card" id={id}>
      {(title || actions) && (
        <div className="vp-card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {description && <p className="vp-card-desc">{description}</p>}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header>
      {back && (
        <a className="vp-back" href={back.href}>
          <Icon name="back" />
          {back.label}
        </a>
      )}
      <div className="vp-page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="vp-row">{actions}</div>}
      </div>
    </header>
  );
}

type Variant = 'primary' | 'accent' | 'ghost' | 'danger';
export function Button({
  variant = 'primary',
  block,
  size,
  icon,
  busy,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; size?: 'sm' | 'lg'; icon?: IconName; busy?: boolean }) {
  const v = variant === 'primary' ? '' : `vp-btn-${variant}`;
  return (
    <button className={`vp-btn ${v} ${block ? 'vp-btn-block' : ''} ${size ? `vp-btn-${size}` : ''} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="vp-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** Lien présenté comme un bouton (navigation). */
export function LinkButton({ href, variant = 'primary', icon, size, children, ...rest }: { href: string; variant?: Variant; icon?: IconName; size?: 'sm' | 'lg'; children: ReactNode; target?: string; rel?: string; download?: boolean }) {
  const v = variant === 'primary' ? '' : `vp-btn-${variant}`;
  return (
    <a className={`vp-btn ${v} ${size ? `vp-btn-${size}` : ''}`} href={href} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </a>
  );
}

export function Field({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = rest.id ?? rest.name;
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className="vp-field">
      <label className="vp-label" htmlFor={id}>
        {label}
      </label>
      <input className="vp-input" id={id} aria-invalid={!!error} aria-describedby={hintId} {...rest} />
      {hint && !error && (
        <span className="vp-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="vp-error" id={hintId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function TextArea({ label, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode }) {
  const id = rest.id ?? rest.name;
  return (
    <div className="vp-field">
      <label className="vp-label" htmlFor={id}>
        {label}
      </label>
      <textarea className="vp-input" id={id} rows={3} {...rest} />
      {hint && <span className="vp-hint">{hint}</span>}
    </div>
  );
}

export function Select({ label, children, hint, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode }) {
  const id = rest.id ?? rest.name;
  return (
    <div className="vp-field">
      <label className="vp-label" htmlFor={id}>
        {label}
      </label>
      <select className="vp-input" id={id} {...rest}>
        {children}
      </select>
      {hint && <span className="vp-hint">{hint}</span>}
    </div>
  );
}

const ALERT_ICON: Record<'info' | 'warning' | 'danger' | 'success', IconName> = { info: 'info', warning: 'alert', danger: 'alert', success: 'check_circle' };
export function Alert({ kind = 'info', children, icon = true }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; icon?: boolean }) {
  return (
    <div className={`vp-alert vp-alert-${kind}`} role={kind === 'danger' ? 'alert' : 'status'}>
      {icon && <Icon name={ALERT_ICON[kind]} />}
      <div className="vp-alert-body">{children}</div>
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
  delivered: 'success',
  accepted: 'success',
  open: 'info',
  pending: 'warning',
  created: 'warning',
  processing: 'warning',
  requires_action: 'warning',
  submitted: 'warning',
  requested: 'warning',
  received: 'warning',
  issued: 'warning',
  partially_refunded: 'warning',
  completed_with_mismatches: 'warning',
  acknowledged: 'warning',
  investigating: 'warning',
  retrying: 'warning',
  failed: 'danger',
  rejected: 'danger',
  suspended: 'danger',
  disputed: 'danger',
  opened: 'danger',
  lost: 'danger',
  critical: 'danger',
  high: 'danger',
  dead: 'danger',
  medium: 'warning',
  low: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  refunded: 'neutral',
  unsettled: 'neutral',
  not_started: 'neutral',
  disabled: 'neutral',
  revoked: 'neutral',
};

/** Libellés français par défaut : aucun statut technique (« active », « owner »…) n'est affiché brut. */
export const STATUS_LABELS_FR: Record<string, string> = {
  open: 'En attente',
  paid: 'Payée',
  expired: 'Expirée',
  cancelled: 'Annulée',
  partially_refunded: 'Remb. partiel',
  refunded: 'Remboursée',
  disputed: 'Contestée',
  succeeded: 'Confirmé',
  failed: 'Échoué',
  pending: 'En cours',
  processing: 'En traitement',
  requires_action: 'Action requise',
  created: 'Créé',
  active: 'Actif',
  disabled: 'Désactivé',
  revoked: 'Révoquée',
  suspended: 'Suspendue',
  verified: 'Vérifiée',
  submitted: 'En examen',
  rejected: 'Refusée',
  not_started: 'Non commencée',
  accepted: 'Accepté',
  settled: 'Réglé',
  unsettled: 'Non réglé',
  matched: 'Rapproché',
  completed: 'Terminé',
  completed_with_mismatches: 'Écarts à traiter',
  approved: 'Approuvée',
  requested: 'Demandée',
  received: 'Reçu',
  processed: 'Traité',
  delivered: 'Livré',
  retrying: 'Nouvel essai',
  dead: 'Abandonné',
  resolved: 'Résolu',
  acknowledged: 'Pris en charge',
  investigating: 'En analyse',
  critical: 'Critique',
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
  won: 'Gagné',
  lost: 'Perdu',
  opened: 'Ouvert',
  issued: 'À régler',
};

export const ROLE_LABELS_FR: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  cashier: 'Caissier',
  viewer: 'Lecture seule',
  super_admin: 'Super administrateur',
  compliance: 'Conformité',
  finance: 'Finance',
  support: 'Support',
  operations: 'Opérations',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`vp-badge vp-badge-${STATUS_KIND[status] ?? 'neutral'}`}>{label ?? STATUS_LABELS_FR[status] ?? status.replaceAll('_', ' ')}</span>;
}

/** Badge « Test » : objet créé en mode test (prestataire simulé ou clés sandbox). */
export function TestBadge({ label = 'Test' }: { label?: string }) {
  return <span className="vp-badge vp-badge-test vp-badge-plain">{label}</span>;
}

export function SandboxBanner({ text = 'ENVIRONNEMENT DE TEST — AUCUN PAIEMENT RÉEL' }: { text?: string }) {
  return <div className="vp-sandbox-banner">{text}</div>;
}

export function Stat({ label, value, hint, icon, href }: { label: string; value: ReactNode; hint?: ReactNode; icon?: IconName; href?: string }) {
  const body = (
    <div className="vp-stat">
      <div className="vp-stat-label">
        {icon && <Icon name={icon} />}
        {label}
      </div>
      <div className="vp-stat-value">{value}</div>
      {hint && <div className="vp-stat-hint">{hint}</div>}
    </div>
  );
  return href ? (
    <a className="vp-card" href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </a>
  ) : (
    <div className="vp-card">{body}</div>
  );
}

export function EmptyState({ icon = 'list', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="vp-empty">
      <div className="vp-empty-icon">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: CSSProperties }) {
  return <div className="vp-skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

/** Chargement d'une page : silhouette plutôt qu'un texte « Chargement… » isolé. */
export function PageSkeleton({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="vp-stack-lg" role="status" aria-live="polite">
      <span className="vp-sr">{label}</span>
      <Skeleton height={30} width="40%" />
      <div className="vp-grid">
        <Skeleton height={104} />
        <Skeleton height={104} />
        <Skeleton height={104} />
      </div>
      <Skeleton height={220} />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="vp-muted vp-small" style={{ textAlign: 'center', padding: '24px 16px' }}>
      VITPAY · un produit VIT GLOBAL TECHNOLOGIES
    </footer>
  );
}

/** Initiales d'un nom (avatar du commerçant). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? ''))).toUpperCase() || '·';
}

/**
 * Bandeau d'environnement (P4) : affiché en staging sur toutes les pages, fixé au build
 * (NEXT_PUBLIC_VITPAY_ENV). Aucune transaction réelle n'est possible dans cet environnement.
 */
// Remplacé à la compilation par Next (variable NEXT_PUBLIC_*) ; déclaration minimale pour le typage.
declare const process: { env: { NEXT_PUBLIC_VITPAY_ENV?: string } };

export function EnvBanner() {
  if (process.env.NEXT_PUBLIC_VITPAY_ENV !== 'staging') return null;
  return (
    <div role="note" style={{ background: '#b42318', color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}>
      VITPAY STAGING — environnement de test : paiements simulés, aucune transaction réelle, données fictives uniquement
    </div>
  );
}
