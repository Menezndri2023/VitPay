import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';

/** Répertoire de travail des vidéos (clips audio, repères, vidéos brutes). */
export const DEMO_OUT = process.env.DEMO_OUT ?? `${__dirname}/../test-results/demo-out`;
const VOICE = process.env.DEMO_VOICE ?? 'Thomas';
const RATE = process.env.DEMO_RATE ?? '178';

type Cue = { t: number; file: string; text: string };

/**
 * Voix off synchronisée : chaque étape génère son clip (`say`), note l'instant où il démarre
 * par rapport au début de la vidéo, affiche le sous-titre et dure au moins le temps du clip.
 * assemble.sh place ensuite chaque clip à son instant exact sur la vidéo.
 */
export class Narrator {
  private readonly t0 = Date.now();
  private readonly cues: Cue[] = [];
  private n = 0;
  private caption = '';

  constructor(private readonly page: Page, private readonly name: string) {
    mkdirSync(`${DEMO_OUT}/${name}`, { recursive: true });
  }

  /** Dit `text` pendant que `action` s'exécute ; attend la fin de la phrase et de l'action. */
  async step(text: string, action?: () => Promise<unknown>): Promise<void> {
    const file = `${DEMO_OUT}/${this.name}/${String(++this.n).padStart(2, '0')}.aiff`;
    execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', file, text]);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
    const start = Date.now();
    this.cues.push({ t: (start - this.t0) / 1000, file, text });
    this.caption = text;
    await this.show();
    if (action) await action();
    await this.show(); // une navigation pendant l'action efface le sous-titre
    const left = duration * 1000 + 450 - (Date.now() - start);
    if (left > 0) await this.page.waitForTimeout(left);
  }

  /** Écran-titre plein cadre (début et fin de vidéo). */
  async title(heading: string, sub: string): Promise<void> {
    await this.page.setContent(`<!doctype html><html lang="fr"><body style="margin:0;height:100vh;display:grid;place-items:center;
      background:linear-gradient(135deg,#0b3d2e,#14532d);color:#fff;font-family:-apple-system,Segoe UI,sans-serif">
      <div style="text-align:center;max-width:900px;padding:0 40px">
      <div style="letter-spacing:.3em;font-size:18px;opacity:.75">VITPAY · ENVIRONNEMENT DE TEST</div>
      <h1 style="font-size:52px;margin:18px 0 14px">${heading}</h1>
      <p style="font-size:24px;opacity:.85;line-height:1.4">${sub}</p></div></body></html>`);
  }

  private async show(): Promise<void> {
    await this.page
      .evaluate((text) => {
        let el = document.getElementById('__vp_caption');
        if (!el) {
          el = document.createElement('div');
          el.id = '__vp_caption';
          el.setAttribute('aria-hidden', 'true');
          el.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:86%;z-index:2147483647;' +
            'background:rgba(10,20,15,.86);color:#fff;font:600 19px/1.4 -apple-system,Segoe UI,sans-serif;padding:10px 18px;' +
            'border-radius:10px;pointer-events:none;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.25)';
          document.documentElement.appendChild(el);
        }
        el.textContent = text;
      }, this.caption)
      .catch(() => undefined); // page en cours de navigation : réaffiché à l'étape suivante
  }

  /** Écrit les repères (vidéo + clips) pour assemble.sh. À appeler en fin de test. */
  async save(testInfo: TestInfo): Promise<void> {
    await this.page.waitForTimeout(800);
    // Chemin définitif : Playwright y déplace la vidéo à la fermeture du contexte.
    const video = `${testInfo.outputDir}/video.webm`;
    writeFileSync(`${DEMO_OUT}/${this.name}/cues.json`, JSON.stringify({ title: testInfo.title, video, cues: this.cues }, null, 2));
  }
}
