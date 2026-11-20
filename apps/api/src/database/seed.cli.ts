/**
 * Données de DÉMONSTRATION (sandbox) — jamais de données réelles (règle absolue 12).
 * Crée trois administrateurs (contrôle à quatre yeux) et un commerçant de démonstration relié au
 * prestataire simulé.
 * - local : mot de passe de démonstration commun (SEED_PASSWORD ou valeur par défaut) ;
 * - staging : mot de passe ALÉATOIRE distinct par compte, affiché une seule fois (P3) — à lancer
 *   avec `docker compose run --rm seed` pour qu'il ne reste dans aucun journal de conteneur ;
 * - production : interdit.
 */
import { randomBytes } from 'node:crypto';
import { createApp } from '../bootstrap';
import { loadConfig } from '../config';
import { AuthService } from '../modules/identity/auth.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { Db } from './db.service';

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
  if (config.appEnv === 'production') throw new Error('Seeding is forbidden in production');
  if (config.appEnv !== 'local' && process.env.SEED_PASSWORD) throw new Error('SEED_PASSWORD is only allowed locally: staging passwords are always random');
  // [R7-10] Hors local, identifiants affichés UNIQUEMENT dans un terminal interactif : jamais dans un
  // journal collecté (pilote de journaux Docker, CI). `docker compose run --rm seed` alloue un terminal.
  if (config.appEnv !== 'local' && !process.stdout.isTTY) throw new Error('Outside local, run the seed in an interactive terminal (docker compose run --rm seed)');
  const app = await createApp(config);
  await app.listen(config.PORT); // le prestataire simulé est appelé en HTTP
  try {
    const auth = app.get(AuthService);
    const orgs = app.get(OrganizationsService);
    const db = app.get(Db);
    const local = config.appEnv === 'local';
    // 24 octets aléatoires → 32 caractères ; préfixe garantissant la politique de mot de passe.
    const passwordFor = () => (local ? (process.env.SEED_PASSWORD ?? 'Demo-Password-2026!') : `Vp-${randomBytes(24).toString('base64url')}`);
    const exists = (email: string) => db.system((tx) => tx.maybeOne('SELECT 1 FROM users WHERE lower(email) = $1', [email]));
    const lines: string[] = [];

    for (const [email, name, role] of [
      ['superadmin@vitpay.test', 'Super Admin (démo)', 'super_admin'],
      ['finance@vitpay.test', 'Responsable financier (démo)', 'finance'],
      ['compliance@vitpay.test', 'Responsable conformité (démo)', 'compliance'],
    ] as const) {
      const already = await exists(email);
      const pw = passwordFor();
      const r = await auth.createPlatformAdmin(email, pw, name, role);
      lines.push(
        `  ${email.padEnd(24)} mot de passe : ${already ? '(compte existant, inchangé)' : pw}  ·  jeton MFA : ${r.enrollmentToken ?? '(MFA déjà activée)'}`,
      );
    }

    if (!(await exists('marchand@vitpay.test'))) {
      const pw = passwordFor();
      lines.push(`  ${'marchand@vitpay.test'.padEnd(24)} mot de passe : ${pw}`);
      const r = await auth.register(
        { email: 'marchand@vitpay.test', password: pw, fullName: 'Commerçant Démo', organizationName: 'Boutique Démo Casablanca', organizationType: 'business' },
        { ip: '127.0.0.1', userAgent: 'seed' },
      );
      const owner = await db.system((tx) => tx.one<{ id: string }>("SELECT id FROM users WHERE lower(email) = 'marchand@vitpay.test'"));
      // Compte de démonstration fictif (domaine .test, aucune boîte réelle) : adresse marquée vérifiée.
      await db.system((tx) => tx.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [owner.id]));
      await orgs.connectProvider(r.orgId, owner.id, { providerCode: 'mock', mode: 'sandbox' }, { ip: '127.0.0.1', userAgent: 'seed' });
    } else {
      lines.push(`  ${'marchand@vitpay.test'.padEnd(24)} mot de passe : (compte existant, inchangé)`);
    }
    console.log(`✓ seed done (environnement : ${config.appEnv})
${lines.join('\n')}
  Les administrateurs enrôlent leur MFA à la première connexion avec leur jeton (valable 72 h).${
    local ? '' : '\n  ⚠ Identifiants affichés UNE SEULE FOIS : conservez-les dans un gestionnaire de mots de passe.'
  }`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
