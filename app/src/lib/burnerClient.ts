import { createPublicClient, http, encodeFunctionData } from "viem";
import { activeChain } from "./wagmi";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL),
});

/** Wait for a burner-sent transaction to be mined. */
export async function waitForBurnerTx(txHash: string) {
  return publicClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
}

/**
 * Encode a contract call for use with useUnlink().burnerSend().
 * Returns { to, data } ready to pass to burnerSend(index, ...).
 */
export function encodeBurnerCall({
  address,
  abi,
  functionName,
  args,
}: {
  address: `0x${string}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any;
  functionName: string;
  args: readonly unknown[];
}): { to: string; data: string } {
  return {
    to: address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: encodeFunctionData({ abi, functionName, args } as any),
  };
}
