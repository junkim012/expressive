import type { CandidatePair, LendOrder, BorrowOrder } from '../types';

export interface Strategy {
  name: string;
  select(
    candidates: CandidatePair[],
    lends: LendOrder[],
    borrows: BorrowOrder[],
  ): CandidatePair[];
}
