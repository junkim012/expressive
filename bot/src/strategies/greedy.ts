import type { Strategy } from './index';
import type { CandidatePair, LendOrder, BorrowOrder } from '../types';

/**
 * Greedy strategy: picks the single highest-surplus pair.
 * Simplest approach — lowest total surplus of the three strategies.
 */
export class GreedyStrategy implements Strategy {
  name = 'greedy';

  select(
    candidates: CandidatePair[],
    _lends: LendOrder[],
    _borrows: BorrowOrder[],
  ): CandidatePair[] {
    if (candidates.length === 0) return [];
    // candidates are pre-sorted by surplus descending
    return [candidates[0]];
  }
}
