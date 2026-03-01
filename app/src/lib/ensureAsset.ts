import { NATIVE_TOKEN } from "./contract";

export interface EnsureAssetDeps {
  balances: Record<string, bigint>;
  burnerGetBalance: (address: string) => Promise<bigint>;
  burnerGetTokenBalance: (address: string, token: string) => Promise<bigint>;
  burnerFund: (index: number, params: { token: string; amount: bigint }) => Promise<{ relayId: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitForConfirmation: (relayId: string, ...rest: any[]) => Promise<unknown>;
}

/**
 * Ensures the burner EOA holds `needed` of `token`.
 * Checks the burner balance first; only pulls the shortfall from the shielded
 * pool, never the full amount unconditionally.  Throws if the shielded pool
 * cannot cover the shortfall (caller should surface this as a UI error).
 */
export async function ensureAsset(
  deps: EnsureAssetDeps,
  burnerIndex: number,
  burnerAddress: string,
  token: string,
  needed: bigint,
  symbol: string,
): Promise<void> {
  const isNative = token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
  const burnerHas = isNative
    ? await deps.burnerGetBalance(burnerAddress)
    : await deps.burnerGetTokenBalance(burnerAddress, token);

  const shortfall = needed > burnerHas ? needed - burnerHas : 0n;
  if (shortfall === 0n) return;

  const shieldedHas = deps.balances[token.toLowerCase()] ?? 0n;
  if (shieldedHas < shortfall) {
    throw new Error(
      `Insufficient shielded ${symbol}. Deposit more via the Deposit tab first.`
    );
  }

  const { relayId } = await deps.burnerFund(burnerIndex, { token, amount: shortfall });
  await deps.waitForConfirmation(relayId);
}
