import { hash, verify } from '@node-rs/argon2';

// Paramètres argon2id alignés sur les recommandations OWASP (m=19 MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const COMMON = new Set([
  'password1234', '123456789012', 'azertyuiop12', 'motdepasse12', 'qwertyuiop12', 'vitpay123456', 'bonjour12345',
]);

export function passwordPolicyError(pw: string, email: string): string | null {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (pw.length > 128) return 'Password must be at most 128 characters';
  if (COMMON.has(pw.toLowerCase())) return 'Password is too common';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 'Password must not contain your email';
  return null;
}

export function hashPassword(pw: string): Promise<string> {
  return hash(pw, OPTIONS);
}

export async function verifyPassword(hashed: string, pw: string): Promise<boolean> {
  try {
    return await verify(hashed, pw);
  } catch {
    return false;
  }
}

/** Hash factice pour égaliser le temps de réponse quand l'utilisateur n'existe pas. */
let dummyHash: Promise<string> | null = null;
export function dummyVerify(pw: string): Promise<boolean> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash.then((h) => verifyPassword(h, pw)).then(() => false);
}
