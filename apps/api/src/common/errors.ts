import { HttpStatus } from '@nestjs/common';

/** Erreur métier normalisée, rendue en application/problem+json (RFC 9457). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: Record<string, unknown>) =>
    new AppError('validation_error', HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid request', details),
  unauthorized: (msg = 'Authentication required') => new AppError('unauthorized', HttpStatus.UNAUTHORIZED, msg),
  forbidden: (msg = 'Forbidden') => new AppError('forbidden', HttpStatus.FORBIDDEN, msg),
  notFound: (what: string) => new AppError('not_found', HttpStatus.NOT_FOUND, `${what} not found`),
  conflict: (code: string, msg: string, details?: Record<string, unknown>) =>
    new AppError(code, HttpStatus.CONFLICT, msg, details),
  invalidState: (msg: string, details?: Record<string, unknown>) =>
    new AppError('invalid_state', HttpStatus.CONFLICT, msg, details),
  badRequest: (code: string, msg: string) => new AppError(code, HttpStatus.BAD_REQUEST, msg),
  tooMany: (msg = 'Too many attempts') => new AppError('too_many_requests', HttpStatus.TOO_MANY_REQUESTS, msg),
  legalGate: () =>
    new AppError(
      'live_payments_disabled',
      HttpStatus.FORBIDDEN,
      'Live payments are disabled until legal and regulatory validation is completed',
    ),
  provider: (msg: string, details?: Record<string, unknown>) =>
    new AppError('provider_error', HttpStatus.BAD_GATEWAY, msg, details),
};
