import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { TEST_ENV } from './env';

/** Configuration staging valide (réglages de production, prestataire simulé, e-mails capturés). */
const STAGING = {
  ...TEST_ENV,
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  COOKIE_SECURE: 'true',
  ALLOW_PRIVATE_WEBHOOK_URLS: 'false',
  MOCK_PSP_ENABLED: 'true',
  PAYMENTS_LIVE_ENABLED: 'false',
  PUBLIC_API_URL: 'https://api.staging.example',
  PAY_BASE_URL: 'https://pay.staging.example',
  BUSINESS_APP_URL: 'https://business.staging.example',
  ALLOWED_ORIGINS: 'https://pay.staging.example,https://business.staging.example,https://admin.staging.example',
  TRUST_PROXY: '172.29.10.10',
  EMAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtp://mailpit:1025',
};
const load = (env: Record<string, string | undefined>) => loadConfig(env as NodeJS.ProcessEnv);

describe('environnements d’exploitation (APP_ENV)', () => {
  it('staging valide : réglages de production avec le prestataire simulé seul', () => {
    const c = load(STAGING);
    expect(c.appEnv).toBe('staging');
    expect(c.MOCK_PSP_ENABLED).toBe(true);
    expect(c.PAYMENTS_LIVE_ENABLED).toBe(false);
  });

  it('staging : paiements réels interdits sans exception, même avec une référence juridique', () => {
    expect(() => load({ ...STAGING, PAYMENTS_LIVE_ENABLED: 'true', LEGAL_SIGNOFF_REF: 'PV-2026-001' })).toThrow(/Live payments are forbidden in staging/);
    expect(() => load({ ...STAGING, LEGAL_SIGNOFF_REF: 'PV-2026-001' })).toThrow(/LEGAL_SIGNOFF_REF must not be set in staging/);
  });

  it('staging : aucun e-mail réel (capture Mailpit uniquement)', () => {
    expect(() => load({ ...STAGING, SMTP_URL: 'smtp://smtp.gmail.com:587' })).toThrow(/Mailpit/);
    // nodemailer lit aussi les paramètres : service= ou proxy= enverraient de vrais e-mails
    for (const u of ['smtp://mailpit:1025?service=gmail', 'smtp://mailpit:1025?proxy=http://evil.example:8080', 'smtp://user:pw@mailpit:1025']) {
      expect(() => load({ ...STAGING, SMTP_URL: u }), u).toThrow(/exactly smtp:\/\/mailpit:1025/);
    }
    expect(load({ ...STAGING, EMAIL_TRANSPORT: 'log', SMTP_URL: undefined }).EMAIL_TRANSPORT).toBe('log');
  });

  it('staging : HTTPS, cookies sécurisés, proxy explicite, pas de webhook vers le réseau privé', () => {
    expect(() => load({ ...STAGING, PUBLIC_API_URL: 'http://api.staging.example' })).toThrow(/PUBLIC_API_URL must use HTTPS/);
    expect(() => load({ ...STAGING, ALLOWED_ORIGINS: 'https://ok.example,http://bad.example' })).toThrow(/ALLOWED_ORIGINS must use HTTPS/);
    expect(() => load({ ...STAGING, COOKIE_SECURE: 'false' })).toThrow(/Secure cookies/);
    for (const tp of ['true', 'TRUE', 'uniquelocal', 'loopback', 'linklocal', '1', '0.0.0.0/0', '::/0', '10.0.0.0/4', '999.1.1.1']) {
      expect(() => load({ ...STAGING, TRUST_PROXY: tp }), tp).toThrow(/TRUST_PROXY/);
    }
    expect(load({ ...STAGING, TRUST_PROXY: '172.30.10.10, 172.30.10.0/24,fd00::1' }).TRUST_PROXY).toContain('172.30.10.10');
    expect(() => load({ ...STAGING, ALLOW_PRIVATE_WEBHOOK_URLS: 'true' })).toThrow(/SSRF/);
    expect(() => load({ ...STAGING, NODE_ENV: 'test' })).toThrow(/NODE_ENV=test/);
  });

  it('production : prestataire simulé interdit ; NODE_ENV=production sans APP_ENV = production (le plus strict)', () => {
    expect(() => load({ ...STAGING, APP_ENV: 'production' })).toThrow(/Mock PSP is forbidden/);
    const implicit = { ...STAGING, APP_ENV: undefined };
    expect(() => load(implicit)).toThrow(/Mock PSP is forbidden/);
    expect(load({ ...implicit, MOCK_PSP_ENABLED: 'false' }).appEnv).toBe('production');
  });

  it('APP_ENV=local refusé avec NODE_ENV=production', () => {
    expect(() => load({ ...STAGING, APP_ENV: 'local', MOCK_PSP_ENABLED: 'false' })).toThrow(/APP_ENV=local is not allowed/);
  });

  it('local : comportement de développement inchangé', () => {
    expect(load(TEST_ENV).appEnv).toBe('local');
  });
});
