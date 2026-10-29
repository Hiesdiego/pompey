import { formatUtcDateTime } from "./utcTime";

export function priceTargetDeadline(atTime: Date): string {
  if (Number.isNaN(atTime.getTime())) return "at the selected time";
  return `on ${formatPriceTargetTimeUtc(atTime)}`;
}

export function formatPriceTargetTimeUtc(atTime: Date): string {
  return Number.isNaN(atTime.getTime()) ? "the selected time" : formatUtcDateTime(atTime);
}

export function priceTargetQuestion(symbol: string, price: number, above: boolean, atTime: Date): string {
  return `Will ${symbol} finish ${above ? "at or above" : "at or below"} $${price.toLocaleString("en-US")} ${priceTargetDeadline(atTime)}?`;
}
