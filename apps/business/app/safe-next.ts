/**
 * Destination interne après connexion. Résolution par l'API URL (et non par comparaison de chaînes) :
 * `/%09/evil.com`, `/\evil.com`, `//evil.com`… donnent une autre origine et sont refusés.
 */
export function safeNext(next: string | null, fallback = '/app'): string {
  if (!next) return fallback;
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin !== window.location.origin) return fallback;
    return `${u.pathname}${u.search}`;
  } catch {
    return fallback;
  }
}
