/**
 * Price math helpers.
 *
 * Prices arrive as decimal strings (Binance sends strings like "95320.50").
 * Converting through JS `number` (float64) would silently corrupt precision,
 * so every conversion here is pure string manipulation → BigInt.
 *
 * Matches PriceOracle.PRICE_DECIMALS = 8 on-chain.
 */

export const PRICE_DECIMALS = 8;
const SCALE = 10n ** BigInt(PRICE_DECIMALS);

const PRICE_RE = /^\d+(\.\d+)?$/;

/**
 * Convert a decimal price string to a BigInt scaled by 10^PRICE_DECIMALS.
 * e.g. priceToScaled("95320.50") → 9532050000000n
 * Extra fractional digits beyond PRICE_DECIMALS are truncated (never rounded up —
 * truncation keeps the snapshot conservative and deterministic).
 */
export function priceToScaled(price: string, decimals: number = PRICE_DECIMALS): bigint {
  const trimmed = price.trim();
  if (!PRICE_RE.test(trimmed)) {
    throw new Error(`[priceMath] Invalid price string: ${JSON.stringify(price)}`);
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) {
    // Truncate, don't round — deterministic and conservative.
    const truncated = fracPart.slice(0, decimals);
    return BigInt(intPart + truncated.padEnd(decimals, "0"));
  }
  const fracPadded = fracPart.padEnd(decimals, "0");
  const combined = (intPart + fracPadded).replace(/^0+(?=\d)/, "");
  return BigInt(combined === "" ? "0" : combined);
}

/**
 * Convert a scaled BigInt back to a human-readable decimal string.
 * e.g. scaledToPrice(9532050000000n) → "95320.5"
 */
export function scaledToPrice(scaled: bigint, decimals: number = PRICE_DECIMALS): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const scale = 10n ** BigInt(decimals);
  const intPart = abs / scale;
  const fracPart = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = fracPart === "" ? intPart.toString() : `${intPart}.${fracPart}`;
  return negative ? `-${out}` : out;
}

/**
 * Absolute deviation between two scaled prices, in basis points,
 * relative to `reference`. Returns null when reference is zero.
 */
export function deviationBps(value: bigint, reference: bigint): number | null {
  if (reference === 0n) return null;
  const diff = value >= reference ? value - reference : reference - value;
  // (diff / reference) * 10_000 — multiply first to keep precision.
  return Number((diff * 10_000n) / reference);
}

export { SCALE };
