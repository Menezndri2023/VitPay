const host = process.env.TEST_DB_HOST ?? 'localhost';
const port = process.env.TEST_DB_PORT ?? '5433';

export const TEST_PORT = 4555;

/** Environnement de test : base dédiée, secrets factices, prestataire simulé uniquement. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: String(TEST_PORT),
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://vitpay_app:dev_app_password_change_me@${host}:${port}/vitpay_test`,
  DATABASE_SYSTEM_URL: process.env.TEST_DATABASE_SYSTEM_URL ?? `postgres://vitpay_system:dev_system_password_change_me@${host}:${port}/vitpay_test`,
  DATABASE_OWNER_URL: process.env.TEST_DATABASE_OWNER_URL ?? `postgres://vitpay_owner:dev_owner_password_change_me@${host}:${port}/vitpay_test`,
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PUBLIC_API_URL: `http://127.0.0.1:${TEST_PORT}`,
  PAY_BASE_URL: 'http://localhost:3710',
  ALLOWED_ORIGINS: 'http://localhost:3710,http://localhost:3711,http://localhost:3712',
  COOKIE_SECURE: 'false',
  WORKERS_ENABLED: 'false',
  MOCK_PSP_ENABLED: 'true',
  PAYMENTS_LIVE_ENABLED: 'false',
};
