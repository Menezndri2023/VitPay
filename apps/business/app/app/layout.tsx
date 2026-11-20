'use client';

import { useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, api, AppShell, Icon, LinkButton, ROLE_LABELS_FR, ToastProvider, type NavGroup } from '@vitpay/ui';
import { OrgProvider, useOrg } from './org-context';

function nav(role: string): NavGroup[] {
  const groups: NavGroup[] = [
    {
      items: [
        { href: '/app', label: 'Tableau de bord', icon: 'home', exact: true },
        { href: '/app/requests', label: 'Demandes', icon: 'list' },
        { href: '/app/pos', label: 'Caisse', icon: 'qr' },
        { href: '/app/notifications', label: 'Notifications', icon: 'bell' },
      ],
    },
  ];
  if (role === 'owner' || role === 'admin')
    groups.push({
      label: 'Configuration',
      items: [
        { href: '/app/settings', label: 'Paramètres', icon: 'settings' },
        { href: '/app/developers', label: 'Développeurs', icon: 'code' },
      ],
    });
  else groups[0]!.items.push({ href: '/app/settings', label: 'Paramètres', icon: 'settings' });
  return groups;
}

function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const resend = async () => {
    try {
      await api('/v1/auth/email/resend', { method: 'POST' });
      setState('sent');
    } catch {
      setState('error');
    }
  };
  return (
    <Alert kind="warning">
      Confirmez votre adresse <strong>{email}</strong> avec le lien reçu par e-mail. D’ici là, la connexion d’un prestataire, l’équipe, les intégrations et le dossier KYB restent bloqués.{' '}
      {state === 'sent' ? (
        <span>Nouveau lien envoyé.</span>
      ) : state === 'error' ? (
        <span>Envoi impossible pour l’instant, réessayez plus tard.</span>
      ) : (
        <button type="button" className="vp-link-btn" onClick={resend}>
          Renvoyer le lien
        </button>
      )}
    </Alert>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, org, orgId, setOrgId } = useOrg();
  const logout = async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  };
  const canCreate = org.role !== 'viewer' && org.status === 'active';
  return (
    <AppShell
      pathname={pathname}
      nav={nav(org.role)}
      home="/app"
      cta={
        canCreate ? (
          <LinkButton href="/app/requests/new" icon="plus">
            Nouvelle demande
          </LinkButton>
        ) : undefined
      }
      footer={
        <>
          <div className="vp-who">
            <strong>{org.displayName}</strong>
            {me.user.fullName} · {ROLE_LABELS_FR[org.role] ?? org.role}
            {me.organizations.length > 1 && (
              <select aria-label="Changer d’organisation" className="vp-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button type="button" className="vp-nav-link" onClick={logout}>
            <Icon name="logout" />
            Se déconnecter
          </button>
        </>
      }
    >
      <div className="vp-stack-lg">
        {(!me.user.emailVerified || org.status !== 'active') && (
          <div className="vp-stack">
            {!me.user.emailVerified && <VerifyEmailBanner email={me.user.email} />}
            {org.status !== 'active' && <Alert kind="danger">Votre organisation est suspendue. Les nouvelles opérations sont bloquées. Contactez le support VITPAY.</Alert>}
          </div>
        )}
        {children}
      </div>
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <OrgProvider>
        <Shell>{children}</Shell>
      </OrgProvider>
    </ToastProvider>
  );
}
