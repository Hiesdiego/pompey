"use client";

import { Loader2, ShieldCheck } from "lucide-react";

export const CONFIRM_THRESHOLD_TICK = 500;
export const CONFIRM_THRESHOLD_WEI = BigInt(CONFIRM_THRESHOLD_TICK) * 10n ** 18n;

export function LargeStakeConfirm({ amount, outcome, busy, onBack, onConfirm }: {
  amount: string;
  outcome: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-500/15 text-amber-500">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <h3 className="font-display text-xl font-extrabold">Confirm large stake</h3>
      <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
        You&apos;re about to stake <span className="font-bold text-zinc-900 dark:text-white">{amount} TICK</span> on{" "}
        <span className="font-bold text-zinc-900 dark:text-white">{outcome}</span>. This locks funds until the market settles.
      </p>
      <div className="mt-5 flex gap-2">
        <button onClick={onBack} disabled={busy} className="flex-1 rounded-xl border border-black/10 py-3 text-sm font-bold text-zinc-600 transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5">
          Back
        </button>
        <button onClick={onConfirm} disabled={busy} className="gradient-cta flex-1 rounded-xl py-3 text-sm font-extrabold text-white shadow-[0_0_24px_rgba(46,124,246,0.4)] transition-all active:scale-[.98] disabled:opacity-40">
          {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Confirm stake"}
        </button>
      </div>
    </div>
  );
}
