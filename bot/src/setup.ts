import type { PublicClient, Transport, Chain } from 'viem';
import type { BotWalletClient } from './chain';
import type { TokenAddresses } from './config';
import { ERC20_ABI } from './abi';
import { log, warn } from './logger';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';

const MAX_UINT256 = 2n ** 256n - 1n;

// Mint amounts (matching e2e/fund.sh)
const USDC_MINT = 1_000_000_000_000n;           // 1,000,000 USDC (6 dec)
const WBTC_MINT = 100_000_000_000n;              // 1,000 WBTC (8 dec)
const WETH_MINT = 5_000_000_000_000_000_000_000n; // 5,000 WETH (18 dec)
const NATIVE_HEX = '0xd3c21bcecceda1000000' as const; // 1M ETH in wei

const MIN_GAS_DEFAULT = 5_000_000_000_000_000_000n; // 5 MON

/** Approve max uint256 spending — idempotent, safe to call every startup. */
export async function approveMax(
  label: string,
  walletClient: BotWalletClient,
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
  tokenName: string,
): Promise<void> {
  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, MAX_UINT256],
  });
  log(label, `Approved ${tokenName} (${hash.slice(0, 10)}...)`);
}

/** Fund a wallet on local Anvil: set native balance + mint tokens via deployer. */
export async function fundLocal(
  label: string,
  publicClient: PublicClient<Transport, Chain>,
  targetAddress: `0x${string}`,
  tokens: TokenAddresses,
  deployerKey: `0x${string}`,
  rpcUrl: string,
): Promise<void> {
  // Set native balance
  await publicClient.request({
    method: 'anvil_setBalance' as any,
    params: [targetAddress, NATIVE_HEX],
  });
  log(label, `Set native balance to 1M (anvil)`);

  // Create deployer wallet client for minting
  const deployer = privateKeyToAccount(deployerKey);
  const deployerClient = createWalletClient({
    account: deployer,
    chain: foundry,
    transport: http(rpcUrl),
  });

  // Mint USDC
  await deployerClient.writeContract({
    address: tokens.usdc,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [targetAddress, USDC_MINT],
  });
  log(label, `Minted 1,000,000 USDC`);

  // Mint WBTC
  await deployerClient.writeContract({
    address: tokens.wbtc,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [targetAddress, WBTC_MINT],
  });
  log(label, `Minted 1,000 WBTC`);

  // Mint WETH
  await deployerClient.writeContract({
    address: tokens.weth,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [targetAddress, WETH_MINT],
  });
  log(label, `Minted 5,000 WETH`);
}

/** Check balances and log warnings if low. */
export async function checkBalances(
  label: string,
  publicClient: PublicClient<Transport, Chain>,
  address: `0x${string}`,
  tokens: TokenAddresses,
  minGas: bigint = MIN_GAS_DEFAULT,
): Promise<void> {
  const nativeBal = await publicClient.getBalance({ address });
  if (nativeBal < minGas) {
    throw new Error(
      `${label} (${address}) has insufficient gas: ` +
        `${Number(nativeBal / 10n ** 15n) / 1000} MON < ${Number(minGas / 10n ** 15n) / 1000} MON (MIN_GAS). ` +
        `Fund this address with at least ${Number(minGas / 10n ** 15n) / 1000} MON.`,
    );
  }
  log(label, `Gas OK: ${Number(nativeBal / 10n ** 15n) / 1000} MON`);

  const usdcBal = await publicClient.readContract({
    address: tokens.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  if (usdcBal === 0n) {
    warn(label, `USDC balance is 0`);
  } else {
    log(label, `USDC: ${Number(usdcBal) / 1e6}`);
  }

  const wbtcBal = await publicClient.readContract({
    address: tokens.wbtc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  if (wbtcBal === 0n) {
    warn(label, `WBTC balance is 0`);
  } else {
    log(label, `WBTC: ${Number(wbtcBal) / 1e8}`);
  }

  const wethBal = await publicClient.readContract({
    address: tokens.weth,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  if (wethBal === 0n) {
    warn(label, `WETH balance is 0`);
  } else {
    log(label, `WETH: ${Number(wethBal / 10n ** 14n) / 10000}`);
  }
}
