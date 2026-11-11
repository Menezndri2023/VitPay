/**
 * @vitpay/money — représentation monétaire stricte de VITPAY.
 *
 * Règles (voir docs/FINANCIAL_CORE.md) :
 *  - Les montants sont des entiers en unité mineure (bigint). Jamais de float.
 *  - La devise accompagne toujours le montant.
 *  - Toute opération entre devises différentes lève une erreur.
 *  - L'exposant dépend de la devise (XOF/XAF = 0, MAD/EUR/USD/GBP = 2).
 */

export const CURRENCIES = {
  MAD: { code: 'MAD', exponent: 2 },
  EUR: { code: 'EUR', exponent: 2 },
  USD: { code: 'USD', exponent: 2 },
  GBP: { code: 'GBP', exponent: 2 },
  XOF: { code: 'XOF', exponent: 0 },
  XAF: { code: 'XAF', exponent: 0 },
} as const;

export type Currency = keyof typeof CURRENCIES;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES) as Currency[];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function exponentOf(currency: Currency): number {
  return CURRENCIES[currency].exponent;
}

export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'DOWN' | 'UP';

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

/** Division entière de a par b (b > 0) avec arrondi explicite. */
export function divRound(a: bigint, b: bigint, mode: RoundingMode): bigint {
  if (b <= 0n) throw new InvalidAmountError('Divisor must be positive');
  const negative = a < 0n;
  const absA = negative ? -a : a;
  let q = absA / b;
  const r = absA % b;
  if (r !== 0n) {
    const twice = r * 2n;
    switch (mode) {
      case 'DOWN':
        break;
      case 'UP':
        q += 1n;
        break;
      case 'HALF_UP':
        if (twice >= b) q += 1n;
        break;
      case 'HALF_EVEN':
        if (twice > b || (twice === b && q % 2n === 1n)) q += 1n;
        break;
    }
  }
  return negative ? -q : q;
}

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: Currency,
  ) {}

  static of(minor: bigint | number | string, currency: Currency): Money {
    if (!isCurrency(currency)) throw new InvalidAmountError(`Unsupported currency: ${String(currency)}`);
    let value: bigint;
    if (typeof minor === 'bigint') value = minor;
    else if (typeof minor === 'number') {
      if (!Number.isSafeInteger(minor)) throw new InvalidAmountError('Minor amount must be a safe integer');
      value = BigInt(minor);
    } else {
      if (!/^-?\d+$/.test(minor)) throw new InvalidAmountError('Minor amount must be an integer string');
      value = BigInt(minor);
    }
    return new Money(value, currency);
  }

  static zero(currency: Currency): Money {
    return Money.of(0n, currency);
  }

  /**
   * Parse un montant décimal saisi par un humain ("500", "500.5", "500.50").
   * Refuse les décimales excédentaires plutôt que d'arrondir silencieusement.
   */
  static fromMajor(input: string, currency: Currency): Money {
    if (!isCurrency(currency)) throw new InvalidAmountError(`Unsupported currency: ${String(currency)}`);
    const exp = exponentOf(currency);
    const normalized = input.trim().replace(',', '.');
    const re = exp === 0 ? /^(-?)(\d+)$/ : new RegExp(`^(-?)(\\d+)(?:\\.(\\d{1,${exp}}))?$`);
    const m = re.exec(normalized);
    if (!m) throw new InvalidAmountError(`Invalid amount "${input}" for ${currency} (max ${exp} decimals)`);
    const sign = m[1] === '-' ? -1n : 1n;
    const intPart = BigInt(m[2] ?? '0');
    const frac = (m[3] ?? '').padEnd(exp, '0');
    const fracPart = exp === 0 ? 0n : BigInt(frac || '0');
    return new Money(sign * (intPart * 10n ** BigInt(exp) + fracPart), currency);
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) throw new CurrencyMismatchError(this.currency, other.currency);
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSame(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  /** Applique un taux en points de base (1 bp = 0,01 %). */
  percentBps(bps: number | bigint, mode: RoundingMode = 'HALF_EVEN'): Money {
    const b = typeof bps === 'bigint' ? bps : BigInt(bps);
    if (typeof bps === 'number' && !Number.isInteger(bps)) throw new InvalidAmountError('bps must be an integer');
    return new Money(divRound(this.minor * b, 10_000n, mode), this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSame(other);
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** Représentation décimale exacte, ex. "500.00". */
  toMajorString(): string {
    const exp = exponentOf(this.currency);
    const negative = this.minor < 0n;
    const abs = negative ? -this.minor : this.minor;
    if (exp === 0) return `${negative ? '-' : ''}${abs.toString()}`;
    const s = abs.toString().padStart(exp + 1, '0');
    return `${negative ? '-' : ''}${s.slice(0, -exp)}.${s.slice(-exp)}`;
  }

  /** Format localisé pour affichage uniquement (jamais pour calcul). */
  format(locale = 'fr-MA'): string {
    return formatMinor(this.minor, this.currency, locale);
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.minor.toString(), currency: this.currency };
  }
}

/**
 * Formatage d'affichage. Utilise Intl avec une chaîne décimale exacte
 * (pas de conversion intermédiaire en Number pour les grands montants).
 */
export function formatMinor(minor: bigint | string, currency: Currency, locale = 'fr-MA'): string {
  const m = Money.of(typeof minor === 'string' ? minor : minor, currency);
  const major = m.toMajorString();
  const exp = exponentOf(currency);
  try {
    // Intl accepte les chaînes décimales (Intl.NumberFormat v3) : précision préservée.
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major as unknown as number);
  } catch {
    return `${major} ${currency}`;
  }
}
