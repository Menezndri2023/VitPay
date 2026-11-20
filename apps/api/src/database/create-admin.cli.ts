/**
 * Création d'un administrateur de la plateforme : la SEULE voie en production (le seed y est interdit).
 *
 *   docker compose run --rm create-admin <email> "<Nom complet>" <rôle>
 *
 * - mot de passe aléatoire et jeton d'activation MFA affichés UNE SEULE FOIS, dans un terminal
 *   interactif uniquement (jamais dans un journal collecté) ;
 * - la MFA est obligatoire : l'administrateur l'active à sa première connexion avec le jeton ;
 * - refus de promouvoir un compte Business existant (AuthService.createPlatformAdmin) ;
 * - action journalisée dans l'audit (admin.created).
 */
import { randomBytes } from 'node:crypto';
import { createApp } from '../bootstrap';
import { loadConfig } from '../config';
import { AuthService } from '../modules/identity/auth.service';
import type { PlatformRole } from '../modules/identity/permissions';
import { Db } from './db.service';

const ROLES: PlatformRole[] = ['super_admin', 'admin', 'finance', 'compliance', 'support', 'technical', 'auditor'];

export function parseArgs(argv: string[]): { email: string; fullName: string; role: PlatformRole } {
  const [email, fullName, role] = argv;
  if (!email || !fullName || !role) throw new Error('Usage: create-admin <email> "<Nom complet>" <rôle>');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Adresse e-mail invalide : ${email}`);
  if (fullName.trim().length < 3) throw new Error('Nom complet trop court');
  if (!(ROLES as string[]).includes(role)) throw new Error(`Rôle inconnu : ${role}. Rôles : ${ROLES.join(', ')}`);
  return { email: email.toLowerCase(), fullName: fullName.trim(), role: role as PlatformRole };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
  if (config.appEnv !== 'local' && !process.stdout.isTTY) {
    throw new Error('Outside local, run this command in an interactive terminal (docker compose run --rm create-admin …)');
  }
  const app = await createApp(config);
  try {
    // Création uniquement : un compte existant n'est jamais modifié ici (mot de passe, rôle).
    const exists = await app.get(Db).system((tx) => tx.maybeOne('SELECT 1 FROM users WHERE lower(email) = $1', [args.email]));
    if (exists) throw new Error(`${args.email} existe déjà : aucune modification (utilisez une autre adresse)`);
    // 24 octets aléatoires ; le préfixe garantit la politique de mot de passe.
    const password = `Vp-${randomBytes(24).toString('base64url')}`;
    const r = await app.get(AuthService).createPlatformAdmin(args.email, password, args.fullName, args.role);
    console.log('\n✓ Administrateur prêt — informations affichées UNE SEULE FOIS, à remettre en main propre :');
    console.log(`  e-mail         : ${args.email}`);
    console.log(`  rôle           : ${args.role}`);
    console.log(`  mot de passe   : ${password}`);
    console.log(`  jeton MFA      : ${r.enrollmentToken}  (à saisir à la première connexion sur la console admin)`);
    console.log('');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
