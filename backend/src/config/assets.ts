// Asset configuration.
// If deployments/local.json exists (written by LocalSetup.s.sol), addresses are loaded
// from it automatically so the backend stays in sync after every redeployment.
// Otherwise the hardcoded addresses below are used (update for production deployments).

import fs from 'fs';
import path from 'path';

export type AssetInfo = {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
};

function loadAssets(): { borrowAssets: AssetInfo[]; collateralAssets: AssetInfo[] } {
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

  // Fallback: hardcoded addresses (update for production / Monad testnet deployments)
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
