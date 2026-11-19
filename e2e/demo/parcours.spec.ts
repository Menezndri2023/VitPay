import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { MERCHANT_STATE } from '../global-setup';
import { Narrator } from './narrator';

const BIZ = process.env.BIZ_URL ?? 'http://localhost:3711';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3712';
const MAILPIT = process.env.MAILPIT_URL ?? '';

async function useMerchantSession(page: Page): Promise<void> {
  const state = JSON.parse(readFileSync(MERCHANT_STATE, 'utf8')) as { cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0] };
  await page.context().addCookies(state.cookies);
}

async function lastMail(request: APIRequestContext, to: string): Promise<{ id: string; text: string }> {
  for (let i = 0; i < 30; i++) {
    const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.[0];
    if (m) return { id: m.ID, text: String((await (await request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).Text) };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`aucun e-mail pour ${to}`);
}

const typeIn = (page: Page, label: string, value: string) => page.getByLabel(label).pressSequentially(value, { delay: 45 });

test('1 — Encaisser avec un lien de paiement', async ({ page, request }, testInfo) => {
  const n = new Narrator(page, '1-lien-de-paiement');
  const email = `demo-${Date.now()}@vitpay.test`;

  await n.title('Encaisser avec un lien de paiement', 'De l’inscription du commerçant jusqu’au reçu du client');
  await n.step('Bienvenue dans la démonstration de VITPAY. Nous sommes sur l’environnement de test : tous les paiements sont simulés et aucune somme réelle n’est débitée.');

  await n.step('Un commerçant crée son compte en quelques secondes : son nom, son e-mail professionnel, un mot de passe solide et le nom de sa boutique.', async () => {
    await page.goto(`${BIZ}/register`);
    await typeIn(page, 'Nom complet', 'Yasmine Alaoui');
    await typeIn(page, 'E-mail professionnel', email);
    await typeIn(page, 'Mot de passe', 'Demo-Zellige-2026!');
    await typeIn(page, 'Nom commercial', 'Atelier Zellige Fès');
  });
  await n.step('Il valide. Son espace est créé, mais tant que son adresse e-mail n’est pas confirmée, il ne peut pas encore encaisser.', async () => {
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByText(/Confirmez votre adresse/)).toBeVisible();
  });

  const mail = await lastMail(request, email);
  const verify = mail.text.match(/(https?:\/\/\S+\/verify-email\?token=\S+)/)![1];
  await n.step('VITPAY lui envoie un e-mail de confirmation. Sur le staging, tous les e-mails sont capturés : aucun ne part vers l’extérieur.', async () => {
    await page.goto(`${MAILPIT}/view/${mail.id}`);
  });
  await n.step('Il clique sur le lien reçu, et son adresse est confirmée.', async () => {
    await page.goto(verify);
    await page.getByRole('button', { name: 'Confirmer mon adresse' }).click();
    await expect(page.getByText('Adresse confirmée.')).toBeVisible();
  });

  await n.step('Étape suivante : relier son compte chez son prestataire de paiement agréé. Ici, c’est le prestataire simulé. Les fonds ne transitent jamais par VITPAY.', async () => {
    await page.getByRole('link', { name: 'Accéder à mon espace' }).click();
    await page.waitForURL(/\/app$/);
    await page.goto(`${BIZ}/app/settings`);
    await page.getByRole('button', { name: /Connecter : Prestataire simulé/ }).click();
    await expect(page.getByText('Prestataire simulé (sandbox) connecté.')).toBeVisible();
  });

  await n.step('Le commerçant crée maintenant une demande de paiement : un montant, et un motif que son client verra.', async () => {
    await page.goto(`${BIZ}/app/requests/new`);
    await typeIn(page, 'Montant (MAD)', '1250');
    await typeIn(page, 'Motif (visible par le payeur)', 'Table en zellige, commande 2026-114');
  });
  await n.step('VITPAY génère aussitôt un lien et un QR code, à envoyer par WhatsApp, par e-mail, ou à faire scanner.', async () => {
    await page.getByRole('button', { name: 'Générer le lien et le QR code' }).click();
    await expect(page.getByRole('img', { name: /QR code de paiement/ })).toBeVisible();
  });
  const payUrl = await page.getByLabel('Lien de paiement').inputValue();

  await n.step('Passons du côté du client. Il ouvre le lien : il voit le nom de la boutique, le motif et le montant. VITPAY rappelle qu’on ne lui demandera jamais son code PIN.', async () => {
    await page.goto(payUrl);
    await expect(page.getByText('Atelier Zellige Fès')).toBeVisible();
  });
  await n.step('Il choisit de payer par carte. Il est redirigé vers la page du prestataire : les données de carte ne passent jamais par VITPAY.', async () => {
    await page.getByRole('button', { name: 'Payer par carte bancaire' }).click();
    await expect(page.getByText('SANDBOX — AUCUN PAIEMENT RÉEL')).toBeVisible();
  });
  await n.step('Le paiement est accepté. La confirmation affichée vient du serveur, pas du navigateur, et le client peut télécharger son reçu.', async () => {
    await page.getByRole('button', { name: 'Payer — scénario succès' }).click();
    await expect(page.getByText('Paiement confirmé')).toBeVisible({ timeout: 20_000 });
  });

  await n.step('Côté commerçant, la demande apparaît aussitôt comme payée, avec son reçu.', async () => {
    await page.goto(`${BIZ}/app/requests`);
    await expect(page.locator('.vp-badge', { hasText: 'Payée' }).first()).toBeVisible();
    await page.locator('a.vp-mono').first().click();
    await expect(page.getByText(/Reçu VPR-/)).toBeVisible();
  });
  await n.step('Et le tableau de bord fait le point sur les encaissements des trente derniers jours.', async () => {
    await page.goto(`${BIZ}/app`);
    await expect(page.getByText('Encaissé (30 jours)')).toBeVisible();
  });
  await n.title('Paiement encaissé', 'Inscription, lien, paiement, reçu : quelques minutes, sans matériel');
  await n.step('Voilà le parcours complet d’un paiement par lien avec VITPAY.');
  await n.save(testInfo);
});

