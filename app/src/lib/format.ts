// ── Rate / basis points ───────────────────────────────────────────────────────

/** Format basis points as a percentage string: 450 → "4.50%" */
export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Format basis points as both percentage and raw: 450 → "4.50%" */
export function formatRateWithBps(bps: number): { pct: string; bps: string } {
  return { pct: `${(bps / 100).toFixed(2)}%`, bps: `${bps} bps` };
}

/** Parse a percentage string to basis points: "4.5" → 450 */
export function parsePctToBps(pct: string): number {
  return Math.round(parseFloat(pct) * 100);
}

// ── LTV / LLTV ────────────────────────────────────────────────────────────────

/** Format LTV basis points: 7000 → "70%" */
export function formatLtv(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}

/** Parse LTV percentage string to basis points: "70" → 7000 */
export function parseLtvToBps(pct: string): number {
  return Math.round(parseFloat(pct) * 100);
}

// ── Duration ──────────────────────────────────────────────────────────────────

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Format duration seconds to a human-readable string: 7776000 → "90d" */
export function formatDuration(seconds: number): string {
  if (seconds >= YEAR) return `${Math.round(seconds / YEAR)}y`;
  if (seconds >= MONTH) return `${Math.round(seconds / MONTH)}mo`;
  if (seconds >= WEEK) return `${Math.round(seconds / WEEK)}w`;
  if (seconds >= DAY) return `${Math.round(seconds / DAY)}d`;
  if (seconds >= HOUR) return `${Math.round(seconds / HOUR)}h`;
  return `${Math.round(seconds / MINUTE)}m`;
}

/** Parse duration input + unit to seconds */
export function parseDurationToSeconds(value: string, unit: "days" | "months" | "years"): number {
  const n = parseFloat(value);
  if (unit === "days") return Math.round(n * DAY);
  if (unit === "months") return Math.round(n * MONTH);
  return Math.round(n * YEAR);
}

// ── Token amounts ─────────────────────────────────────────────────────────────

/** Format a raw uint256 string with decimals to human-readable */
export function formatTokenAmount(raw: string, decimals: number, precision = 2): string {
  const n = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = n / divisor;
  const frac = n % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, precision);
  return `${whole.toLocaleString()}.${fracStr}`;
}

/** Parse a human-readable amount to raw uint256 string */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + fracPadded);
}

// ── Addresses ─────────────────────────────────────────────────────────────────

/** Truncate an address: 0x1234...abcd */
export function truncateAddress(addr: string, chars = 4): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

// ── Timestamps ────────────────────────────────────────────────────────────────

/** Format a unix timestamp as a date string */
export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a unix timestamp as date + time */
export function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Time remaining from now until a unix timestamp */
export function timeRemaining(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Expired";
  return formatDuration(diff);
}

/** Elapsed time since a unix timestamp */
export function timeElapsed(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff <= 0) return "Just now";
  return `${formatDuration(diff)} ago`;
}

// ── Fill percentage ───────────────────────────────────────────────────────────

export function fillPercent(filled: string, total: string): number {
  const f = BigInt(filled);
  const t = BigInt(total);
  if (t === 0n) return 0;
  return Number((f * 10000n) / t) / 100;
}

// ── Health factor ─────────────────────────────────────────────────────────────

/** Health factor comes scaled by 10_000 from the contract. 10_000 = 1.0 */
export function formatHealthFactor(hf: bigint): string {
  if (hf === 2n ** 256n - 1n) return "∞"; // max uint256 = infinite (zero threshold)
  return (Number(hf) / 10_000).toFixed(3);
}

export function healthColor(hf: bigint): "green" | "amber" | "red" {
  if (hf === 2n ** 256n - 1n) return "green";
  const n = Number(hf);
  if (n >= 15_000) return "green";  // > 1.5x threshold
  if (n >= 11_000) return "amber";  // 1.1x–1.5x
  return "red";
}

// ── Countdown ─────────────────────────────────────────────────────────────────

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s";
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
