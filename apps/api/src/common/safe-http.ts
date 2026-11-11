import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Appels HTTP sortants vers des URL fournies par les clients (webhooks) — protection SSRF.
 * Le contrôle des adresses est fait AU MOMENT DE LA CONNEXION (lookup personnalisé) : une
 * réponse DNS piégée (DNS rebinding) ne peut pas viser le réseau interne.
 */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => (n & (~0 << (32 - bits))) >>> 0 === (ipv4ToInt(base) & (~0 << (32 - bits))) >>> 0);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
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
  if (!allowPrivate && isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new UnsafeUrlError('Private addresses are not allowed');
  }
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

export async function safePost(agent: Agent, url: string, body: string, headers: Record<string, string>): Promise<{ status: number }> {
  const res = await undiciFetch(url, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'user-agent': 'VITPAY-Webhooks/1.0', ...headers },
    redirect: 'manual', // aucune redirection suivie
    dispatcher: agent,
    signal: AbortSignal.timeout(10_000),
  });
  await res.body?.cancel().catch(() => undefined); // la réponse n'est pas lue
  return { status: res.status };
}
