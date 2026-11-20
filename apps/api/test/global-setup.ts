import { migrate } from '../src/database/migrate';
import { TEST_ENV } from './env';

/** Applique les migrations sur la base de test (vitpay_test) avant la suite. */
export default async function setup(): Promise<void> {
  await migrate(TEST_ENV.DATABASE_OWNER_URL, () => undefined);
}
