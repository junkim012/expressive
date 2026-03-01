import type { Strategy } from './index';
import type { CandidatePair, LendOrder, BorrowOrder } from '../types';
import { MultiPairStrategy } from './multiPair';

const MAX_CANDIDATES_FOR_EXHAUSTIVE = 12; // 2^12 = 4096 subsets

/**
 * Exhaustive strategy: tries all subsets of candidate pairs (up to 12),
 * validates per-order capacity, and picks the combination with maximum
 * total surplus. Falls back to multi-pair for larger candidate sets.
 *
 * Finds the global optimum — highest total surplus of the three strategies.
 */
export class ExhaustiveStrategy implements Strategy {
  name = 'exhaustive';

  private fallback = new MultiPairStrategy();

  select(
    candidates: CandidatePair[],
    lends: LendOrder[],
    borrows: BorrowOrder[],
  ): CandidatePair[] {
    if (candidates.length === 0) return [];

    // Fall back to multi-pair for large candidate sets
    if (candidates.length > MAX_CANDIDATES_FOR_EXHAUSTIVE) {
      return this.fallback.select(candidates, lends, borrows);
    }

    // Build capacity map
    const capacity = new Map<number, bigint>();
    for (const l of lends) {
      capacity.set(l.orderId, BigInt(l.amount) - BigInt(l.filledAmount));
    }
    for (const b of borrows) {
      capacity.set(b.orderId, BigInt(b.amount) - BigInt(b.filledAmount));
    }

    // Build fillOrKill set
    const fokOrders = new Set<number>();
    for (const b of borrows) {
      if (b.fillOrKill) fokOrders.add(b.orderId);
    }

    let bestSurplus = 0n;
    let bestSubset: CandidatePair[] = [];

    const n = candidates.length;
    const totalSubsets = 1 << n;

    for (let mask = 1; mask < totalSubsets; mask++) {
      const subset: CandidatePair[] = [];
      const used = new Map<number, bigint>();
      let surplus = 0n;
      let valid = true;

      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const p = candidates[i];

        const lendUsed = (used.get(p.lendOrderId) ?? 0n) + p.amount;
        const borrowUsed = (used.get(p.borrowOrderId) ?? 0n) + p.amount;

        const lendCap = capacity.get(p.lendOrderId) ?? 0n;
        const borrowCap = capacity.get(p.borrowOrderId) ?? 0n;

        // Check capacity
        if (lendUsed > lendCap || borrowUsed > borrowCap) {
          valid = false;
          break;
        }

        // Check fillOrKill: if this borrow is FOK, the total consumed must equal capacity
        if (fokOrders.has(p.borrowOrderId) && borrowUsed !== borrowCap) {
          // We might add more from other pairs in this subset, so defer check
        }

        used.set(p.lendOrderId, lendUsed);
        used.set(p.borrowOrderId, borrowUsed);
        surplus += p.surplus;
        subset.push(p);
      }

      if (!valid) continue;

      // Validate fillOrKill: consumed must equal full capacity
      for (const orderId of fokOrders) {
        const consumed = used.get(orderId);
        if (consumed !== undefined) {
          const cap = capacity.get(orderId) ?? 0n;
          if (consumed !== cap) {
            valid = false;
            break;
          }
        }
      }

      if (!valid) continue;

      if (surplus > bestSurplus) {
        bestSurplus = surplus;
        bestSubset = subset;
      }
    }

    return bestSubset;
  }
}
