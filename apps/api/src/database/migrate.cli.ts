import { migrate } from './migrate';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is required to run migrations');
  process.exit(1);
}
migrate(url)
  .then(() => console.log('✓ migrations up to date'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
