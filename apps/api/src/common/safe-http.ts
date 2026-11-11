import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Appels HTTP sortants vers des URL fournies par les clients (webhooks) — protection SSRF.
 * Le contrôle des adresses est fait AU MOMENT DE LA CONNEXION (lookup personnalisé) : une
 * réponse DNS piégée (DNS rebinding) ne peut pas viser le réseau interne.
 */

/**
 * Plages interdites. `net.BlockList` normalise les formes IPv6 (y compris `::ffff:7f00:1`,
 * réécriture du parseur d'URL) et applique les règles IPv4 aux adresses IPv4-mappées.
 * Les plages IPv6 encapsulant de l'IPv4 (NAT64, 6to4, compatible, mappée) sont refusées en bloc.
 */
// Deux listes : Node applique les règles IPv6 aux adresses IPv4 (forme mappée) — une règle
// `::ffff:0:0/96` dans la liste IPv4 bloquerait donc TOUTES les adresses IPv4.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED_V4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) BLOCKED_V6.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true; // inconnu = refusé
  if (v === 4) return BLOCKED_V4.check(ip, 'ipv4');
  // IPv6 : plages IPv4 privées sous forme mappée + plages IPv6 spéciales (dont toute adresse mappée/NAT64/6to4).
  return BLOCKED_V4.check(ip, 'ipv6') || BLOCKED_V6.check(ip, 'ipv6');
}

/** Hôte d'URL sous forme d'adresse IP littérale (crochets IPv6 retirés), ou null. */
function ipLiteral(hostname: string): string | null {
  const h = hostname.replace(/^\[|\]$/g, '');
  return isIP(h) ? h : null;
}

export class UnsafeUrlError extends Error {}

/** Validation syntaxique d'une URL de webhook (à l'enregistrement). */
export function validateWebhookUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URL are not allowed');
  if (!allowPrivate && url.protocol !== 'https:') throw new UnsafeUrlError('HTTPS is required');
  if (allowPrivate && url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeUrlError('HTTP(S) only');
  const literal = ipLiteral(url.hostname);
  if (!allowPrivate && literal && isPrivateAddress(literal)) throw new UnsafeUrlError('Private addresses are not allowed');
  return url;
}

export function createSafeAgent(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      timeout: 5_000,
      lookup: (hostname, options, callback) => {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return callback(err, [] as unknown as string, 4);
          const list = (addresses as unknown as LookupAddress[]) ?? [];
          if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
            return callback(new UnsafeUrlError(`Blocked private address for ${hostname}`), [] as unknown as string, 4);
          }
          if ((options as { all?: boolean }).all) return callback(null, list as unknown as string, 4);
          const first = list[0];
          if (!first) return callback(new Error('No address'), [] as unknown as string, 4);
          return callback(null, first.address, first.family);
        });
      },
    },
  });
}

/**
 * Envoi d'un webhook. Pour une IP littérale, Node ne passe pas par le `lookup` de l'agent :
 * l'adresse est donc revérifiée ICI, à chaque envoi.
 */
export async function safePost(agent: Agent, url: string, body: string, headers: Record<string, string>, allowPrivate = false): Promise<{ status: number }> {
  validateWebhookUrl(url, allowPrivate);
  const res = await undiciFetch(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'user-agent': 'VITPAY-Webhooks/1.0', ...headers },
    redirect: 'manual', // aucune redirection suivie
    dispatcher: agent,
    signal: AbortSignal.timeout(5_000),
  });
  await res.body?.cancel().catch(() => undefined); // la réponse n'est pas lue
  return { status: res.status };
}

/** Catégorie d'erreur exposée au commerçant (jamais le message brut : pas de cartographie du réseau). */
export function errorCategory(e: unknown): string {
  const err = e as Error & { cause?: Error & { code?: string } };
  const text = `${err?.message ?? ''} ${err?.cause?.message ?? ''} ${err?.cause?.code ?? ''}`;
  if (err instanceof UnsafeUrlError || err?.cause instanceof UnsafeUrlError || /Blocked private address|Private addresses/.test(text)) return 'blocked_address';
  if (/timeout|aborted|UND_ERR_CONNECT_TIMEOUT/i.test(text)) return 'timeout';
  if (/certificate|TLS|SSL|CERT/i.test(text)) return 'tls_error';
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return 'dns_error';
  return 'connection_failed';
}
