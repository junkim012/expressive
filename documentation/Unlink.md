# Unlink SDK Integration Spec

## Goal

Allow lenders and borrowers to place orders on Expressive Lending without revealing their real wallet identity. The lending strategy (rates, LTV, duration, collateral composition, amounts) is visible on-chain but cannot be linked to the user's primary wallet.

## UX Flow

you always have a connected public key. The distinction is only about how orders are submitted:

Always: Connect public wallet (Rabby)                     
                  │
       ┌──────────┴──────────┐
    Public Mode           Private Mode
       │                      │
    Orders go directly     First: deposit from
    from public wallet     public wallet → shielded pool
                                │
                           Orders go via burner
                           (derived from shielded wallet)


## Funding Flow

The user's public wallet can never interact with the burner wallet. Because that deanonymizes the burner wallet. So the burner wallet must be funded via the shielded wallet. 

We can fund the burner wallet via a shielded wallet via the unlink.burner.fund(...) function in the docs, except when funding the NATIVE token, it has to be 0xeeee...eeee to indicate the native token address. 

And before the shielded wallet can fund the burner wallet, the shielded wallet needs to be funded with the native token from the public wallet. 

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

### Private Positions Panel

A dedicated panel separate from the existing `MyPositions` component. It is only visible when the user has an Unlink wallet loaded.

**Data source**
- Read all `{ burnerAddress, burnerIndex, orderId, type }` entries from `localStorage`
- For each burner, query the backend:
  - `GET /api/v1/orders?owner=<burnerAddress>`
  - `GET /api/v1/loans?lender=<burnerAddress>` (lend side)
  - `GET /api/v1/loans?borrower=<burnerAddress>` (borrow side)
- Recovery path (new device): re-derive burners from mnemonic at indices 0, 1, 2... until N consecutive addresses return no results (gap limit, e.g. N=5)

**Layout**
```
┌─────────────────────────────────────────┐
│  PRIVATE POSITIONS          [🔒 Unlink] │
├─────────────────────────────────────────┤
│  LEND  (2 orders · 1 loan)              │
│  ── Orders ──────────────────────────── │
│  #42  1000 USDC  ██░░░░  4.5%  OPEN     │
│  #43   500 USDC  ░░░░░░  5.0%  OPEN     │
│  ── Loans ───────────────────────────── │
│  #7   950 USDC   5.0%   14d   ACTIVE  ▶ │
├─────────────────────────────────────────┤
│  BORROW  (1 order · 0 loans)            │
│  ── Orders ──────────────────────────── │
│  #44  2000 USDC  ░░░░░░  8.0%  OPEN     │
└─────────────────────────────────────────┘
```

**Per-row actions (via burner client, not wagmi)**

| Row type | Available actions |
|---|---|
| Open lend order | — (no cancellation supported) |
| Open borrow order | — (no cancellation supported) |
| Active lender loan | Redeem (enabled once Repaid/Liquidated) |
| Active borrower loan | Repay → triggers approve + repay from burner |
| Repaid/Liquidated lender loan | Redeem → `loanToNft` lookup + `redeem(tokenId)` from burner |
| Any closed loan | Sweep → returns burner assets to shielded pool |

**Toggle entry point**

The "Place order privately" toggle appears at the bottom of both `LendOrderForm` and `BorrowOrderForm`. When enabled:
1. Check Unlink wallet exists → prompt creation/backup if not
2. Show shielded balance for the relevant token
3. If shielded balance < order amount → show deposit flow
4. On submit: derive burner → fund → approve → place (step progress: 1/3, 2/3, 3/3)
5. On success: write mapping to `localStorage`, refresh Private Positions panel

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

