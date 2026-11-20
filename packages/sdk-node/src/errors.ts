/** Erreur renvoyée par l'API VITPAY (corps application/problem+json). */
export class VitPayError extends Error {
  readonly status: number;
  /** Code stable, ex. `validation_error`, `not_found`, `merchant_reference_exists`. */
  readonly code: string;
  readonly details?: Record<string, unknown>;
  /** À communiquer au support VITPAY pour retrouver la requête. */
  readonly requestId?: string;

  constructor(init: { status: number; code: string; message: string; details?: Record<string, unknown>; requestId?: string }) {
    super(init.message);
    this.name = 'VitPayError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

/** Échec réseau ou délai dépassé : la requête a pu, ou non, être traitée. Réessayez avec la même clé d'idempotence. */
export class VitPayConnectionError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'VitPayConnectionError';
  }
}

/** Signature de webhook absente, invalide ou trop ancienne : rejetez la requête (HTTP 400). */
export class VitPaySignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VitPaySignatureError';
  }
}