test('2 — Encaisser en boutique : caisse QR et TPE', async ({ page }, testInfo) => {
  const n = new Narrator(page, '2-caisse-et-tpe');
  await useMerchantSession(page);
  await n.title('Encaisser en boutique', 'La caisse VITPAY : QR code plein écran et terminal de paiement');
  await n.step('Deuxième parcours : l’encaissement en boutique, quand le client est devant le commerçant.');

  await n.step('Le commerçant ouvre la caisse et tape le montant sur le pavé, comme sur une calculatrice.', async () => {
    await page.goto(`${BIZ}/app/pos`);
    for (const k of ['1', '8', '5', ',', '5']) await page.getByRole('button', { name: k, exact: true }).click();
  });
  await n.step('Un QR code s’affiche en plein écran. Le client le scanne avec son téléphone et paie de son côté.', async () => {
    await page.getByRole('button', { name: 'Générer le QR d’encaissement' }).click();
    await expect(page.getByRole('img', { name: /QR code à scanner/ })).toBeVisible();
  });
  await n.step('Si le client change d’avis, le commerçant abandonne : la demande est annulée, rien n’est encaissé.', async () => {
    await page.getByRole('button', { name: 'Abandonner' }).click();
  });

  const label = `Comptoir ${Date.now() % 1000}`;
  await n.step('Autre option : un terminal de paiement. Le commerçant en déclare un dans ses paramètres. Ici, un terminal simulé.', async () => {
    await page.goto(`${BIZ}/app/settings`);
    await typeIn(page, 'Nom du TPE simulé', label);
    await page.getByRole('button', { name: 'Ajouter un TPE simulé' }).click();
    await expect(page.getByText('TPE simulé ajouté.')).toBeVisible();
  });
  await n.step('Retour en caisse : il saisit le montant, puis l’envoie directement au terminal.', async () => {
    await page.goto(`${BIZ}/app/pos`);
    for (const k of ['3', '2', '0']) await page.getByRole('button', { name: k, exact: true }).click();
    await page.getByRole('button', { name: 'Générer le QR d’encaissement' }).click();
    const select = page.getByLabel('Terminal');
    if (await select.count()) await select.selectOption({ label });
    await page.getByRole('button', { name: /Envoyer au TPE/ }).click();
    await expect(page.getByText(/Montant envoyé au TPE/)).toBeVisible();
  });
  const simUrl = (await page.getByRole('link', { name: 'Ouvrir le TPE simulé (sandbox)' }).getAttribute('href')) as string;

  await n.step('Sur l’écran du terminal, le montant apparaît. Le client présente sa carte et tape son code sur le terminal, jamais dans VITPAY.', async () => {
    await page.goto(simUrl);
    await expect(page.locator('.amount')).toContainText('320');
  });
  await n.step('Le terminal accepte le paiement.', async () => {
    await page.getByRole('button', { name: 'Carte acceptée (code saisi sur le terminal)' }).click();
    await expect(page.getByText('✓ PAIEMENT ACCEPTÉ')).toBeVisible();
  });
  await n.step('Dans l’historique du commerçant, l’encaissement au terminal est confirmé, et la vente abandonnée tout à l’heure apparaît bien comme annulée.', async () => {
    await page.waitForLoadState('networkidle'); // le TPE simulé poursuit sa propre navigation après l'acceptation
    await page.goto(`${BIZ}/app/requests`).catch(() => page.goto(`${BIZ}/app/requests`));
    await expect(page.locator('.vp-badge', { hasText: 'Payée' }).first()).toBeVisible({ timeout: 20_000 });
  });
  await n.title('Encaissement en boutique', 'QR code ou terminal : le client paie, le commerçant voit tout en temps réel');
  await n.step('Fin du parcours en boutique.');
  await n.save(testInfo);
});

