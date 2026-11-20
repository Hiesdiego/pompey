/** Keep the useful socket/DNS cause from Node's generic `fetch failed` error. */
export function describeFetchFailure(value: unknown): string {
  if (!(value instanceof Error)) return String(value);

  const cause = (value as Error & { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return `${value.name}: ${value.message}`;

  const details = cause as Error & { code?: unknown; syscall?: unknown; hostname?: unknown };
  const context = [details.code, details.syscall, details.hostname]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
  return `${value.name}: ${value.message}; ${context || cause.name}: ${cause.message}`;
}
