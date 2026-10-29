import { formatUtcDateTime } from "./utcTime";

export function priceTargetDeadline(atTime: Date): string {
  if (Number.isNaN(atTime.getTime())) return "at the selected time";
  const year = atTime.getUTCFullYear();
  const month = atTime.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (atTime.getUTCDate() === lastDay && atTime.getUTCHours() === 23 && atTime.getUTCMinutes() === 59) {
    if (month === 11) return `at the end of ${year} (UTC)`;
    const monthName = atTime.toLocaleDateString("en-US", { timeZone: "UTC", month: "long" });
    return `at the end of ${monthName} ${year} (UTC)`;
  }
  return `on ${formatPriceTargetTimeUtc(atTime)}`;
}

export function formatPriceTargetTimeUtc(atTime: Date): string {
  return Number.isNaN(atTime.getTime()) ? "the selected time" : formatUtcDateTime(atTime);
}

export function priceTargetQuestion(symbol: string, price: number, above: boolean, atTime: Date): string {
  return `Will ${symbol} finish ${above ? "at or above" : "at or below"} ${formatPriceTargetUsd(price)} ${priceTargetDeadline(atTime)}?`;
}

export function formatPriceTargetUsd(price: number): string {
  return `$${price.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
}
