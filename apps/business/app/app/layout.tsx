'use client';

import { useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, api, AppShell, Icon, LinkButton, ROLE_LABELS_FR, ToastProvider, type NavGroup } from '@vitpay/ui';
import { LangSwitch, useT, type MsgKey } from '../i18n';
import { OrgProvider, useOrg } from './org-context';

function nav(role: string, t: (k: MsgKey) => string): NavGroup[] {
  const groups: NavGroup[] = [
    {
      items: [
        { href: '/app', label: t('nav.dashboard'), icon: 'home', exact: true },
        { href: '/app/requests', label: t('nav.requests'), icon: 'list' },
        { href: '/app/links', label: t('nav.links'), icon: 'link' },
        { href: '/app/pos', label: t('nav.pos'), icon: 'qr' },
        { href: '/app/notifications', label: t('nav.notifications'), icon: 'bell' },
      ],
    },
  ];
  if (role === 'owner' || role === 'admin')
    groups.push({
      label: t('nav.config'),
      items: [
        { href: '/app/settings', label: t('nav.settings'), icon: 'settings' },
        { href: '/app/developers', label: t('nav.developers'), icon: 'code' },
      ],
    });
  else groups[0]!.items.push({ href: '/app/settings', label: t('nav.settings'), icon: 'settings' });
  return groups;
}

function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useT();
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
      {t('banner.verify', { email })}{' '}
      {state === 'sent' ? (
        <span>{t('banner.sent')}</span>
      ) : state === 'error' ? (
        <span>{t('banner.sendFailed')}</span>
      ) : (
        <button type="button" className="vp-link-btn" onClick={resend}>
          {t('banner.resend')}
        </button>
      )}
    </Alert>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, org, orgId, setOrgId } = useOrg();
  const { t, tr } = useT();
  const logout = async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
  };
  const canCreate = org.role !== 'viewer' && org.status === 'active';
  return (
    <AppShell
      pathname={pathname}
      nav={nav(org.role, t)}
      home="/app"
      cta={
        canCreate ? (
          <LinkButton href="/app/requests/new" icon="plus">
            {t('nav.new')}
          </LinkButton>
        ) : undefined
      }
      footer={
        <>
          <div className="vp-who">
            <strong>{org.displayName}</strong>
            {me.user.fullName} · {tr('role', org.role, ROLE_LABELS_FR[org.role] ?? org.role)}
            {me.organizations.length > 1 && (
              <select aria-label={t('nav.switchOrg')} className="vp-input" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            )}
            <div style={{ marginTop: 10 }}>
              <LangSwitch dark />
            </div>
          </div>
          <button type="button" className="vp-nav-link" onClick={logout}>
            <Icon name="logout" />
            {t('nav.logout')}
          </button>
        </>
      }
    >
      <div className="vp-stack-lg">
        {(!me.user.emailVerified || org.status !== 'active') && (
          <div className="vp-stack">
            {!me.user.emailVerified && <VerifyEmailBanner email={me.user.email} />}
            {org.status !== 'active' && <Alert kind="danger">{t('banner.suspended')}</Alert>}
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
