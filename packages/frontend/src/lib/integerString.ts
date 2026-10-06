/** Convert JSON numeric values, including scientific notation, to integer strings. */
export function integerString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const input = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(input);
  if (!match) return null;
  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const digits = whole + fraction;
  const point = whole.length + exponent;
  if (point < 0 || (point < digits.length && /[1-9]/.test(digits.slice(Math.max(point, 0))))) return null;
  const integer = (point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0")).replace(/^0+(?=\d)/, "");
  return `${sign === "-" && integer !== "0" ? "-" : ""}${integer}`;
}

export function integerBigInt(value: string | number): bigint {
  const normalized = integerString(value);
  if (normalized === null) throw new TypeError("Expected an integer value");
  return BigInt(normalized);
}
