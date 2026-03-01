# Unlink Transaction Flow

## Overview

Private orders on Expressive Lending use Unlink's privacy infrastructure.
Assets move through three layers:

```
Public wallet  →(deposit, different session)→  Shielded pool
Shielded pool  →(burnerFund)→                  Burner EOA
Burner EOA     →(burnerSend)→                  Smart contract
```

**Critical privacy rule:** Public-wallet transactions must never appear in the same
block window as burner transactions. Pre-deposits from public → shielded must happen
at a different time via the Deposit tab — never inline during order submission.
Violating this allows on-chain timing correlation that deanonymizes the public wallet.

---

## Fund Sourcing — Simplified Cascade

For every required asset (gas + collateral or borrow token), the logic checks:

1. **Burner already funded?** — `burnerGetBalance` / `burnerGetTokenBalance`
   - Yes (no shortfall) → proceed, no action needed
2. **Shielded pool has enough for shortfall?** — `balances[token]`
   - Yes → `burnerFund(index, { token, amount: shortfall })` + `waitForConfirmation`
3. **Neither** → UI error: "Insufficient shielded [token]. Deposit more via the Deposit tab first."

There is no public-wallet fallback during order submission.

```
ensureAsset(burnerIndex, burnerAddress, token, needed):
  burnerHas ← burnerGetTokenBalance(burnerAddress, token)   // burnerGetBalance for native MON
  shortfall ← max(0, needed − burnerHas)
  if shortfall == 0: return
  shieldedHas ← balances[token.toLowerCase()]
  if shieldedHas < shortfall:
    throw Error("Insufficient shielded [symbol]. Deposit more via the Deposit tab first.")
  { relayId } ← await burnerFund(burnerIndex, { token, amount: shortfall })
  await waitForConfirmation(relayId)
```

---

## Flows

### Lender — Create Lend Order

```
1. ensureAsset(NATIVE_TOKEN, GAS_RESERVE)       // gas: check burner, top up from shielded if needed
2. ensureAsset(borrowAsset, amountRaw)           // borrow asset: check burner, top up if needed
3. burnerSend: ERC20.approve(contract, amountRaw)
4. waitForBurnerTx(approveTxHash)
5. burnerSend: contract.placeLendOrder(...)
6. waitForBurnerTx(placeTxHash)
7. addBurnerForWallet(address, { burnerIndex, burnerAddress, orderType: "lend" })
```

### Lender — Redeem at Maturity

After a loan reaches `Repaid` or `Liquidated` state, the lender redeems their NFT position.
The borrow asset lands in the burner and is swept back to the shielded pool.

```
1. ensureAsset(NATIVE_TOKEN, GAS_RESERVE)        // gas for redeem + sweep
2. burnerSend: contract.redeem(positionId)
3. waitForBurnerTx(redeemTxHash)
4. redeemedAmount ← burnerGetTokenBalance(burnerAddress, borrowAsset)
5. burnerSweepToPool(burnerIndex, { token: borrowAsset, amount: redeemedAmount })
6. waitForBurnerTx(sweepTxHash)
7. refresh()                                     // sync shielded balance
```

### Borrower — Create Borrow Order

```
1. ensureAsset(NATIVE_TOKEN, GAS_RESERVE)        // gas
2. for each collateral asset:
     ensureAsset(collateralAsset, collateralAmount)  // top up shortfall only
3. for each collateral asset:
     burnerSend: ERC20.approve(contract, collateralAmount)
     waitForBurnerTx(approveTxHash)
4. burnerSend: contract.placeBorrowOrder(...)
5. waitForBurnerTx(placeTxHash)
6. addBurnerForWallet(address, { burnerIndex, burnerAddress, orderType: "borrow" })
```

### Borrower — Repay Loan

The borrower repays principal + accrued interest before maturity.
Collateral is returned to the burner and swept back to the shielded pool.

```
1. repayAmount ← principal + accruedInterest  // read from backend or contract
2. ensureAsset(NATIVE_TOKEN, GAS_RESERVE)      // gas for approve + repay + sweeps
3. ensureAsset(borrowAsset, repayAmount)       // repayment funds
4. burnerSend: ERC20.approve(contract, repayAmount)
5. waitForBurnerTx(approveTxHash)
6. burnerSend: contract.repay(loanId)
7. waitForBurnerTx(repayTxHash)
8. for each collateral asset returned:
     returnedAmount ← burnerGetTokenBalance(burnerAddress, collateralAsset)
     if returnedAmount > 0:
       burnerSweepToPool(burnerIndex, { token: collateralAsset, amount: returnedAmount })
       waitForBurnerTx(sweepTxHash)
9. refresh()
```

---

## SDK Method Reference

| Method | Direction | Purpose |
|--------|-----------|---------|
| `deposit(params)` | wallet → shielded | Pre-deposit (DepositPanel only, not inline) |
| `burnerFund(index, params)` | shielded → burner | Top up burner with asset shortfall |
| `burnerSend(index, tx)` | burner → contract | Execute on-chain call from burner EOA |
| `burnerSweepToPool(index, params)` | burner → shielded | Return assets to pool after redeem/repay |
| `burnerGetBalance(addr)` | — | Check burner native MON balance |
| `burnerGetTokenBalance(addr, token)` | — | Check burner ERC20 balance |
| `waitForConfirmation(relayId)` | — | Wait for Unlink relay (used after burnerFund) |
| `waitForBurnerTx(txHash)` | — | Wait for on-chain mine (used after burnerSend/Sweep) |
| `refresh()` | — | Sync shielded balances after sweep |

---

## Privacy Model

- **Deposit tab** is the only place the public wallet interacts with the shielded pool.
  It should ideally be used in a separate session from order placement.
- **Burner EOA** is the sole address that the lending contract ever sees in private mode.
  Multiple burners (index 0/1/2) are available to isolate orders.
- **Shielded pool** holds assets invisibly on-chain until needed.
- **Sweep back** (burnerSweepToPool) returns post-transaction assets (redeemed borrow tokens,
  returned collateral) to the shielded pool without any link to the public wallet.

---

## Current Implementation Gaps

| Gap | Status | Files affected |
|-----|--------|----------------|
| Burner balance check before funding (use `ensureAsset`) | Needs fix | `LendOrderForm.tsx`, `BorrowOrderForm.tsx` |
| Lend: redeem flow | Not implemented | `PrivatePositions.tsx` or new component |
| Borrow: repay flow | Not implemented | `PrivatePositions.tsx` or new component |
