import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Jeton aléatoire URL-safe. 16 octets = 128 bits d'entropie minimum. */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Trousseau de clés AES-256 : la clé courante chiffre, les clés précédentes ne servent qu'à
 * déchiffrer pendant une rotation. Chaque clé est identifiée par une empreinte courte (non secrète).
 */
export class Keyring {
  readonly currentId: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(current: Buffer, previous: Buffer[] = []) {
    for (const k of [current, ...previous]) if (k.length !== 32) throw new Error('Encryption keys must be 32 bytes');
    this.currentId = Keyring.idOf(current);
    this.keys.set(this.currentId, current);
    for (const k of previous) {
      const id = Keyring.idOf(k);
      if (id === this.currentId) throw new Error('A previous encryption key equals the current key');
      this.keys.set(id, k);
    }
  }

  static idOf(key: Buffer): string {
    return createHash('sha256').update('vitpay-key-id:').update(key).digest('hex').slice(0, 8);
  }

  /** [R5-10] Clé dérivée (HKDF) pour les empreintes de pseudonymisation : jamais la clé de chiffrement elle-même. */
  pseudonymKey(): string {
    return Buffer.from(hkdfSync('sha256', this.current, Buffer.alloc(0), 'vitpay-pseudonym-v1', 32)).toString('hex');
  }

  get current(): Buffer {
    return this.keys.get(this.currentId) as Buffer;
  }

  get(id: string): Buffer {
    const k = this.keys.get(id);
    if (!k) throw new Error(`Unknown encryption key ${id}`);
    return k;
  }

  /** Clés à essayer pour un chiffré ancien format (sans identifiant) : courante puis précédentes. */
  all(): Buffer[] {
    return [...this.keys.values()];
  }
}

type KeyInput = Buffer | Keyring;
const ring = (k: KeyInput): Keyring => (k instanceof Keyring ? k : new Keyring(k));

/** Identifiant de la clé ayant chiffré la valeur (`legacy` pour l'ancien format v1, sans identifiant). */
export function keyIdOf(payload: string | Buffer): string {
  if (typeof payload === 'string') {
    const [v, kid] = payload.split('.');
    return v === 'v2' && kid ? kid : 'legacy';
  }
  return payload[0] === 2 ? payload.subarray(1, 5).toString('hex') : 'legacy';
}

/** Chiffrement authentifié AES-256-GCM. Format : v2.<kid>.<iv>.<tag>.<ciphertext> (base64url ; kid en hexadécimal). */
export function encrypt(plaintext: string, key: KeyInput): string {
  const r = ring(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', r.current, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v2', r.currentId, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

function gcmOpen(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Essaie chaque clé (format sans identifiant) : l'authentification GCM rejette les mauvaises clés. */
function openWithAny(keys: Buffer[], iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  for (const k of keys) {
    try {
      return gcmOpen(k, iv, tag, ct);
    } catch {
      /* clé suivante */
    }
  }
  throw new Error('Unable to decrypt with any configured key');
}

export function decrypt(payload: string, key: KeyInput): string {
  const r = ring(key);
  const parts = payload.split('.');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, ct] = parts as [string, string, string, string, string];
    return gcmOpen(r.get(kid), Buffer.from(iv, 'base64url'), Buffer.from(tag, 'base64url'), Buffer.from(ct, 'base64url')).toString('utf8');
  }
  const [v, iv, tag, ct] = parts;
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
  return openWithAny(r.all(), Buffer.from(iv, 'base64url'), Buffer.from(tag, 'base64url'), Buffer.from(ct, 'base64url')).toString('utf8');
}

/** JSON canonique (clés triées) pour un hachage stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.keys(v as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  if (typeof v === 'bigint') return v.toString();
  return v;
}

/** Chiffrement binaire AES-256-GCM : [version 2 | kid 4 | iv 12 | tag 16 | ciphertext] (v1 : sans kid). */
export function encryptBytes(plain: Buffer, key: KeyInput): Buffer {
  const r = ring(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', r.current, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([2]), Buffer.from(r.currentId, 'hex'), iv, cipher.getAuthTag(), ct]);
}

export function decryptBytes(payload: Buffer, key: KeyInput): Buffer {
  const r = ring(key);
  if (payload[0] === 2 && payload.length >= 33) {
    return gcmOpen(r.get(payload.subarray(1, 5).toString('hex')), payload.subarray(5, 17), payload.subarray(17, 33), payload.subarray(33));
  }
  if (payload[0] !== 1 || payload.length < 29) throw new Error('Unsupported ciphertext format');
  return openWithAny(r.all(), payload.subarray(1, 13), payload.subarray(13, 29), payload.subarray(29));
}
