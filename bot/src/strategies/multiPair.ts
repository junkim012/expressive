import type { Strategy } from './index';
import type { CandidatePair, LendOrder, BorrowOrder } from '../types';

/**
 * Multi-pair strategy: greedily accumulates non-conflicting pairs
 * sorted by surplus descending, tracking per-order remaining capacity.
 * Captures more total surplus than single-pair greedy.
 */
export class MultiPairStrategy implements Strategy {
  name = 'multi-pair';

  select(
    candidates: CandidatePair[],
    lends: LendOrder[],
    borrows: BorrowOrder[],
  ): CandidatePair[] {
    if (candidates.length === 0) return [];

    // Track remaining capacity per order
    const remaining = new Map<number, bigint>();
    for (const l of lends) {
      remaining.set(l.orderId, BigInt(l.amount) - BigInt(l.filledAmount));
    }
    for (const b of borrows) {
      remaining.set(b.orderId, BigInt(b.amount) - BigInt(b.filledAmount));
    }

    const selected: CandidatePair[] = [];

    // candidates are pre-sorted by surplus descending
    for (const pair of candidates) {
      const lendRemaining = remaining.get(pair.lendOrderId) ?? 0n;
      const borrowRemaining = remaining.get(pair.borrowOrderId) ?? 0n;

      if (lendRemaining <= 0n || borrowRemaining <= 0n) continue;

      // Determine how much we can actually match given prior selections
      const amount = lendRemaining < borrowRemaining ? lendRemaining : borrowRemaining;
      if (amount <= 0n) continue;

      // Check fillOrKill: if the borrow order requires full fill, amount must match remaining
      const borrow = borrows.find((b) => b.orderId === pair.borrowOrderId);
      if (borrow?.fillOrKill && amount !== borrowRemaining) continue;

      const surplus = BigInt(pair.borrowRate - pair.lendRate) * amount;

      selected.push({
        ...pair,
        amount,
        surplus,
      });

      // Deduct capacity
      remaining.set(pair.lendOrderId, lendRemaining - amount);
      remaining.set(pair.borrowOrderId, borrowRemaining - amount);
    }

    return selected;
  }
}
