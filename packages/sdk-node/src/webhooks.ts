import { createHmac, timingSafeEqual } from 'node:crypto';
import { VitPaySignatureError } from './errors';
import type { WebhookEvent } from './types';

export const DEFAULT_TOLERANCE_SEC = 300;

/**
 * Vérifie l'en-tête `VitPay-Signature` (`t=…,v1=…[,v1=…]`) sur le CORPS BRUT, puis renvoie
 * l'événement. Pendant une rotation de secret, l'en-tête contient plusieurs v1 : une seule doit
 * correspondre. Lève `VitPaySignatureError` sinon.
 *
 * @param rawBody  corps exact reçu (Buffer ou chaîne), AVANT tout parsing JSON
 * @param header   valeur de l'en-tête `VitPay-Signature`
 * @param secret   secret `whsec_…` de l'endpoint (un tableau est accepté pendant votre propre déploiement)
 */
export function constructEvent<T = Record<string, unknown>>(
  rawBody: string | Buffer,
  header: string | string[] | undefined,
  secret: string | string[],
  opts: { toleranceSec?: number; now?: () => number } = {},
): WebhookEvent<T> {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new VitPaySignatureError('Missing VitPay-Signature header');
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
  if (!secrets.length) throw new VitPaySignatureError('No webhook secret configured');

  let t: string | undefined;
  const signatures: Buffer[] = [];
  for (const part of value.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(Buffer.from(v, 'hex'));
  }
  if (!t || !/^\d+$/.test(t) || !signatures.length) throw new VitPaySignatureError('Malformed VitPay-Signature header');

  const tolerance = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (tolerance > 0 && Math.abs(nowSec - Number(t)) > tolerance) throw new VitPaySignatureError('Webhook timestamp outside the tolerance window (replay?)');

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const ok = secrets.some((s) => {
    const expected = createHmac('sha256', s).update(`${t}.${body}`).digest();
    return signatures.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  });
  if (!ok) throw new VitPaySignatureError('Invalid webhook signature');

  try {
    return JSON.parse(body) as WebhookEvent<T>;
  } catch {
    throw new VitPaySignatureError('Webhook body is not valid JSON');
  }
}

/** Produit un en-tête signé, pour vos tests automatisés (ne l'utilisez jamais en production). */
export function generateTestHeader(payload: string, secret: string, timestampSec = Math.floor(Date.now() / 1000)): string {
  return `t=${timestampSec},v1=${createHmac('sha256', secret).update(`${timestampSec}.${payload}`).digest('hex')}`;
}