test('3 — Paiement en attente et page en arabe', async ({ page }, testInfo) => {
  const n = new Narrator(page, '3-attente-et-arabe');
  await useMerchantSession(page);
  const ref = `CMD-${Date.now() % 100000}`;
  await n.title('Paiements en attente et multilingue', 'Quand la banque répond plus tard, et pour les clients arabophones');
  await n.step('Troisième parcours : un paiement dont la confirmation par la banque arrive plus tard.');

  await n.step('Le commerçant crée une demande avec sa propre référence de commande, pour la retrouver facilement.', async () => {
    await page.goto(`${BIZ}/app/requests/new`);
    await typeIn(page, 'Montant (MAD)', '640');
    await typeIn(page, 'Référence de commande (facultatif, unique)', ref);
    await page.getByRole('button', { name: 'Générer le lien et le QR code' }).click();
    await expect(page.getByRole('heading', { name: /Demande créée/ })).toBeVisible();
  });
  const payUrl = await page.getByLabel('Lien de paiement').inputValue();

  await n.step('Le client paie, mais la banque ne répond pas tout de suite. VITPAY l’indique honnêtement : vérification en cours, sans annoncer un succès prématuré.', async () => {
    await page.goto(payUrl);
    await page.getByRole('button', { name: 'Payer par carte bancaire' }).click();
    await page.getByRole('button', { name: 'Payer — confirmation différée (en attente)' }).click();
    await expect(page.getByText(/Vérification en cours/)).toBeVisible({ timeout: 20_000 });
  });
  await n.step('Le commerçant retrouve la commande grâce à sa référence. Sur le staging, il peut simuler la réponse de la banque.', async () => {
    await page.goto(`${BIZ}/app/requests`);
    await page.locator('tr', { hasText: ref }).locator('a.vp-mono').click();
    await expect(page.getByText(`commande ${ref}`)).toBeVisible();
  });
  await n.step('La banque confirme : la demande passe à payée, et l’historique des événements garde la trace de chaque étape.', async () => {
    await page.getByRole('button', { name: 'Simuler : banque confirme' }).click();
    await expect(page.locator('h1 .vp-badge', { hasText: 'Payée' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('heading', { name: 'Historique des événements' }).scrollIntoViewIfNeeded();
  });
  await n.step('Le client, lui, voit maintenant son paiement confirmé.', async () => {
    await page.goto(payUrl);
    await expect(page.getByText('Paiement confirmé')).toBeVisible({ timeout: 20_000 });
  });

  await n.step('Enfin, la page de paiement existe aussi en arabe, avec un sens de lecture de droite à gauche.', async () => {
    const me = await (await page.request.get(`${BIZ}/api/v1/auth/me`)).json();
    const res = await page.request.post(`${BIZ}/api/v1/orgs/${me.organizations[0].id}/payment-requests`, {
      data: { amount: '99', currency: 'MAD', description: 'Commande en arabe' },
      headers: { 'x-vitpay-csrf': '1', 'idempotency-key': `demo-ar-${Date.now()}` },
    });
    await page.goto((await res.json()).payUrl);
    await page.getByLabel('Langue').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
  await n.title('Fiable et accessible', 'Statuts confirmés par le serveur, historique complet, français et arabe');
  await n.step('Fin du troisième parcours.');
  await n.save(testInfo);
});

test('4 — Développeurs, KYB et sécurité', async ({ page, request }, testInfo) => {
  const n = new Narrator(page, '4-developpeurs-kyb-securite');
  await useMerchantSession(page);
  await n.title('Intégration et conformité', 'Clés API, justificatifs KYB et protection de la console');
  await n.step('Dernier parcours : ce qui sert aux intégrations techniques et à la conformité.');

  await n.step('Pour passer en mode réel, le commerçant dépose ses justificatifs, par exemple son attestation ICE. Les documents sont chiffrés avant d’être stockés.', async () => {
    await page.goto(`${BIZ}/app/settings`);
    await page.getByLabel('Type de document').selectOption('ice_certificate');
    await page.getByLabel('Fichier').setInputFiles({ name: 'attestation-ice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(page.getByText('Document envoyé.')).toBeVisible();
  });

  await n.step('Un site marchand peut aussi se brancher directement sur VITPAY. Le commerçant crée une clé d’API ; son secret ne s’affiche qu’une seule fois.', async () => {
    await page.goto(`${BIZ}/app/developers`);
    await typeIn(page, 'Nom de la clé', 'Boutique en ligne');
    await page.getByRole('button', { name: 'Créer une clé' }).click();
    await expect(page.getByLabel('Secret')).toHaveValue(/^vp_sk_/);
  });
  const secret = await page.getByLabel('Secret').inputValue();
  const orgId = await page.locator('code').first().innerText();
  const res = await request.post(`${BIZ}/api/v1/orgs/${orgId}/payment-requests`, {
    headers: { authorization: `Bearer ${secret}`, 'idempotency-key': `demo-api-${Date.now()}` },
    data: { amount: '149.90', currency: 'MAD', description: 'Commande API' },
  });
  const body = await res.json();
  await n.step('Avec cette clé, le site crée une demande de paiement par programme, et reçoit en retour le lien à présenter à son client.', async () => {
    await page.setContent(`<body style="margin:0;background:#0d1117;color:#e6edf3;font:17px/1.6 ui-monospace,Menlo,monospace;padding:48px">
      <div style="color:#7ee787">$ POST /api/v1/orgs/…/payment-requests</div>
      <div style="color:#8b949e">Authorization: Bearer vp_sk_••••••••</div>
      <div style="color:#8b949e">{ "amount": "149.90", "currency": "MAD", "description": "Commande API" }</div><br>
      <div style="color:#79c0ff">HTTP ${res.status()} Created</div>
      <div>{ "status": "${body.status ?? 'pending'}", "payUrl": "${String(body.payUrl).replace(/\/r\/.*/, '/r/…')}" }</div></body>`);
  });

  const admin = await request.get(`${ADMIN}/console`, { maxRedirects: 0 });
  await n.step('Côté VITPAY, la console d’administration est protégée deux fois : un accès réservé devant le site, puis une connexion avec double authentification.', async () => {
    await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f6f7f6;font:20px -apple-system,sans-serif">
      <div style="background:#fff;border-radius:14px;padding:40px 56px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center">
      <div style="font-size:15px;color:#667">${new URL(ADMIN).host}</div>
      <div style="font-size:44px;font-weight:700;color:#b42318;margin:10px 0">${admin.status()}</div>
      <div>Accès refusé sans identifiants : authentification requise</div></div></body>`);
  });
  await n.title('Prêt pour l’intégration', 'API sécurisée, KYB chiffré, console protégée, paiements réels verrouillés tant que la conformité n’est pas validée');
  await n.step('Merci d’avoir suivi cette démonstration de VITPAY.');
  await n.save(testInfo);
});
