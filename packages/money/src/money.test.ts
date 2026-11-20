import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CurrencyMismatchError, divRound, InvalidAmountError, Money } from './index';

describe('Money', () => {
  it('parse les montants majeurs selon l’exposant de la devise', () => {
    expect(Money.fromMajor('500', 'MAD').minor).toBe(50000n);
    expect(Money.fromMajor('500.5', 'MAD').minor).toBe(50050n);
    expect(Money.fromMajor('500,05', 'MAD').minor).toBe(50005n);
    expect(Money.fromMajor('1500', 'XOF').minor).toBe(1500n);
  });

  it('refuse les décimales excédentaires au lieu d’arrondir', () => {
    expect(() => Money.fromMajor('1.005', 'MAD')).toThrow(InvalidAmountError);
    expect(() => Money.fromMajor('10.5', 'XOF')).toThrow(InvalidAmountError);
    expect(() => Money.fromMajor('1e3', 'MAD')).toThrow(InvalidAmountError);
    expect(() => Money.fromMajor('', 'MAD')).toThrow(InvalidAmountError);
  });

  it('refuse les nombres non entiers en unité mineure', () => {
    expect(() => Money.of(1.5, 'MAD')).toThrow(InvalidAmountError);
    expect(() => Money.of('12.3', 'MAD')).toThrow(InvalidAmountError);
  });

  it('interdit les opérations entre devises', () => {
    expect(() => Money.of(1n, 'MAD').add(Money.of(1n, 'EUR'))).toThrow(CurrencyMismatchError);
  });

  it('représentation décimale exacte', () => {
    expect(Money.of(5n, 'MAD').toMajorString()).toBe('0.05');
    expect(Money.of(-12345n, 'EUR').toMajorString()).toBe('-123.45');
    expect(Money.of(700n, 'XAF').toMajorString()).toBe('700');
    expect(Money.of(10n ** 20n, 'MAD').toMajorString()).toBe('1000000000000000000.00');
  });

  it('frais en points de base avec arrondi bancaire', () => {
    // 1,5 % de 500,00 MAD = 7,50 MAD
    expect(Money.fromMajor('500', 'MAD').percentBps(150).minor).toBe(750n);
    // 2,5 % de 1,00 = 2,5 centimes → arrondi demi-pair → 2
    expect(Money.of(100n, 'MAD').percentBps(250).minor).toBe(2n);
    expect(Money.of(100n, 'MAD').percentBps(250, 'HALF_UP').minor).toBe(3n);
  });

  it('propriété : fromMajor(toMajorString(x)) == x', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.constantFrom('MAD', 'XOF', 'EUR' as const), (n, c) => {
        const m = Money.of(n, c);
        expect(Money.fromMajor(m.toMajorString(), c).equals(m)).toBe(true);
      }),
    );
  });

  it('propriété : l’addition est commutative et a - b + b == a', () => {
    fc.assert(
      fc.property(fc.bigInt(), fc.bigInt(), (a, b) => {
        const x = Money.of(a, 'MAD');
        const y = Money.of(b, 'MAD');
        expect(x.add(y).equals(y.add(x))).toBe(true);
        expect(x.subtract(y).add(y).equals(x)).toBe(true);
      }),
    );
  });

  it('propriété : divRound reste à moins d’une unité du quotient exact', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (a, b) => {
        for (const mode of ['HALF_EVEN', 'HALF_UP', 'DOWN', 'UP'] as const) {
          const q = divRound(a, b, mode);
          const diff = q * b - a;
          expect(diff < b && diff > -b).toBe(true);
        }
      }),
    );
  });
});
