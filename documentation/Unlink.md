# Unlink SDK Integration Spec

## Goal

Allow lenders and borrowers to place orders on Expressive Lending without revealing their real wallet identity. The lending strategy (rates, LTV, duration, collateral composition, amounts) is visible on-chain but cannot be linked to the user's primary wallet.

---

## Privacy Model

### What is kept private
- The user's **real wallet address** — never appears on-chain
- The **link between identity and lending strategy**

### What remains public
- All order parameters (rate, LTV, duration, collateral, amounts) — these are in events
- The **burner EOA address** that placed the order — visible but unlinked from real identity

### Why not `useInteract` (atomic adapter)?
`useInteract` is ideal for one-shot swaps where the adapter is the recipient. It doesn't fit lending because:
- The `owner` field in `LendOrderPlaced` / `BorrowOrderPlaced` would be the adapter address
- Loan lifecycle requires ongoing calls (repay, redeem NFT) from the same `owner`
- The lender NFT would be minted to the adapter, making redemption complex

**Use `useBurner` instead.** Burner accounts are deterministic BIP-44 EOAs funded from the shielded pool. They appear as normal wallets on-chain but have no history linked to the real user.

---

## Architecture

```
User's Real Wallet
      │
      ▼
[Unlink Shielded Pool]  ← deposit public tokens here
      │
      │  fund burner
      ▼
[Burner EOA]  ←─── derived from Unlink wallet (BIP-44)
      │
      │  approve + placeLendOrder / placeBorrowOrder
      ▼
[ExpressiveLending Contract]
      │
      ├── LendOrderPlaced(owner = burnerEOA, ...)
      ├── BorrowOrderPlaced(owner = burnerEOA, ...)
      │
      │  (after batch execution → loan lifecycle)
      │
      ├── repay(loanId)           ← called by borrower's burner
      ├── redeem(tokenId)         ← called by lender's burner (tokenId = loanToNft[loanId])
      │
      ▼
[Burner EOA receives assets]
      │
      │  sweep back
      ▼
[Unlink Shielded Pool]
```

---

## SDK Setup

```bash
npm install @unlink-xyz/react@canary
```

Wrap the app root:

```tsx
// app/layout.tsx or _app.tsx
import { UnlinkProvider } from '@unlink-xyz/react'

export default function RootLayout({ children }) {
  return (
    <UnlinkProvider chain="monad-testnet">
      {children}
    </UnlinkProvider>
  )
}
```

---

## Order Placement Flow (Burner Account)

### 1. Wallet setup (one-time)

```tsx
import { useUnlink } from '@unlink-xyz/react'

const { wallet, createWallet, deposit } = useUnlink()

// Create wallet if first time
if (!wallet) await createWallet()

// Deposit public tokens into shielded pool
await deposit({ token: BORROW_ASSET_ADDRESS, amount: orderAmount })
```

### 2. Derive and fund a burner

```tsx
import { useBurner } from '@unlink-xyz/react'

const { derive, fund, sweep } = useBurner()

// Derive a fresh burner EOA (deterministic from Unlink wallet + index)
const burner = await derive({ index: nextBurnerIndex })
// burner.address — the on-chain EOA that will own the order

// Fund burner from shielded balance with exact amount needed
// For lend orders: borrowAsset amount
// For borrow orders: each collateral asset amount
await fund({
  burner: burner.address,
  token: BORROW_ASSET_ADDRESS,
  amount: orderAmount,
})
```

### 3. Place the order from the burner

The burner is a standard EOA — use viem with the burner's private key to send transactions:

```tsx
import { createWalletClient, http } from 'viem'
import { monadTestnet } from 'viem/chains'

const burnerClient = createWalletClient({
  account: burner.privateKey,   // only in browser memory, never sent to backend
  chain: monadTestnet,
  transport: http(RPC_URL),
})

// Step 1: approve
await burnerClient.writeContract({
  address: BORROW_ASSET_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [CONTRACT_ADDRESS, orderAmount],
})

// Step 2a: place lend order
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'placeLendOrder',
  args: [borrowAsset, acceptableCollateral, minRate, maxLTV, maxDuration, maxLLTV, amount],
})

// Step 2b: place borrow order
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'placeBorrowOrder',
  args: [borrowAsset, collateralAssets, collateralAmounts, maxRate, minLTV, minDuration, minLLTV, amount, fillOrKill],
})
```

### 4. Loan lifecycle from the burner

After the batch executes and a loan is created with `owner = burner.address`:

```tsx
// Borrower repays from burner.
// repay() calls transferFrom(borrower, contract, totalRepayment) internally,
// so the burner must approve the contract before calling repay — two separate txs.
const interest = await publicClient.readContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'getAccruedInterest',
  args: [loanId],
})
const repayAmount = principal + interest

// Step 1: approve (burner → contract)
await burnerClient.writeContract({
  address: BORROW_ASSET_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [CONTRACT_ADDRESS, repayAmount],
})

// Step 2: repay
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'repay',
  args: [loanId],
})

// Lender redeems NFT from burner (after loan is Repaid or Liquidated)
// tokenId must be looked up: contract.loanToNft(loanId)
const tokenId = await publicClient.readContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'loanToNft',
  args: [loanId],
})
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'redeem',
  args: [tokenId],
})
```

