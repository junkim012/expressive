// Asset configuration — stage-aware loading.
//
// Priority order:
//   1. Env vars (USDC, WBTC, WETH) — set by e2e/staging/.env.staging for staging
//   2. deployments/local.json       — written by LocalSetup.s.sol for local dev
//   3. Hardcoded fallback           — last resort, should not be reached in practice

import fs from 'fs';
import path from 'path';

export type AssetInfo = {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
};

function loadAssets(): { borrowAssets: AssetInfo[]; collateralAssets: AssetInfo[] } {
  // 1. Env vars — staging / testnet deployment
  if (process.env.USDC && process.env.WBTC && process.env.WETH) {
    console.log('[assets] Loaded addresses from environment variables (staging)');
    return {
      borrowAssets: [
        { address: process.env.USDC, symbol: 'USDC', decimals: 6, logoUrl: '/assets/usdc.svg' },
      ],
      collateralAssets: [
        { address: process.env.WBTC, symbol: 'WBTC', decimals: 8,  logoUrl: '/assets/wbtc.svg' },
        { address: process.env.WETH, symbol: 'WETH', decimals: 18, logoUrl: '/assets/weth.svg' },
      ],
    };
  }

  // 2. deployments/local.json — local dev (written by LocalSetup.s.sol)
  // __dirname is backend/src/config/ (dev) or backend/dist/config/ (prod).
  // Either way, 3 levels up lands at the repo root where deployments/ lives.
  const localJsonPath = path.resolve(__dirname, '../../../deployments/local.json');
  if (fs.existsSync(localJsonPath)) {
    try {
      const d = JSON.parse(fs.readFileSync(localJsonPath, 'utf-8')) as {
        usdc: string; wbtc: string; weth: string;
      };
      console.log('[assets] Loaded addresses from deployments/local.json');
      return {
        borrowAssets: [
          { address: d.usdc, symbol: 'USDC', decimals: 6, logoUrl: '/assets/usdc.svg' },
        ],
        collateralAssets: [
          { address: d.wbtc, symbol: 'WBTC', decimals: 8,  logoUrl: '/assets/wbtc.svg' },
          { address: d.weth, symbol: 'WETH', decimals: 18, logoUrl: '/assets/weth.svg' },
        ],
      };
    } catch (e) {
      console.warn('[assets] Failed to parse deployments/local.json, using fallback:', e);
    }
  }

  // 3. Hardcoded fallback — should not be reached when env or local.json is present
  console.warn('[assets] No env vars or local.json found — using hardcoded fallback addresses');
  return {
    borrowAssets: [
      { address: '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1', symbol: 'USDC', decimals: 6, logoUrl: '/assets/usdc.svg' },
    ],
    collateralAssets: [
      { address: '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44', symbol: 'WBTC', decimals: 8,  logoUrl: '/assets/wbtc.svg' },
      { address: '0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f', symbol: 'WETH', decimals: 18, logoUrl: '/assets/weth.svg' },
    ],
  };
}

export const ASSETS = loadAssets();
