import { describe, expect, it } from 'vitest';
import {
  deriveDisplayStatus,
  DisputeMachine,
  IllegalTransitionError,
  PaymentAttemptMachine,
  PaymentRequestMachine,
  RefundMachine,
} from './state-machines';

describe('machines à états', () => {
  it('une tentative confirmée est terminale', () => {
    for (const to of PaymentAttemptMachine.states) {
      expect(PaymentAttemptMachine.canTransition('succeeded', to)).toBe(false);
    }
  });

  it('les états d’échec sont terminaux (pas de retour silencieux en succès)', () => {
    for (const s of ['failed', 'cancelled', 'expired'] as const) {
      expect(PaymentAttemptMachine.isTerminal(s)).toBe(true);
      expect(() => PaymentAttemptMachine.assertTransition(s, 'succeeded')).toThrow(IllegalTransitionError);
    }
  });

  it('un paiement en cours de traitement ne peut pas expirer côté VITPAY', () => {
    expect(PaymentAttemptMachine.canTransition('processing', 'expired')).toBe(false);
  });

  it('chaque transition déclarée cible un état connu', () => {
    for (const m of [PaymentAttemptMachine, PaymentRequestMachine, RefundMachine, DisputeMachine]) {
      const states = new Set<string>(m.states);
      for (const [, targets] of Object.entries(m.transitions as Record<string, readonly string[]>)) {
        for (const t of targets) expect(states.has(t)).toBe(true);
      }
    }
  });

  it('chaque état non terminal peut atteindre un état terminal', () => {
    for (const m of [PaymentAttemptMachine, PaymentRequestMachine, RefundMachine, DisputeMachine]) {
      const t = m.transitions as Record<string, readonly string[]>;
      for (const start of m.states as string[]) {
        const seen = new Set<string>();
        const stack = [start];
        let reachesTerminal = false;
        while (stack.length) {
          const s = stack.pop() as string;
          if (seen.has(s)) continue;
          seen.add(s);
          if ((t[s] ?? []).length === 0) reachesTerminal = true;
          stack.push(...(t[s] ?? []));
        }
        expect(reachesTerminal).toBe(true);
      }
    }
  });

  it('une demande payée ne peut plus changer d’état', () => {
    expect(PaymentRequestMachine.isTerminal('paid')).toBe(true);
    expect(PaymentRequestMachine.canTransition('expired', 'paid')).toBe(true);
    expect(PaymentRequestMachine.canTransition('expired', 'open')).toBe(false);
  });

  it('statut affiché dérivé', () => {
    const base = { status: 'paid' as const, paidAmountMinor: 1000n, refundedMinor: 0n, openDispute: false };
    expect(deriveDisplayStatus(base)).toBe('paid');
    expect(deriveDisplayStatus({ ...base, refundedMinor: 10n })).toBe('partially_refunded');
    expect(deriveDisplayStatus({ ...base, refundedMinor: 1000n })).toBe('refunded');
    expect(deriveDisplayStatus({ ...base, openDispute: true })).toBe('disputed');
    expect(deriveDisplayStatus({ ...base, status: 'open' })).toBe('open');
  });
});
