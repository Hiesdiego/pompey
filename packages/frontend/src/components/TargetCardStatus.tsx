import { decodeTargetTerms, formatUsd } from "../lib/targetMarket";

export function TargetCardStatus({ params, symbol, price, fresh }: { params: `0x${string}`; symbol: string; price?: number; fresh: boolean }) {
  const terms = decodeTargetTerms(params);
  if (!terms) return null;
  const diff = price === undefined || !fresh ? null : (price - terms.target) / terms.target * 100;
  return <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-emerald-500/[.08] px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300"><span className="font-bold text-emerald-700 dark:text-emerald-400">{symbol} spot {diff === null ? "unavailable" : formatUsd(price!)}</span><span className="text-zinc-400">·</span><span>Target {formatUsd(terms.target)}</span>{diff !== null && <><span className="text-zinc-400">·</span><span className="tabular-nums">{diff >= 0 ? "+" : ""}{diff.toFixed(2)}%</span></>}</div>;
}
