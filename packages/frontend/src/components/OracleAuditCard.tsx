"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { formatUnits } from "viem";
import { ACTIVE_CHAIN, ACTIVE_CHAIN_NAME, CONTRACTS, PRICE_DECIMALS, SEASON_ID } from "../lib/contracts";
import { formatSignedPct } from "../lib/format";
import type { SettledScoreline } from "../hooks/useSettledScoreline";
import type { ApiFixture } from "../lib/api";
import type { FullSnapshot } from "./PostMatchPanel";

function priceChange(start: bigint, end: bigint): number | null {
  if (start <= 0n || end <= 0n) return null;
  return ((Number(end) - Number(start)) / Number(start)) * 100;
}

export function OracleAuditCard({
  fixture, snapshot, scoreline,
}: {
  fixture: ApiFixture;
  snapshot: FullSnapshot | null;
  scoreline: SettledScoreline | null;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const oracle = CONTRACTS.priceOracle;
  const explorer = ACTIVE_CHAIN.blockExplorers.default.url;
  const settled = snapshot?.endSubmitted === true;
  const rows = snapshot ? [
    { name: fixture.home?.name ?? "Home", start: snapshot.homeStart, end: snapshot.homeEnd },
    { name: fixture.away?.name ?? "Away", start: snapshot.awayStart, end: snapshot.awayEnd },
  ] : [];

  const copyAddress = async () => {
    if (!oracle) return;
    try {
      await navigator.clipboard.writeText(oracle);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return <section className="glass mb-6 rounded-3xl p-5 sm:p-6" aria-labelledby="oracle-audit-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.18em] text-[#1D4ED8] dark:text-[#7db3ff]"><ShieldCheck className="h-4 w-4" /> Full-time audit</p>
        <h2 id="oracle-audit-title" className="mt-1 font-display text-lg font-extrabold">Check the oracle result yourself</h2>
      </div>
      <span className="rounded-full bg-[#2E7CF6]/10 px-3 py-1 text-xs font-bold text-[#1D4ED8] dark:text-[#7db3ff]">{ACTIVE_CHAIN_NAME} · Season {SEASON_ID.toString()} · Fixture {fixture.fixtureId}</span>
    </div>

    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
      The full-time score is calculated by the PriceOracle contract from its recorded kickoff and final price snapshots.
      These snapshots are submitted by TICKR’s authorized backend signer; the on-chain record makes the inputs and scoring calculation auditable, but does not independently prove the external prices were correct.
    </p>

    {settled ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rows.map((row) => {
        const change = priceChange(row.start, row.end);
        return <div key={row.name} className="rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
          <p className="mb-2 text-sm font-bold">{row.name}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-zinc-500">Kickoff</dt><dd className="text-right font-mono tabular-nums">${formatUnits(row.start, PRICE_DECIMALS)}</dd>
            <dt className="text-zinc-500">Full time</dt><dd className="text-right font-mono tabular-nums">${formatUnits(row.end, PRICE_DECIMALS)}</dd>
            <dt className="text-zinc-500">Change</dt><dd className="text-right font-bold tabular-nums">{change === null ? "—" : formatSignedPct(change)}</dd>
          </dl>
        </div>;
      })}
    </div> : <p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">The oracle snapshot could not be loaded here. Open the contract below to inspect this fixture directly.</p>}

    {scoreline ? <p className="mt-3 text-sm">Oracle settlement event records <strong className="font-display tabular-nums">{scoreline.homeGoals}–{scoreline.awayGoals}</strong>. One goal equals 0.5% price movement, rounded to the nearest goal; negative goals are transferred to the other side.</p> : <p className="mt-3 text-xs text-zinc-500">The settlement event is unavailable in this view. Check the contract’s events for this fixture on the explorer.</p>}

    <div className="mt-4 rounded-2xl border border-black/[.07] bg-black/[.025] p-4 dark:border-white/[.08] dark:bg-white/[.025]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">PriceOracle contract address</p>
      {oracle ? <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all text-xs font-semibold">{oracle}</code>
        <button type="button" onClick={() => void copyAddress()} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-xs font-semibold hover:text-[#1D4ED8] dark:border-white/10" aria-label="Copy oracle contract address"><Copy className="h-3.5 w-3.5" /> {copyStatus === "copied" ? "Copied" : "Copy"}</button>
      </div> : <p className="mt-1 text-xs text-zinc-500">Oracle address is not configured for this deployment.</p>}
      {copyStatus === "failed" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Could not copy. Select the address above to copy it manually.</p>}
    </div>
    <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
      {oracle && <a href={`${explorer}/address/${oracle}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">View oracle contract <ExternalLink className="h-3.5 w-3.5" /></a>}
      {scoreline && <a href={`${explorer}/tx/${scoreline.transactionHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">View this settlement <ExternalLink className="h-3.5 w-3.5" /></a>}
      <Link href="/about#audit" className="text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">How the result is calculated</Link>
    </div>
  </section>;
}