**Q2 — ~~Private positions in `useMyPositions`~~ — RESOLVED**
Private positions live in a dedicated **"Private Positions" panel**, separate from the existing `MyPositions` component. A "Place order privately" toggle on the order form is the entry point. See [Private Positions Panel](#private-positions-panel) in Frontend Integration Points.

**Q3 — ~~`isBorrower` / `isLender` checks in existing UI~~ — RESOLVED**
The frontend already has a localStorage mapping of the connected wallet → its burner addresses. Scope it by connected wallet address (`unlink_burners_<connectedWallet>`) and widen the ownership check to include burners:

```ts
// localStorage key: `unlink_burners_0xRealWallet` → string[] of burner addresses
const knownBurners = getBurnersForWallet(address) // reads localStorage
const isPrivateLoan = knownBurners.includes(onChainLoan.borrower)

const isBorrower = address === onChainLoan.borrower || isPrivateLoan
const isLender   = address === onChainLoan.lender   || knownBurners.includes(onChainLoan.lender)
```

When `isPrivateLoan` is true, the action (repay/redeem) must use the **burner client** derived for that address, not wagmi's `useWriteContract`. The modal needs to branch on this:
- `isPrivateLoan === false` → use wagmi as today
- `isPrivateLoan === true` → derive burner client from localStorage index, run approve + repay/redeem through it

**Q4 — ~~Borrower post-loan UX~~ — RESOLVED**
All fund movement between the burner and the real wallet goes **via the Unlink shielded pool** (Option B). Direct burner → real wallet transfers are not used — they create an on-chain link that breaks the privacy model.

**Post-match (borrower receives principal):**
1. Loan executes → principal lands in burner EOA
2. Private Positions panel shows the burner's token balance with a "Sweep to Pool" button
3. User clicks Sweep → burner sends funds to Unlink shielded pool via `sweep()`
4. User withdraws from the Unlink pool to their real wallet (standard Unlink withdraw UI)

**Repayment (borrower returns principal + interest):**
1. User deposits repayment amount into the Unlink shielded pool
2. User funds the burner from the pool via `fund()`
3. Burner runs: approve → `repay(loanId)`
4. Collateral is returned to the burner by the contract
5. Burner sweeps returned collateral back to the Unlink pool
6. User withdraws collateral from pool to real wallet

**UI: burner balance display**
The Private Positions panel reads the burner's ERC20 balance via `publicClient.readContract({ functionName: 'balanceOf', args: [burnerAddress] })` for each known burner address. Balances are shown inline on each position row. A "Sweep to Pool" button appears whenever the burner holds a non-zero balance.

**Q5 — ~~Lender `redeem` button~~ — RESOLVED**
The lender burner lifecycle is simpler than the borrower's — it is funded exactly once and never needs re-funding:

1. Burner is funded → places lend order (borrowAsset locked in contract)
2. Batch executes → loan created, NFT minted to burner
3. Borrower repays → `principal + interest` sits in contract earmarked for NFT holder
4. Burner calls `redeem(tokenId)` → NFT burned, contract sends `principal + interest` to burner
5. "Sweep to Pool" button → burner sends funds to Unlink shielded pool
6. User withdraws from pool to real wallet

**UI changes required (both private and non-private):**

`LoanDetailModal` — add a Redeem button for lenders alongside the existing Repay button for borrowers:
- Show when: `isLender && (loan.status === 'repaid' || loan.status === 'liquidated')`
- Non-private lender: use wagmi `useWriteContract` → `loanToNft(loanId)` then `redeem(tokenId)`
- Private lender: use burner client → same two-step lookup + redeem, then show Sweep button

Private Positions panel — Redeem and Sweep buttons on lender loan rows:
- "Redeem" enabled once loan status is `repaid` or `liquidated` → burner client calls `loanToNft` + `redeem`
- "Sweep to Pool" appears after redemption (burner balance > 0) → `sweep()` back to shielded pool

**Q6 — ~~Multi-collateral funding for borrow orders~~ — RESOLVED**
Fund the burner in a loop, one `fund()` call per collateral asset, then approve each asset before placing the order:

```ts
// Fund burner for each collateral asset
for (const { token, amount } of collaterals) {
  await fund({ burner: burner.address, token, amount })
}

// Approve each collateral asset to the contract
for (const { token, amount } of collaterals) {
  await burnerClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [CONTRACT_ADDRESS, amount],
  })
}

// Place the borrow order
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'placeBorrowOrder',
  args: [borrowAsset, collaterals.map(c => c.token), collaterals.map(c => c.amount), maxRate, minLTV, minDuration, minLLTV, amount, fillOrKill],
})
```

---

## References

- Unlink SDK docs: https://docs.unlink.xyz/sdk/defi
- Unlink React SDK: https://docs.unlink.xyz/sdk/react
- `ExpressiveLending.sol` — `placeLendOrder`, `placeBorrowOrder`, `repay`, `redeem(tokenId)`, `loanToNft(loanId)`
- Events: `LendOrderPlaced`, `BorrowOrderPlaced`, `LoanCreated`
