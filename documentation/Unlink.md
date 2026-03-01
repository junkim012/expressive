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
      ├── repay(loanId)           ← called by burner
      ├── redeemNFT(loanId)       ← called by burner (lender)
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
// Borrower repays from burner
await burnerClient.writeContract({
  address: BORROW_ASSET_ADDRESS,
  abi: erc20Abi,
  functionName: 'approve',
  args: [CONTRACT_ADDRESS, repayAmount],
})
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'repay',
  args: [loanId],
})

// Lender redeems NFT from burner (after loan is Repaid or Liquidated)
await burnerClient.writeContract({
  address: CONTRACT_ADDRESS,
  abi: expressiveLendingAbi,
  functionName: 'redeemNFT',
  args: [loanId],
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

## References

- Unlink SDK docs: https://docs.unlink.xyz/sdk/defi
- Unlink React SDK: https://docs.unlink.xyz/sdk/react
- `ExpressiveLending.sol` — `placeLendOrder`, `placeBorrowOrder`, `repay`, `redeemNFT`
- Events: `LendOrderPlaced`, `BorrowOrderPlaced`, `LoanCreated`
