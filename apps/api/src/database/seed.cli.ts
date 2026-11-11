/**
 * Données de DÉMONSTRATION (sandbox) — jamais de données réelles (règle absolue 12).
 * Crée deux administrateurs (pour le contrôle à quatre yeux) et un commerçant de démonstration
 * relié au prestataire simulé.
 */
import { createApp } from '../bootstrap';
import { loadConfig } from '../config';
import { AuthService } from '../modules/identity/auth.service';
import { OrganizationsService } from '../modules/organizations/organizations.service';
import { Db } from './db.service';

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
  if (config.NODE_ENV === 'production') throw new Error('Seeding is forbidden in production');
  const app = await createApp(config);
  await app.listen(config.PORT); // le prestataire simulé est appelé en HTTP
  try {
    const auth = app.get(AuthService);
    const orgs = app.get(OrganizationsService);
    const db = app.get(Db);
    const pw = process.env.SEED_PASSWORD ?? 'Demo-Password-2026!';

    const tokens: string[] = [];
    for (const [email, name, role] of [
      ['superadmin@vitpay.test', 'Super Admin (démo)', 'super_admin'],
      ['finance@vitpay.test', 'Responsable financier (démo)', 'finance'],
      ['compliance@vitpay.test', 'Responsable conformité (démo)', 'compliance'],
    ] as const) {
      const r = await auth.createPlatformAdmin(email, pw, name, role);
      tokens.push(`  ${email.padEnd(24)} jeton d'enrôlement MFA : ${r.enrollmentToken ?? '(MFA déjà activée)'}`);
    }

    const existing = await db.system((tx) => tx.maybeOne("SELECT 1 FROM users WHERE lower(email) = 'marchand@vitpay.test'"));
    if (!existing) {
      const r = await auth.register(
        { email: 'marchand@vitpay.test', password: pw, fullName: 'Commerçant Démo', organizationName: 'Boutique Démo Casablanca', organizationType: 'business' },
        { ip: '127.0.0.1', userAgent: 'seed' },
      );
      const owner = await db.system((tx) => tx.one<{ id: string }>("SELECT id FROM users WHERE lower(email) = 'marchand@vitpay.test'"));
      // Compte de démonstration fictif (domaine .test, aucune boîte réelle) : adresse marquée vérifiée.
      await db.system((tx) => tx.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [owner.id]));
      await orgs.connectProvider(r.orgId, owner.id, { providerCode: 'mock', mode: 'sandbox' }, { ip: '127.0.0.1', userAgent: 'seed' });
    }
    console.log(`✓ seed done
  Admin (super_admin) : superadmin@vitpay.test
  Admin (finance)     : finance@vitpay.test
  Admin (compliance)  : compliance@vitpay.test
  Commerçant          : marchand@vitpay.test
  Mot de passe        : ${pw}
  (Les administrateurs enrôlent leur MFA à la première connexion avec leur jeton, valable 72 h :)
${tokens.join('\n')}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
