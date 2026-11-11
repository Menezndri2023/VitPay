import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money } from '@vitpay/money';
import { disputeClosedEntry, disputeOpenedEntry, paymentSucceededEntry, refundSucceededEntry, settlementEntry } from './posting-rules';
import { EntryInput } from './ledger.service';

function balanced(e: EntryInput): boolean {
  let sum = 0n;
  for (const p of e.postings) sum += p.direction === 'debit' ? p.amount.minor : -p.amount.minor;
  return sum === 0n;
}

describe('règles comptables', () => {
  it('toutes les règles produisent des écritures équilibrées (propriété)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.bigInt({ min: 0n, max: 10n ** 6n }), fc.bigInt({ min: 0n, max: 10n ** 6n }), (a, f, v) => {
        const m = (x: bigint) => Money.of(x, 'MAD');
        const orgId = 'o';
        for (const e of [
          paymentSucceededEntry({ orgId, attemptId: 'a', amount: m(a), providerFee: m(f), vitpayFee: m(v) }),
          refundSucceededEntry({ orgId, refundId: 'r', amount: m(a) }),
          disputeOpenedEntry({ orgId, disputeId: 'd', amount: m(a) }),
          disputeClosedEntry({ orgId, disputeId: 'd', amount: m(a), outcome: 'won' }),
          disputeClosedEntry({ orgId, disputeId: 'd', amount: m(a), outcome: 'lost' }),
          settlementEntry({ orgId, attemptId: 'a', settlementRef: 's', net: m(a) }),
        ]) {
          expect(balanced(e)).toBe(true);
        }
      }),
    );
  });

  it('les clés d’idempotence sont dérivées de l’objet métier', () => {
    const e = paymentSucceededEntry({ orgId: 'o', attemptId: 'att-1', amount: Money.of(1n, 'MAD'), providerFee: Money.of(0n, 'MAD'), vitpayFee: Money.of(0n, 'MAD') });
    expect(e.idempotencyKey).toBe('payment.succeeded:att-1');
  });
});
