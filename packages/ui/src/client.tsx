'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Logo } from './components';
import { Icon, type IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Pastille (ex. nombre d'éléments à traiter). */
  count?: number;
  /** Correspondance exacte uniquement (sinon les sous-pages activent aussi l'entrée). */
  exact?: boolean;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/** Entrée active : la plus longue correspondance de préfixe (/app/requests/123 → « Demandes »). */
export function activeHref(pathname: string, groups: NavGroup[]): string | undefined {
  const all = groups.flatMap((g) => g.items);
  return all
    .filter((n) => pathname === n.href || (!n.exact && pathname.startsWith(n.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/**
 * Coque des espaces connectés : barre latérale fixe sur grand écran, tiroir sur mobile
 * (fermé par Échap, par le voile ou après navigation).
 */
export function AppShell({
  pathname,
  nav,
  home,
  logoSuffix,
  cta,
  footer,
  children,
}: {
  pathname: string;
  nav: NavGroup[];
  home: string;
  logoSuffix?: string;
  cta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = activeHref(pathname, nav);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="vp-shell" data-open={open}>
      <div className="vp-topbar">
        <Logo href={home} suffix={logoSuffix} />
        <button className="vp-menu-btn" type="button" aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={open} aria-controls="vp-sidebar" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? 'close' : 'menu'} />
        </button>
      </div>
      <div className="vp-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <nav className="vp-sidebar" id="vp-sidebar" aria-label="Navigation principale">
        <Logo href={home} suffix={logoSuffix} />
        {cta && <div className="vp-cta-nav">{cta}</div>}
        {nav.map((g, i) => (
          <div key={g.label ?? i} role="group" aria-label={g.label}>
            {g.label && <div className="vp-nav-group">{g.label}</div>}
            {g.items.map((n) => (
              <a key={n.href} className="vp-nav-link" href={n.href} aria-current={current === n.href ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
                {!!n.count && <span className="vp-nav-count">{n.count}</span>}
              </a>
            ))}
          </div>
        ))}
        <div style={{ flex: 1, minHeight: 16 }} />
        {footer}
      </nav>
      <main className="vp-main" id="contenu">
        <div className="vp-main-inner">{children}</div>
      </main>
    </div>
  );
}

/* Notifications éphémères (confirmation d'une action). */
type Toast = { id: number; text: string; kind: 'success' | 'danger' };
const ToastCtx = createContext<((text: string, kind?: Toast['kind']) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = ++seq.current;
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="vp-toast-zone" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`vp-toast vp-toast-${t.kind}`}>
            <Icon name={t.kind === 'success' ? 'check_circle' : 'alert'} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Hors fournisseur, les messages sont ignorés (aucune erreur). */
export function useToast(): (text: string, kind?: Toast['kind']) => void {
  return useContext(ToastCtx) ?? (() => undefined);
}

/** Copie dans le presse-papiers, avec repli si l'API n'est pas disponible (HTTP, navigateur ancien). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copier', copiedLabel = 'Copié', variant = 'ghost', size }: { text: string; label?: string; copiedLabel?: string; variant?: 'primary' | 'ghost'; size?: 'sm' }) {
  const [state, setState] = useState<'idle' | 'ok' | 'ko'>('idle');
  return (
    <button
      type="button"
      className={`vp-btn ${variant === 'ghost' ? 'vp-btn-ghost' : ''} ${size ? 'vp-btn-sm' : ''}`}
      onClick={async () => {
        setState((await copyText(text)) ? 'ok' : 'ko');
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      <Icon name={state === 'ok' ? 'check' : 'copy'} />
      {state === 'ok' ? copiedLabel : state === 'ko' ? 'Copie impossible' : label}
    </button>
  );
}

/** Onglets synchronisés avec l'URL (?tab=…) : un onglet se partage et survit au rechargement. */
export function useTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const [tab, setTabState] = useState<T>(fallback);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as T | null;
    if (t && tabs.includes(t)) setTabState(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = (t: T) => {
    setTabState(t);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', t);
    u.searchParams.delete('welcome');
    window.history.replaceState(null, '', u);
  };
  return [tab, setTab];
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; dot?: boolean }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="vp-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`} className="vp-tab" onClick={() => onChange(t.id)}>
          {t.label}
          {t.dot && <span className="vp-dot" aria-label="à compléter" />}
        </button>
      ))}
    </div>
  );
}

/** Valeur différée (recherche à la frappe sans une requête par touche). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
