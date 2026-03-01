import type { PublicClient, Transport, Chain } from 'viem';
import type { BotWalletClient } from './chain';
import type { TokenAddresses } from './config';
import { ERC20_ABI, ORDER_ABI } from './abi';
import { log, warn } from './logger';

// ── Tunable ranges (matching e2e/action.sh) ─────────────────────────────────
const SLEEP_MIN = 5;      // seconds
const SLEEP_MAX = 20;
const AMOUNT_MIN = 50;    // USDC
const AMOUNT_MAX = 500;
const RATE_MIN = 200;     // bps (2%)
const RATE_MAX = 600;     // bps (6%)
const LTV_MIN = 5000;     // bps (50%)
const LTV_MAX = 8000;     // bps (80%)
const LLTV_BUMP_MIN = 500;
const LLTV_BUMP_MAX = 2000;
const LLTV_CAP = 9500;
const DUR_MIN = 7;        // days
const DUR_MAX = 365;

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLender(
  label: string,
  walletClient: BotWalletClient,
  publicClient: PublicClient<Transport, Chain>,
  contractAddress: `0x${string}`,
  tokens: TokenAddresses,
): Promise<never> {
  const address = walletClient.account!.address;
  log(label, `Bot started — ${address}`);

  while (true) {
    const sleepSec = randBetween(SLEEP_MIN, SLEEP_MAX);
    await sleep(sleepSec * 1000);

    try {
      // Generate random order params
      const amountUsdc = randBetween(AMOUNT_MIN, AMOUNT_MAX);
      const amount = BigInt(amountUsdc) * 1_000_000n;
      const minRate = BigInt(randBetween(RATE_MIN, RATE_MAX));
      const maxLtv = randBetween(LTV_MIN, LTV_MAX);
      const maxLltv = clamp(
        maxLtv + randBetween(LLTV_BUMP_MIN, LLTV_BUMP_MAX),
        maxLtv + 1,
        LLTV_CAP,
      );
      const days = randBetween(DUR_MIN, DUR_MAX);
      const maxDuration = BigInt(days) * 86400n;

      // Random collateral selection
      const collateralChoice = randBetween(0, 2);
      let acceptableCollateral: `0x${string}`[];
      let collateralLabel: string;
      if (collateralChoice === 0) {
        acceptableCollateral = [tokens.wbtc];
        collateralLabel = 'WBTC';
      } else if (collateralChoice === 1) {
        acceptableCollateral = [tokens.weth];
        collateralLabel = 'WETH';
      } else {
        acceptableCollateral = [tokens.wbtc, tokens.weth];
        collateralLabel = 'WBTC+WETH';
      }

      // Check USDC balance
      const balance = await publicClient.readContract({
        address: tokens.usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      if (balance < amount) {
        warn(label, `USDC balance too low (${Number(balance) / 1e6} < ${amountUsdc}), skipping`);
        continue;
      }

      log(
        label,
        `-> ${amountUsdc} USDC | rate>=${minRate}bps ltv<=${maxLtv}bps lltv<=${maxLltv}bps dur<=${days}d | collateral=${collateralLabel}`,
      );

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: ORDER_ABI,
        functionName: 'placeLendOrder',
        args: [tokens.usdc, acceptableCollateral, minRate, BigInt(maxLtv), maxDuration, BigInt(maxLltv), amount],
      });

      log(label, `tx ${hash}`);
    } catch (err: any) {
      warn(label, `Error: ${err.shortMessage ?? err.message}`);
    }
  }
}
