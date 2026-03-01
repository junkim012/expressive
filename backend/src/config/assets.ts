// Update this file after each contract deployment to match the constructor whitelist.

export type AssetInfo = {
  address: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
};

export const ASSETS: { borrowAssets: AssetInfo[]; collateralAssets: AssetInfo[] } = {
  borrowAssets: [
    { address: '0x5FbDB2315678afecb367f032d93F642f64180aa3', symbol: 'USDC', decimals: 6, logoUrl: '/assets/usdc.svg' },
  ],
  collateralAssets: [
    { address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', symbol: 'WBTC', decimals: 8,  logoUrl: '/assets/wbtc.svg' },
    { address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', symbol: 'WETH', decimals: 18, logoUrl: '/assets/weth.svg' },
  ],
};
