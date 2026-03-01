import type { LendOrder, BorrowOrder, CandidatePair, SubmitBatchArgs } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility check — mirrors _checkCompatibility in ExpressiveLending.sol
// ─────────────────────────────────────────────────────────────────────────────

export function isCompatible(lend: LendOrder, borrow: BorrowOrder): boolean {
  // Same borrow asset
  if (lend.borrowAsset.toLowerCase() !== borrow.borrowAsset.toLowerCase()) return false;

  // L.minRate <= B.maxRate
  if (lend.minRate > borrow.maxRate) return false;

  // B.minLtv <= L.maxLtv
  if (borrow.minLtv > lend.maxLtv) return false;

  // B.minDuration <= L.maxDuration
  if (borrow.minDuration > lend.maxDuration) return false;

  // B.minLltv <= L.maxLltv
  if (borrow.minLltv > lend.maxLltv) return false;

  // B.collateralAssets must have at least one asset in L.acceptableCollateral
  const acceptable = new Set(lend.acceptableCollateral.map((a) => a.toLowerCase()));
  const hasOverlap = borrow.collateralAssets.some((c) => acceptable.has(c.toLowerCase()));
  if (!hasOverlap) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate all candidate pairs, sorted by surplus descending
// ─────────────────────────────────────────────────────────────────────────────

export function generateCandidatePairs(
  lends: LendOrder[],
  borrows: BorrowOrder[],
): CandidatePair[] {
  const pairs: CandidatePair[] = [];

  for (const l of lends) {
    const lRemaining = BigInt(l.amount) - BigInt(l.filledAmount);
    if (lRemaining <= 0n) continue;

    for (const b of borrows) {
      if (!isCompatible(l, b)) continue;

      const bRemaining = BigInt(b.amount) - BigInt(b.filledAmount);
      if (bRemaining <= 0n) continue;

      // fillOrKill: must match entire remaining amount or skip
      if (b.fillOrKill && lRemaining < bRemaining) continue;

      const amount = lRemaining < bRemaining ? lRemaining : bRemaining;
      const surplus = BigInt(b.maxRate - l.minRate) * amount;

      pairs.push({
        lendOrderId: l.orderId,
        borrowOrderId: b.orderId,
        amount,
        surplus,
        lendRate: l.minRate,
        borrowRate: b.maxRate,
      });
    }
  }

  // Sort by surplus descending
  return pairs.sort((a, b) => (b.surplus > a.surplus ? 1 : b.surplus < a.surplus ? -1 : 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Build consumptions from selected pairs
// Consumptions must be sorted ascending by orderId (contract binary search)
// ─────────────────────────────────────────────────────────────────────────────

export function buildConsumptions(selected: CandidatePair[]): SubmitBatchArgs {
  const consumptionMap = new Map<number, bigint>();
  let totalSurplus = 0n;

  for (const p of selected) {
    consumptionMap.set(
      p.lendOrderId,
      (consumptionMap.get(p.lendOrderId) ?? 0n) + p.amount,
    );
    consumptionMap.set(
      p.borrowOrderId,
      (consumptionMap.get(p.borrowOrderId) ?? 0n) + p.amount,
    );
    totalSurplus += p.surplus;
  }

  // Sort ascending by orderId
  const consumptions = [...consumptionMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([orderId, totalConsumed]) => ({
      orderId: BigInt(orderId),
      totalConsumed,
    }));

  const pairs = selected.map((p) => ({
    lendOrderId: BigInt(p.lendOrderId),
    borrowOrderId: BigInt(p.borrowOrderId),
    amount: p.amount,
  }));

  return { pairs, consumptions, totalSurplus };
}
