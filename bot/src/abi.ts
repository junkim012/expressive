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
