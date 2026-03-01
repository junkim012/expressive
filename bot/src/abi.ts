import { parseAbi } from 'viem';

export const SOLVER_ABI = parseAbi([
  'function submitBatch((uint256 lendOrderId, uint256 borrowOrderId, uint256 amount)[] pairs, (uint256 orderId, uint256 totalConsumed)[] consumptions) external',
  'function executeBatch() external',
  'function windowId() view returns (uint256)',
  'function windowStart() view returns (uint256)',
  'function batchWindowSeconds() view returns (uint256)',
  'function currentWinner() view returns (address)',
  'function currentBestSurplus() view returns (uint256)',
]);

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to, uint256 amount)',
]);

export const ORDER_ABI = parseAbi([
  'function placeLendOrder(address borrowAsset, address[] calldata acceptableCollateral, uint256 minRate, uint256 maxLtv, uint256 maxDuration, uint256 maxLltv, uint256 amount) external returns (uint256)',
  'function placeBorrowOrder(address borrowAsset, address[] calldata collateralAssets, uint256[] calldata collateralAmounts, uint256 maxRate, uint256 minLtv, uint256 minDuration, uint256 minLltv, uint256 amount, bool fillOrKill) external returns (uint256)',
]);
