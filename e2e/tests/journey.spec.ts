import { expect, test } from '@playwright/test';

const BIZ = process.env.BIZ_URL ?? 'http://localhost:3711';
const PAY = process.env.PAY_URL ?? 'http://localhost:3710';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3712';
const SHOTS = process.env.PW_SHOTS;
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test('parcours complet : inscription → prestataire → demande → paiement → confirmation', async ({ page, context }) => {
  const email = `e2e-${Date.now()}@vitpay.test`;

  // Inscription
  await page.goto(`${BIZ}/register`);
  await shot(page, '01-register');
  await page.getByLabel('Nom complet').fill('Testeur E2E');
  await page.getByLabel('E-mail professionnel').fill(email);
  await page.getByLabel('Mot de passe').fill('E2e-Password-2026!');
  await page.getByLabel('Nom commercial').fill('Atelier E2E Rabat');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  // Connexion du prestataire simulé
  await expect(page.getByText('Bienvenue sur VITPAY')).toBeVisible();
  await page.getByRole('button', { name: /Connecter : Prestataire simulé/ }).click();
  await expect(page.getByText('Prestataire simulé (sandbox) connecté.')).toBeVisible();
  await shot(page, '02-settings');

  // Nouvelle demande
  await page.goto(`${BIZ}/app/requests/new`);
  await page.getByLabel('Montant (MAD)').fill('250,50');
  await page.getByLabel('Motif (visible par le payeur)').fill('Facture 2026-001');
  await page.getByRole('button', { name: 'Générer le lien et le QR code' }).click();
  await expect(page.getByRole('heading', { name: /Demande créée/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code de paiement/ })).toBeVisible();
  await shot(page, '03-request-created');
  const payUrl = await page.getByLabel('Lien de paiement').inputValue();
  expect(payUrl).toMatch(/^http:\/\/localhost:3710\/r\//);

  // Le payeur (navigateur distinct, sans session)
  const payer = await context.browser()!.newContext({ locale: 'fr-FR' });
  const p = await payer.newPage();
  await p.goto(payUrl);
  await expect(p.getByText('Atelier E2E Rabat')).toBeVisible();
  await expect(p.getByText('Facture 2026-001')).toBeVisible();
  await expect(p.locator('.vp-amount')).toContainText('250,50');
  await expect(p.getByText(/ne vous demandera jamais votre code PIN/)).toBeVisible();
  await shot(p, '04-pay-page');
  await p.getByRole('button', { name: 'Payer par carte bancaire' }).click();

  // Page du prestataire simulé
  await expect(p.getByText('SANDBOX — AUCUN PAIEMENT RÉEL')).toBeVisible();
  await shot(p, '05-mock-checkout');
  await p.getByRole('button', { name: 'Payer — scénario succès' }).click();

  // Retour : confirmation issue du serveur
  await expect(p.getByText('Paiement confirmé')).toBeVisible({ timeout: 20_000 });
  await expect(p.getByRole('link', { name: 'Télécharger le reçu' })).toBeVisible();
  await shot(p, '06-pay-status');
  await payer.close();

  // Côté commerçant
  await page.goto(`${BIZ}/app/requests`);
  await expect(page.locator('.vp-badge', { hasText: 'Payée' }).first()).toBeVisible();
  await page.locator('a.vp-mono').first().click();
  await expect(page.getByText(/Reçu VPR-/)).toBeVisible();
  await shot(page, '07-request-detail');
  await page.goto(`${BIZ}/app`);
  await expect(page.getByText('Encaissé (30 jours)')).toBeVisible();
  await shot(page, '08-dashboard');
});

test('page de paiement en arabe : sens de lecture RTL', async ({ page }) => {
  // Demande existante créée via l'API du compte de démonstration
  const api = page.request;
  await api.post(`${BIZ}/api/v1/auth/login`, { data: { email: 'marchand@vitpay.test', password: 'Demo-Password-2026!' }, headers: { 'x-vitpay-csrf': '1' } });
  const me = await (await api.get(`${BIZ}/api/v1/auth/me`)).json();
  const res = await api.post(`${BIZ}/api/v1/orgs/${me.organizations[0].id}/payment-requests`, {
    data: { amount: '99', currency: 'MAD', description: 'Test RTL' },
    headers: { 'x-vitpay-csrf': '1', 'idempotency-key': `e2e-rtl-${Date.now()}` },
  });
  const { payUrl } = await res.json();
  await page.goto(payUrl);
  await page.getByLabel('Langue').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('اختر وسيلة الدفع')).toBeVisible();
  // La marque reste lisible « VITPAY » en RTL
  await expect(page.locator('.vp-logo')).toHaveAttribute('dir', 'ltr');
  await shot(page, '09-pay-arabic');
});

test('caisse : saisie au pavé et QR plein écran', async ({ page }) => {
  await page.goto(`${BIZ}/login`);
  await page.getByLabel('E-mail').fill('marchand@vitpay.test');
  await page.getByLabel('Mot de passe').fill('Demo-Password-2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/app/);
  await page.goto(`${BIZ}/app/pos`);
  for (const k of ['4', '5', ',', '5']) await page.getByRole('button', { name: k, exact: true }).click();
  await shot(page, '10-pos-keypad');
  await page.getByRole('button', { name: 'Générer le QR d’encaissement' }).click();
  await expect(page.getByRole('img', { name: /QR code à scanner/ })).toBeVisible();
  await expect(page.locator('.vp-amount')).toContainText('45,50');
  await shot(page, '11-pos-qr');
  await page.getByRole('button', { name: 'Abandonner' }).click();
  await expect(page.getByRole('button', { name: 'Générer le QR d’encaissement' })).toBeVisible();
  await page.goto(`${BIZ}/app/requests`);
  await expect(page.locator('tr', { hasText: '45,50' }).first().locator('.vp-badge', { hasText: 'Annulée' })).toBeVisible();
});

test('admin : page de connexion et protection de la console', async ({ page }) => {
  await page.goto(`${ADMIN}/console`);
  await page.waitForURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Connexion administrateur' })).toBeVisible();
  await shot(page, '12-admin-login');
});

test('responsive : page de paiement sans défilement horizontal en largeur mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${PAY}/`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await ctx.close();
});
