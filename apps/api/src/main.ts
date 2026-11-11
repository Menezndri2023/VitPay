import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
  // eslint-disable-next-line no-console
  console.log(
    `VITPAY API listening on :${config.PORT} — payments: ${config.PAYMENTS_LIVE_ENABLED ? 'LIVE ENABLED' : 'sandbox only'}${config.MOCK_PSP_ENABLED ? ' — mock PSP enabled' : ''}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
