export type BurnerEntry = {
  burnerIndex: number;
  burnerAddress: string;
  orderType: "lend" | "borrow";
};

const storageKey = (walletAddress: string) =>
  `unlink_burners_${walletAddress.toLowerCase()}`;

export function getBurnersForWallet(walletAddress: string): BurnerEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(walletAddress));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addBurnerForWallet(
  walletAddress: string,
  entry: BurnerEntry
): void {
  if (typeof window === "undefined") return;
  const existing = getBurnersForWallet(walletAddress);
  if (existing.some((e) => e.burnerIndex === entry.burnerIndex)) return;
  localStorage.setItem(
    storageKey(walletAddress),
    JSON.stringify([...existing, entry])
  );
}

export function getNextBurnerIndex(walletAddress: string): number {
  const existing = getBurnersForWallet(walletAddress);
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((e) => e.burnerIndex)) + 1;
}

export function getBurnerAddresses(walletAddress: string): string[] {
  return getBurnersForWallet(walletAddress).map((e) =>
    e.burnerAddress.toLowerCase()
  );
}

export function getBurnerIndexByAddress(
  walletAddress: string,
  burnerAddress: string
): number | null {
  const entry = getBurnersForWallet(walletAddress).find(
    (e) => e.burnerAddress.toLowerCase() === burnerAddress.toLowerCase()
  );
  return entry?.burnerIndex ?? null;
}