### 5. Sweep remaining assets back to shielded pool

```tsx
// After repayment/redemption, burner holds returned assets
await sweep({
  burner: burner.address,
  token: BORROW_ASSET_ADDRESS,
})
// Assets return to Unlink shielded pool — no visible link to real wallet
```

---

## Burner Index Management

Each order should use a fresh burner to prevent cross-order correlation. Track the next index client-side (persisted in `localStorage` or derived from order history):

```tsx
// Increment per order placed
const nextBurnerIndex = getStoredBurnerIndex()
const burner = await derive({ index: nextBurnerIndex })
storeOrderBurnerMapping(orderId, { burnerIndex, burnerAddress: burner.address })
incrementStoredBurnerIndex()
```

The Unlink wallet mnemonic is the root — all burners are recoverable from it. Users must back up their Unlink mnemonic to recover order management across devices/sessions.

---

## Frontend Integration Points

### "Place Order" form — Private toggle

```
[ ] Place privately (via Unlink)
```

When toggled on:
1. Check Unlink wallet exists → show creation/backup prompt if not
2. Show shielded balance for the relevant token
3. If shielded balance < order amount → show deposit flow
4. On submit: derive burner → fund → approve → place (sequentially, with step progress UI)
5. Display burner address as order owner (truncated, with tooltip explaining private mode)

### Order management panel — Private orders

- Read burner-to-order mappings from `localStorage`
- For each private order/loan, query backend using burner address as `owner`
- Show "Repay" / "Redeem" buttons that trigger burner transactions
- Show "Sweep" button after final action to return assets to shielded pool

---

## Backend / Indexer

**No backend changes required.** The indexer captures `owner` from `LendOrderPlaced` and `BorrowOrderPlaced` events — burner addresses appear as normal owners. The backend has no knowledge of the privacy layer.

The frontend queries existing API endpoints with the burner address:

```
GET /api/v1/orders?owner=<burnerAddress>
GET /api/v1/loans?borrower=<burnerAddress>
```

---

## Security Considerations

- **Burner private keys** are only ever in browser memory — never sent to the backend or logged
- **Mnemonic backup** is critical — loss of Unlink wallet = loss of ability to manage private orders
- **Front-running**: order parameters are still public at submission time; privacy is identity-only
- **Burner funding**: fund burners with exact amounts to avoid leaving residual balances that could be correlated across orders
- **Gas**: burners need native MON for gas — fund via Unlink's native sweep mechanism or a separate gas provision if the SDK supports it

---

## Outstanding Questions

These must be resolved before or during implementation.

**Q1 — Gas (MON) for burners**
Does `useBurner().fund()` support funding native MON, or only ERC20 tokens? Burners need MON for gas on every transaction (approve, place, repay, redeem, sweep). If native funding isn't supported, a separate gas provisioning mechanism is needed.

**Q2 — Private positions in `useMyPositions`**
The existing hook fetches positions by connected wallet address. Burner-owned orders and loans won't appear there. Decide: do private positions merge into the main positions panel (requires extending the hook to also query all known burner addresses from localStorage), or do they live in a separate "Private Positions" panel?

**Q3 — `isBorrower` / `isLender` checks in existing UI**
`LoanDetailModal` gates the Repay button with `address === onChainLoan.borrower`. For private loans, the borrower is the burner, not the connected wallet, so the button never renders. The UI needs a way to recognise that the current user controls a given burner address before showing action buttons.

**Q4 — Borrower post-loan UX**
When a borrow order fills, the principal is sent to the burner (`borrowOrder.owner`). The borrower needs those funds in their real wallet to actually use them. Open questions:
- Does the borrower sweep principal out to their real wallet immediately after matching?
- At repayment time, do they re-fund the burner (sweep back in from the shielded pool)?
- What is the step-by-step UI flow for this?

**Q5 — Lender `redeem` button**
The current app has no redeem functionality for lenders anywhere (private or otherwise). This feature needs to be designed and added to `LoanDetailModal` or `MyPositions` as part of this work. For private lenders it must use the burner client; for regular lenders it can use wagmi's `useWriteContract`.

**Q6 — Multi-collateral funding for borrow orders**
Borrow orders accept multiple collateral assets. The spec's `fund()` call shows a single token. The burner needs a separate `fund()` call per collateral asset — confirm the SDK supports this and document the loop.

---

## References

- Unlink SDK docs: https://docs.unlink.xyz/sdk/defi
- Unlink React SDK: https://docs.unlink.xyz/sdk/react
- `ExpressiveLending.sol` — `placeLendOrder`, `placeBorrowOrder`, `repay`, `redeem(tokenId)`, `loanToNft(loanId)`
- Events: `LendOrderPlaced`, `BorrowOrderPlaced`, `LoanCreated`
