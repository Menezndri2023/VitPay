/** Client HTTP partagé. Les apps proxifient `/api/*` vers l'API VITPAY (même origine : cookies httpOnly). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

/** Messages en français pour les refus que l'utilisateur peut corriger lui-même. */
const FRIENDLY: Record<string, string> = {
  email_not_verified: 'Confirmez d’abord votre adresse e-mail avec le lien reçu.',
  kyb_required: 'Votre dossier KYB doit être vérifié avant d’inviter des collaborateurs.',
  terminal_busy: 'Le TPE affiche déjà un autre encaissement.',
  too_many_requests: 'Trop de tentatives. Patientez une minute puis réessayez.',
  unauthorized: 'Votre session a expiré. Reconnectez-vous.',
  forbidden: 'Votre rôle ne permet pas cette action. Demandez-la à un administrateur de l’organisation.',
  provider_error: 'Le prestataire de paiement ne répond pas. Réessayez dans quelques minutes.',
  provider_rejected: 'Le prestataire de paiement a refusé ces informations. Vérifiez les clés saisies (mode test).',
  validation_error: 'Certaines informations sont invalides. Vérifiez le formulaire.',
  account_exists: 'Un compte existe déjà avec cette adresse : connectez-vous pour accepter l’invitation.',
  already_member: 'Cette personne fait déjà partie de l’équipe.',
  invitation_pending: 'Une invitation est déjà en attente pour cette adresse.',
  merchant_reference_exists: 'Une demande existe déjà pour cette référence de commande.',
  provider_already_connected: 'Ce prestataire est déjà connecté dans ce mode.',
  attempt_in_progress: 'Un paiement est déjà en cours pour cette demande.',
  idempotency_in_progress: 'L’opération précédente est encore en cours. Patientez quelques secondes.',
  live_payments_disabled: 'Les paiements réels ne sont pas encore ouverts sur VITPAY.',
  currency_not_supported: 'Ce prestataire n’accepte que le dirham (MAD).',
  invalid_credentials: 'E-mail ou mot de passe incorrect.',
  invalid_mfa_code: 'Code de vérification incorrect.',
};

/**
 * L'API publique répond en anglais (destinée aux développeurs). Les espaces VITPAY affichent
 * l'équivalent français des refus métier courants ; à défaut, le message d'origine.
 */
const STATE_FR: [RegExp, string][] = [
  [/no longer payable/i, 'Cette demande n’est plus payable.'],
  [/^Cannot cancel a (paid|expired|cancelled) request/i, 'Cette demande ne peut plus être annulée.'],
  [/payment is in progress for this request/i, 'Un paiement est en cours sur cette demande : elle ne peut pas être annulée pour l’instant.'],
  [/No active (live )?payment provider account/i, 'Connectez d’abord un prestataire de paiement (Paramètres → Prestataires).'],
  [/Refund exceeds the refundable amount/i, 'Le montant dépasse ce qui reste remboursable sur ce paiement.'],
  [/Only confirmed payments can be refunded|Payment not refundable/i, 'Seul un paiement confirmé peut être remboursé.'],
  [/Partial refunds are not supported/i, 'Ce prestataire n’accepte que les remboursements du montant total.'],
  [/not support refunds|Refunds through YouCan Pay are not enabled/i, 'Les remboursements via ce prestataire se font pour l’instant depuis son propre espace.'],
  [/A dispute is open on this payment/i, 'Un litige est ouvert sur ce paiement : remboursement impossible pour l’instant.'],
  [/Organization is (suspended|closed)/i, 'Votre organisation est suspendue. Contactez le support VITPAY.'],
  [/KYB already verified/i, 'Dossier déjà vérifié : contactez le support pour modifier les informations légales.'],
  [/KYB must be verified/i, 'Le dossier KYB doit être vérifié avant de connecter un compte réel.'],
  [/Document limit reached/i, 'Nombre maximal de documents atteint (30).'],
  [/Live API keys are not available yet/i, 'Les clés réelles seront disponibles à l’ouverture des paiements réels.'],
  [/Live payments are not enabled/i, 'Les paiements réels ne sont pas encore ouverts.'],
  [/Maximum 10 active endpoints/i, 'Maximum 10 adresses de webhook actives.'],
  [/The owner cannot be removed/i, 'Le propriétaire de l’organisation ne peut pas être retiré.'],
  [/Terminal offline/i, 'Le TPE est hors ligne.'],
  [/Connect the sandbox provider first/i, 'Connectez d’abord le prestataire simulé.'],
  [/Email already verified/i, 'Adresse déjà confirmée.'],
  [/This beneficiary cannot receive payments/i, 'Ce bénéficiaire ne peut pas recevoir de paiement pour le moment.'],
  [/This payment method is not available/i, 'Ce moyen de paiement n’est pas disponible pour cette demande.'],
  [/still checking this terminal payment/i, 'VITPAY vérifie encore ce paiement TPE : réessayez dans une minute.'],
  [/already exists|duplicate/i, 'Cet élément existe déjà.'],
  [/not found$/i, 'Élément introuvable : il a peut-être été supprimé.'],
];

export function messageFr(code: string, message: string): string {
  if (FRIENDLY[code] && code !== 'validation_error' && code !== 'provider_rejected') return FRIENDLY[code];
  for (const [re, fr] of STATE_FR) if (re.test(message)) return fr;
  return FRIENDLY[code] ?? message;
}

/** Message à afficher pour une erreur quelconque (réseau compris). */
export function errorText(e: unknown, fallback = 'L’opération n’a pas abouti. Réessayez.'): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof TypeError) return 'Connexion impossible. Vérifiez votre accès à Internet puis réessayez.';
  return fallback;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-vitpay-csrf': '1' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const p = (typeof data === 'object' && data) || {};
    const code = (p as { code?: string }).code ?? 'error';
    throw new ApiError(res.status, code, messageFr(code, (p as { title?: string }).title ?? res.statusText), (p as { details?: unknown }).details);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface MoneyView {
  minor: string;
  value: string;
  currency: string;
}

/** Affichage localisé à partir de la chaîne décimale exacte fournie par l'API. */
export function formatMoney(m: MoneyView | null | undefined, locale = 'fr-MA'): string {
  if (!m) return '—';
  const decimals = m.value.includes('.') ? (m.value.split('.')[1]?.length ?? 0) : 0;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
      m.value as unknown as number,
    );
  } catch {
    return `${m.value} ${m.currency}`;
  }
}

export function formatDate(iso: string | null | undefined, locale = 'fr-MA'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
