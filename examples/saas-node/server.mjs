import { createSaasApp } from './app.mjs';

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Variable d'environnement manquante : ${k} (voir README.md)`);
    process.exit(1);
  }
  return v;
};

const port = Number(process.env.PORT ?? 3000);
const { server } = createSaasApp({
  apiUrl: need('VITPAY_API_URL'),
  orgId: need('VITPAY_ORG_ID'),
  secretKey: need('VITPAY_SECRET_KEY'),
  webhookSecret: need('VITPAY_WEBHOOK_SECRET'),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
});
server.listen(port, () => console.log(`Exemple SaaS : http://localhost:${port}`));
