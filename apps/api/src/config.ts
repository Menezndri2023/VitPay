import { Keyring } from './common/crypto';
import { z } from 'zod';

/** Clé de 32 octets en base64 canonique (44 caractères, un « = » final), sans tolérance. */
function isStrictKey(k: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(k) && Buffer.from(k, 'base64').toString('base64') === k;
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Environnement d'exploitation (distinct du mode d'exécution Node) :
     * - local : poste de développement ;
     * - staging : accessible publiquement, réglages de production, prestataire simulé UNIQUEMENT,
     *   paiements réels interdits sans exception, e-mails capturés (Mailpit) ;
     * - production : prestataire simulé interdit.
     * Absent : « production » si NODE_ENV=production (le plus strict), sinon « local ».
     */
    APP_ENV: z.enum(['local', 'staging', 'production']).optional(),
    PORT: z.coerce.number().int().positive().default(4710),
    DATABASE_URL: z.string().url(),
    DATABASE_OWNER_URL: z.string().url().optional(),
    /** Rôle système (BYPASSRLS) : uniquement pour les chemins transverses justifiés. */
    DATABASE_SYSTEM_URL: z.string().url(),
    /** Clé AES-256 (32 octets, base64) pour chiffrer les identifiants prestataires et secrets MFA. */
    APP_ENCRYPTION_KEY: z.string().refine(isStrictKey, 'APP_ENCRYPTION_KEY must be exactly 32 bytes of canonical base64 (openssl rand -base64 32)'),
    /** Rotation : anciennes clés (base64, séparées par des virgules), utilisées UNIQUEMENT pour déchiffrer. */
    APP_ENCRYPTION_KEYS_PREVIOUS: z
      .string()
      .default('')
      .refine((v) => {
        // [R5-1] Validation stricte : le décodeur base64 de Node est tolérant (un espace au lieu d'une
        // virgule ferait silencieusement disparaître une clé). Ni élément vide, ni doublon.
        if (v.trim() === '') return true;
        const items = v.split(',').map((s) => s.trim());
        return items.every(isStrictKey) && new Set(items).size === items.length;
      }, 'APP_ENCRYPTION_KEYS_PREVIOUS must be comma-separated canonical base64 32-byte keys, without empty items or duplicates'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4710'),
    PAY_BASE_URL: z.string().url().default('http://localhost:3710'),
    /** URL de l'espace Business (liens dans les e-mails : invitation, réinitialisation). */
    BUSINESS_APP_URL: z.string().url().default('http://localhost:3711'),
    EMAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('VITPAY <no-reply@vitpay.local>'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3710,http://localhost:3711,http://localhost:3712'),
    COOKIE_SECURE: bool.prefault('false'),
    WORKERS_ENABLED: bool.prefault('true'),
    MOCK_PSP_ENABLED: bool.prefault('true'),
    /** Webhooks sortants vers des adresses privées/HTTP (développement uniquement). */
    ALLOW_PRIVATE_WEBHOOK_URLS: bool.prefault('false'),
    /**
     * Garde-fou réglementaire (règles absolues 10 et 18) : aucune transaction réelle
     * tant que la validation juridique n'est pas formalisée.
     */
    PAYMENTS_LIVE_ENABLED: bool.prefault('false'),
    LEGAL_SIGNOFF_REF: z.string().optional(),
    PAYMENT_REQUEST_DEFAULT_TTL_HOURS: z.coerce.number().int().positive().default(72),
    /** Jeton d'accès à /health/metrics (absent = endpoint désactivé). */
    METRICS_TOKEN: z.string().min(24).optional(),
    /**
     * Proxys de confiance pour l'IP client (limitation de débit). « loopback » en local ;
     * en conteneurs, le réseau privé du proxy (ex. « uniquelocal »). Valeur Express `trust proxy`.
     */
    TRUST_PROXY: z.string().default('loopback'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    const appEnv = resolveAppEnv(env);
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) fail('SMTP_URL', 'SMTP_URL is required when EMAIL_TRANSPORT=smtp');
    if (env.PAYMENTS_LIVE_ENABLED && !env.LEGAL_SIGNOFF_REF) {
      fail('LEGAL_SIGNOFF_REF', 'Live payments require a documented legal sign-off reference (see docs/COMPLIANCE.md)');
    }
    if (appEnv === 'production' && env.MOCK_PSP_ENABLED) fail('MOCK_PSP_ENABLED', 'Mock PSP is forbidden in production');
    if (appEnv !== 'local') {
      // Environnements accessibles publiquement (staging, production).
      if (env.NODE_ENV === 'test') fail('NODE_ENV', `NODE_ENV=test is not allowed with APP_ENV=${appEnv}`);
      if (env.ALLOW_PRIVATE_WEBHOOK_URLS) fail('ALLOW_PRIVATE_WEBHOOK_URLS', 'Private webhook URLs are forbidden outside local (SSRF)');
      if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'Secure cookies are required outside local');
      const urls: [string, string][] = [
        ['PUBLIC_API_URL', env.PUBLIC_API_URL],
        ['PAY_BASE_URL', env.PAY_BASE_URL],
        ['BUSINESS_APP_URL', env.BUSINESS_APP_URL],
        ...env.ALLOWED_ORIGINS.split(',').map((o): [string, string] => ['ALLOWED_ORIGINS', o.trim()]),
      ];
      for (const [k, v] of urls) if (!v.startsWith('https://')) fail(k, `${k} must use HTTPS outside local (${v})`);
      if (['true', 'uniquelocal', 'loopback'].includes(env.TRUST_PROXY.trim())) {
        fail('TRUST_PROXY', 'TRUST_PROXY must list the exact reverse-proxy addresses outside local (never true/uniquelocal/loopback)');
      }
    }
    if (appEnv === 'staging') {
      // Garde-fou absolu : aucune transaction réelle en staging, même avec une référence juridique.
      if (env.PAYMENTS_LIVE_ENABLED) fail('PAYMENTS_LIVE_ENABLED', 'Live payments are forbidden in staging');
      if (env.LEGAL_SIGNOFF_REF) fail('LEGAL_SIGNOFF_REF', 'LEGAL_SIGNOFF_REF must not be set in staging');
      // Aucun e-mail réel : uniquement la capture Mailpit du réseau interne (ou le journal).
      if (env.EMAIL_TRANSPORT === 'smtp' && env.SMTP_URL) {
        let host = '';
        try {
          host = new URL(env.SMTP_URL).hostname;
        } catch {
          /* signalé ci-dessous */
        }
        if (host !== 'mailpit') fail('SMTP_URL', 'In staging, e-mails must go to the internal Mailpit capture (smtp://mailpit:1025)');
      }
    }
  });

/** Environnement d'exploitation effectif (voir APP_ENV). */
export function resolveAppEnv(env: { APP_ENV?: 'local' | 'staging' | 'production'; NODE_ENV: string }): 'local' | 'staging' | 'production' {
  return env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'local');
}

export type AppConfig = z.infer<typeof EnvSchema> & { appEnv: 'local' | 'staging' | 'production'; allowedOrigins: string[]; encryptionKey: Keyring };

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    appEnv: resolveAppEnv(parsed.data),
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    encryptionKey: new Keyring(
      Buffer.from(parsed.data.APP_ENCRYPTION_KEY, 'base64'),
      parsed.data.APP_ENCRYPTION_KEYS_PREVIOUS.split(',').map((s) => s.trim()).filter(Boolean).map((k) => Buffer.from(k, 'base64')),
    ),
  };
}
