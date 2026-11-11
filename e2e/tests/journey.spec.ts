import { expect, test } from '@playwright/test';

const BIZ = process.env.BIZ_URL ?? 'http://localhost:3711';
const PAY = process.env.PAY_URL ?? 'http://localhost:3710';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3712';
const SHOTS = process.env.PW_SHOTS;
const MAILPIT = process.env.MAILPIT_URL;

/** Dernier lien correspondant dans les e-mails reçus par Mailpit (envoyés par le worker via SMTP). */
async function mailLink(request: import('@playwright/test').APIRequestContext, to: string, re: RegExp): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    for (const m of list.messages ?? []) {
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const link = String(msg.Text).match(re)?.[1];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`aucun e-mail pour ${to}`);
}

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test('parcours complet : inscription → vérification e-mail → prestataire → demande → paiement → confirmation', async ({ page, context, request }) => {
  test.skip(!MAILPIT, 'MAILPIT_URL non défini (pile docker sandbox requise)');
  const email = `e2e-${Date.now()}@vitpay.test`;

  // Inscription
  await page.goto(`${BIZ}/register`);
  await shot(page, '01-register');
  await page.getByLabel('Nom complet').fill('Testeur E2E');
  await page.getByLabel('E-mail professionnel').fill(email);
  await page.getByLabel('Mot de passe').fill('E2e-Password-2026!');
  await page.getByLabel('Nom commercial').fill('Atelier E2E Rabat');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  // Adresse non confirmée : bandeau, connexion du prestataire refusée
  await expect(page.getByText('Bienvenue sur VITPAY')).toBeVisible();
  await expect(page.getByText(/Confirmez votre adresse/)).toBeVisible();
  await page.getByRole('button', { name: /Connecter : Prestataire simulé/ }).click();
  await expect(page.getByText('Confirmez d’abord votre adresse e-mail avec le lien reçu.')).toBeVisible();

  // Lien reçu par e-mail (SMTP → Mailpit)
  const verify = await mailLink(request, email, /(http:\/\/localhost:3711\/verify-email\?token=\S+)/);
  await page.goto(verify);
  await page.getByRole('button', { name: 'Confirmer mon adresse' }).click();
  await expect(page.getByText('Adresse confirmée.')).toBeVisible();
  await page.getByRole('link', { name: 'Accéder à mon espace' }).click();
  await page.waitForURL(/\/app$/);
  await page.goto(`${BIZ}/app/settings`);
  await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible();
  await expect(page.getByText(/Confirmez votre adresse/)).toHaveCount(0);

  // Connexion du prestataire simulé
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

test('mot de passe oublié : e-mail réel (SMTP → Mailpit) puis réinitialisation', async ({ page, request }) => {
  test.skip(!process.env.MAILPIT_URL, 'MAILPIT_URL non défini (pile docker sandbox requise)');
  const email = `reset-${Date.now()}@vitpay.test`;
  await request.post(`${BIZ}/api/v1/auth/register`, {
    data: { email, password: 'E2e-Password-2026!', fullName: 'Reset E2E', organizationName: 'Org Reset' },
    headers: { 'x-vitpay-csrf': '1' },
  });
  await page.goto(`${BIZ}/login`);
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Recevoir un lien' }).click();
  await expect(page.getByText(/un lien de réinitialisation/)).toBeVisible();

  // Lecture de l'e-mail dans Mailpit (envoyé par le worker via SMTP)
  const link = await mailLink(request, email, /(http:\/\/localhost:3711\/reset-password\?token=\S+)/);
  await page.goto(link);
  await page.getByLabel('Nouveau mot de passe').fill('Brand-New-Pass-2026!');
  await page.getByLabel('Confirmation').fill('Brand-New-Pass-2026!');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/Mot de passe modifié/)).toBeVisible();
  await shot(page, '13-reset-done');
});

