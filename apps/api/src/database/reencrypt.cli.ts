import { createApp } from '../bootstrap';
import { loadConfig } from '../config';
import { KeyRotationService } from '../modules/security/key-rotation.service';

/** Rechiffrement avec la clé courante (`--status` : décompte seul). Aucune valeur déchiffrée n'est affichée. */
async function main() {
  const config = loadConfig({ ...process.env, WORKERS_ENABLED: 'false' });
  const app = await createApp(config);
  try {
    const svc = app.get(KeyRotationService);
    if (process.argv.includes('--status')) {
      const s = await svc.status();
      console.log(`Clé courante : ${config.encryptionKey.currentId}\nValeurs à rechiffrer :`, s);
      process.exitCode = Object.values(s).some((n) => n > 0) ? 2 : 0;
    } else {
      const report = await svc.reencryptAll();
      console.log('Rapport :', report);
      const left = await svc.status();
      console.log('Restantes :', left);
      process.exitCode = Object.values(report).some((r) => r.failed > 0) || Object.values(left).some((n) => n > 0) ? 2 : 0;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
