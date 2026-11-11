import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4710),
    DATABASE_URL: z.string().url(),
    DATABASE_OWNER_URL: z.string().url().optional(),
    /** Rôle système (BYPASSRLS) : uniquement pour les chemins transverses justifiés. */
    DATABASE_SYSTEM_URL: z.string().url(),
    /** Clé AES-256 (32 octets, base64) pour chiffrer les identifiants prestataires et secrets MFA. */
    APP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes base64'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4710'),
    PAY_BASE_URL: z.string().url().default('http://localhost:3710'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3710,http://localhost:3711,http://localhost:3712'),
    COOKIE_SECURE: bool.default('false'),
    WORKERS_ENABLED: bool.default('true'),
    MOCK_PSP_ENABLED: bool.default('true'),
    /**
     * Garde-fou réglementaire (règles absolues 10 et 18) : aucune transaction réelle
     * tant que la validation juridique n'est pas formalisée.
     */
    PAYMENTS_LIVE_ENABLED: bool.default('false'),
    LEGAL_SIGNOFF_REF: z.string().optional(),
    PAYMENT_REQUEST_DEFAULT_TTL_HOURS: z.coerce.number().int().positive().default(72),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.MOCK_PSP_ENABLED) {
      ctx.addIssue({ code: 'custom', path: ['MOCK_PSP_ENABLED'], message: 'Mock PSP is forbidden in production' });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Secure cookies are required in production' });
    }
    if (env.PAYMENTS_LIVE_ENABLED && !env.LEGAL_SIGNOFF_REF) {
      ctx.addIssue({
        code: 'custom',
        path: ['LEGAL_SIGNOFF_REF'],
        message: 'Live payments require a documented legal sign-off reference (see docs/COMPLIANCE.md)',
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema> & { allowedOrigins: string[]; encryptionKey: Buffer };

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    encryptionKey: Buffer.from(parsed.data.APP_ENCRYPTION_KEY, 'base64'),
  };
}