test('KYB : dépôt d’un justificatif depuis les paramètres', async ({ page }) => {
  await page.goto(`${BIZ}/login`);
  await page.getByLabel('E-mail').fill('marchand@vitpay.test');
  await page.getByLabel('Mot de passe').fill('Demo-Password-2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/app/);
  await page.goto(`${BIZ}/app/settings`);
  await page.getByLabel('Type de document').selectOption('ice_certificate');
  await page.getByLabel('Fichier').setInputFiles({ name: 'attestation-ice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Document envoyé.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'attestation-ice.pdf' }).first()).toBeVisible();
  await shot(page, '14-kyb-upload');
});

test('développeurs : création d’une clé API puis appel de l’API avec cette clé', async ({ page, request }) => {
  await page.goto(`${BIZ}/login`);
  await page.getByLabel('E-mail').fill('marchand@vitpay.test');
  await page.getByLabel('Mot de passe').fill('Demo-Password-2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/app/);
  await page.goto(`${BIZ}/app/developers`);
  await page.getByLabel('Nom de la clé').fill(`E2E ${Date.now()}`);
  await page.getByRole('button', { name: 'Créer une clé' }).click();
  const secret = await page.getByLabel('Secret').inputValue();
  expect(secret).toMatch(/^vp_sk_/);
  await shot(page, '15-developers');
  const orgId = await page.locator('code').first().innerText();
  const res = await request.post(`${BIZ}/api/v1/orgs/${orgId}/payment-requests`, {
    headers: { authorization: `Bearer ${secret}`, 'idempotency-key': `e2e-api-${Date.now()}` },
    data: { amount: '149.90', currency: 'MAD', description: 'Commande API' },
  });
  expect(res.status()).toBe(201);
  expect((await res.json()).payUrl).toContain('/r/');
});

test('connexion : le paramètre next ne peut pas rediriger hors du site', async ({ page }) => {
  for (const next of ['/%09/evil.example', '//evil.example', '/\\evil.example', 'https://evil.example']) {
    await page.context().clearCookies();
    await page.goto(`${BIZ}/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel('E-mail').fill('marchand@vitpay.test');
    await page.getByLabel('Mot de passe').fill('Demo-Password-2026!');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).origin, next).toBe(new URL(BIZ).origin);
  }
});

test('paiement en attente : référence de commande, confirmation différée simulée, historique des événements', async ({ page, context }) => {
  const ref = `CMD-E2E-${Date.now()}`;
  await page.goto(`${BIZ}/login`);
  await page.getByLabel('E-mail').fill('marchand@vitpay.test');
  await page.getByLabel('Mot de passe').fill('Demo-Password-2026!');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/\/app/);
  await page.goto(`${BIZ}/app/requests/new`);
  await page.getByLabel('Montant (MAD)').fill('77');
  await page.getByLabel('Référence de commande (facultatif, unique)').fill(ref);
  await page.getByRole('button', { name: 'Générer le lien et le QR code' }).click();
  await expect(page.getByRole('heading', { name: /Demande créée/ })).toBeVisible();
  const payUrl = await page.getByLabel('Lien de paiement').inputValue();

  // Le payeur valide, la banque ne répond pas encore
  const payer = await context.browser()!.newContext({ locale: 'fr-FR' });
  const p = await payer.newPage();
  await p.goto(payUrl);
  await p.getByRole('button', { name: 'Payer par carte bancaire' }).click();
  await p.getByRole('button', { name: 'Payer — confirmation différée (en attente)' }).click();
  await expect(p.getByText(/Vérification en cours/)).toBeVisible({ timeout: 20_000 });
  await shot(p, '16-pay-pending');

  // Côté commerçant : retrouver la commande, simuler la réponse de la banque
  await page.goto(`${BIZ}/app/requests`);
  await page.locator('tr', { hasText: ref }).locator('a.vp-mono').click();
  await expect(page.getByText(`commande ${ref}`)).toBeVisible();
  await page.getByRole('button', { name: 'Simuler : banque confirme' }).click();
  await expect(page.locator('h1 .vp-badge', { hasText: 'Payée' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Historique des événements' })).toBeVisible();
  await expect(page.getByText('Demande créée')).toBeVisible();
  await expect(page.getByText(/Statut de la tentative.*Confirmé/).first()).toBeVisible();
  await shot(page, '17-events');

  // Le payeur voit la confirmation (preuve serveur)
  await expect(p.getByText('Paiement confirmé')).toBeVisible({ timeout: 20_000 });
  await payer.close();
});
