import type { PublicClient, Transport, Chain } from 'viem';
import type { BotWalletClient } from './chain';
import type { TokenAddresses } from './config';
import { ERC20_ABI, ORDER_ABI } from './abi';
import { log, warn } from './logger';

// ── Tunable ranges (matching e2e/action.sh) ─────────────────────────────────
const SLEEP_MIN = 8;      // seconds
const SLEEP_MAX = 25;
const AMOUNT_MIN = 50;    // USDC
const AMOUNT_MAX = 300;
const RATE_MIN = 400;     // bps (4%)
const RATE_MAX = 800;     // bps (8%)
const LTV_MIN = 3000;     // bps (30%)
const LTV_MAX = 7000;     // bps (70%)
const LLTV_BUMP_MIN = 500;
const LLTV_BUMP_MAX = 2000;
const LLTV_CAP = 9000;
const DUR_MIN = 7;        // days
const DUR_MAX = 180;

function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBorrower(
  label: string,
  walletClient: BotWalletClient,
  publicClient: PublicClient<Transport, Chain>,
  contractAddress: `0x${string}`,
  tokens: TokenAddresses,
  btcPrice: bigint,
  ethPrice: bigint,
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
      const maxRate = BigInt(randBetween(RATE_MIN, RATE_MAX));
      const minLtv = randBetween(LTV_MIN, LTV_MAX);
      const minLltv = clamp(
        minLtv + randBetween(LLTV_BUMP_MIN, LLTV_BUMP_MAX),
        minLtv + 1,
        LLTV_CAP,
      );
      const days = randBetween(DUR_MIN, DUR_MAX);
      const minDuration = BigInt(days) * 86400n;

      // Minimum collateral value in USDC-6dec to satisfy minLtv
      // collateralValue = amount * 10000 / minLtv
      const collateralValue = amount * 10000n / BigInt(minLtv);

      // Random collateral type
      const useWbtc = randBetween(0, 1) === 0;

      let collateralAssets: `0x${string}`[];
      let collateralAmounts: bigint[];
      let collateralLabel: string;

      if (useWbtc) {
        // WBTC: satoshis = collateralValue / (btcPrice / 1e8) + buffer
        // btcPrice is in USDC-6dec per 1e8 satoshis: price * satoshis / 1e8 = USDC_value
        // satoshis = collateralValue * 1e8 / btcPrice + buffer
        // Simplified: collateralValue / 800 + 10000 when btcPrice = 80_000e6
        // Generic: collateralValue * 100_000_000 / btcPrice + 10_000
        const wbtcAmount = collateralValue * 100_000_000n / btcPrice + 10_000n;

        const wbtcBal = await publicClient.readContract({
          address: tokens.wbtc,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        if (wbtcBal < wbtcAmount) {
          warn(label, `WBTC balance too low, skipping`);
          continue;
        }

        collateralAssets = [tokens.wbtc];
        collateralAmounts = [wbtcAmount];
        collateralLabel = `WBTC(${wbtcAmount}sat)`;
      } else {
        // WETH: wei = collateralValue * 1e18 / ethPrice + buffer
        // ethPrice is in USDC-6dec per 1e18 wei: price * wei / 1e18 = USDC_value
        // Simplified: collateralValue * 1e9 / 3 + 1e14 when ethPrice = 3_000e6
        // Generic: collateralValue * 1_000_000_000_000_000_000 / ethPrice + 100_000_000_000_000
        const wethAmount = collateralValue * 1_000_000_000_000_000_000n / ethPrice + 100_000_000_000_000n;

        const wethBal = await publicClient.readContract({
          address: tokens.weth,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
        if (wethBal < wethAmount) {
          warn(label, `WETH balance too low, skipping`);
          continue;
        }

        collateralAssets = [tokens.weth];
        collateralAmounts = [wethAmount];
        collateralLabel = `WETH(${wethAmount}wei)`;
      }

      log(
        label,
        `-> ${amountUsdc} USDC | rate<=${maxRate}bps ltv>=${minLtv}bps lltv>=${minLltv}bps dur>=${days}d | collateral=${collateralLabel}`,
      );

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: ORDER_ABI,
        functionName: 'placeBorrowOrder',
        args: [
          tokens.usdc,
          collateralAssets,
          collateralAmounts,
          maxRate,
          BigInt(minLtv),
          minDuration,
          BigInt(minLltv),
          amount,
          false,
        ],
      });

      log(label, `tx ${hash}`);
    } catch (err: any) {
      warn(label, `Error: ${err.shortMessage ?? err.message}`);
    }
  }
}
