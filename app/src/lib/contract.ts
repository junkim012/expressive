import { type Abi } from "viem";

export const CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

export const CONTRACT_ABI = [
  // ── Public state ──────────────────────────────────────────────────────────
  {
    type: "function",
    name: "batchWindowSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "windowStart",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "windowId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "currentBestSurplus",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "currentWinner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "winningPairCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "currentWinningPairs",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [
      { name: "lendOrderId", type: "uint256" },
      { name: "borrowOrderId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "solverFeeRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "liquidationBonusRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // ── View helpers ──────────────────────────────────────────────────────────
  {
    type: "function",
    name: "getLoan",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "lender", type: "address" },
          { name: "borrower", type: "address" },
          { name: "borrowAsset", type: "address" },
          { name: "collateralAssets", type: "address[]" },
          { name: "collateralAmounts", type: "uint256[]" },
          { name: "principal", type: "uint256" },
          { name: "rate", type: "uint256" },
          { name: "ltv", type: "uint256" },
          { name: "lltv", type: "uint256" },
          { name: "duration", type: "uint256" },
          { name: "originationDate", type: "uint256" },
          { name: "maturityDate", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getLendOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "borrowAsset", type: "address" },
          { name: "acceptableCollateral", type: "address[]" },
          { name: "minRate", type: "uint256" },
          { name: "maxLTV", type: "uint256" },
          { name: "maxDuration", type: "uint256" },
          { name: "maxLLTV", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "filledAmount", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getBorrowOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "borrowAsset", type: "address" },
          { name: "collateralAssets", type: "address[]" },
          { name: "collateralAmounts", type: "uint256[]" },
          { name: "maxRate", type: "uint256" },
          { name: "minLTV", type: "uint256" },
          { name: "minDuration", type: "uint256" },
          { name: "minLLTV", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "filledAmount", type: "uint256" },
          { name: "fillOrKill", type: "bool" },
          { name: "owner", type: "address" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAccruedInterest",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getHealthFactor",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isHealthy",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  // ── Write functions ───────────────────────────────────────────────────────
  {
    type: "function",
    name: "placeLendOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrowAsset", type: "address" },
      { name: "acceptableCollateral", type: "address[]" },
      { name: "minRate", type: "uint256" },
      { name: "maxLTV", type: "uint256" },
      { name: "maxDuration", type: "uint256" },
      { name: "maxLLTV", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  {
    type: "function",
    name: "placeBorrowOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrowAsset", type: "address" },
      { name: "collateralAssets", type: "address[]" },
      { name: "collateralAmounts", type: "uint256[]" },
      { name: "maxRate", type: "uint256" },
      { name: "minLTV", type: "uint256" },
      { name: "minDuration", type: "uint256" },
      { name: "minLLTV", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "fillOrKill", type: "bool" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "loanToNft",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "LendOrderPlaced",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "borrowAsset", type: "address" },
      { name: "acceptableCollateral", type: "address[]" },
      { name: "minRate", type: "uint256" },
      { name: "maxLTV", type: "uint256" },
      { name: "maxDuration", type: "uint256" },
      { name: "maxLLTV", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "BorrowOrderPlaced",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "borrowAsset", type: "address" },
      { name: "collateralAssets", type: "address[]" },
      { name: "collateralAmounts", type: "uint256[]" },
      { name: "maxRate", type: "uint256" },
      { name: "minLTV", type: "uint256" },
      { name: "minDuration", type: "uint256" },
      { name: "minLLTV", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "fillOrKill", type: "bool" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "LoanCreated",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "lendOrderId", type: "uint256", indexed: true },
      { name: "borrowOrderId", type: "uint256", indexed: true },
      { name: "lender", type: "address" },
      { name: "borrower", type: "address" },
      { name: "matchAmount", type: "uint256" },
      { name: "principal", type: "uint256" },
      { name: "rate", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "lltv", type: "uint256" },
      { name: "maturityDate", type: "uint256" },
      { name: "originationDate", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "BatchExecuted",
    inputs: [
      { name: "windowId", type: "uint256", indexed: true },
      { name: "solver", type: "address", indexed: true },
      { name: "totalSurplus", type: "uint256" },
      { name: "pairCount", type: "uint256" },
    ],
  },
] as const satisfies Abi;

// Standard ERC20 ABI (minimal)
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const satisfies Abi;

// ABI for decoding submitBatch transaction input data (not in CONTRACT_ABI since
// the frontend never calls it, but needed to identify solver submissions on-chain)
export const SUBMIT_BATCH_ABI = [
  {
    type: "function",
    name: "submitBatch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "pairs",
        type: "tuple[]",
        components: [
          { name: "lendOrderId", type: "uint256" },
          { name: "borrowOrderId", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
      {
        name: "consumptions",
        type: "tuple[]",
        components: [
          { name: "orderId", type: "uint256" },
          { name: "totalConsumed", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const BASIS_POINTS = 10_000n;
export const SECONDS_PER_YEAR = 365n * 24n * 3600n;
export const MAX_UINT256 = 2n ** 256n - 1n;

// Unlink convention for native token (MON on Monad testnet)
export const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as `0x${string}`;

// Minimum native MON sent to a burner wallet to cover gas for ~3 contract calls
export const GAS_RESERVE = 10_000_000_000_000_000n; // 0.01 MON
