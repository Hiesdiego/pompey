"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import { formatUnits } from "viem";
import type { CupMatch } from "../hooks/useCupBracket";
import { ACTIVE_CHAIN, PRICE_DECIMALS } from "../lib/contracts";
import { CUP_CONTRACTS, cupTeamName } from "../lib/cup";
import { formatSignedPct } from "../lib/format";

type Snapshot = { startA: bigint; startB: bigint; endA: bigint; endB: bigint; startSubmitted: boolean; endSubmitted: boolean };

export function CupOracleAuditCard({ match, snapshot }: { match: CupMatch; snapshot: Snapshot | null }) {
  const settled = match.state === 2;
  const final = snapshot?.endSubmitted === true;
  const teams = [
    { id: match.teamA, start: snapshot?.startA, end: snapshot?.endA },
    { id: match.teamB, start: snapshot?.startB, end: snapshot?.endB },
  ];
  const explorer = ACTIVE_CHAIN.blockExplorers.default.url;
  return <section className="glass mb-6 rounded-2xl p-5 sm:p-6" aria-labelledby="cup-oracle-title">
    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300"><ShieldCheck className="h-5 w-5" /><h2 id="cup-oracle-title" className="font-display text-lg font-extrabold">How the oracle resolves this match</h2></div>
    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">TICKR&apos;s authorized signer submits each team&apos;s USD price at kickoff and full time to CupEngine. The contract turns each 0.5% price move into one goal, rounded half up. A negative move adds goals to the opponent. If goals are level, the team with the better raw percentage move advances; an exact tie favors the lower team ID.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{teams.map((team) => {
      const change = team.start && team.end && team.start > 0n && team.end > 0n ? (Number(team.end - team.start) / Number(team.start)) * 100 : null;
      return <div key={team.id} className="rounded-xl border border-amber-400/15 bg-amber-500/[.04] p-4"><p className="font-display text-sm font-bold">{cupTeamName(team.id)}</p><dl className="mt-3 grid grid-cols-[auto_1fr] gap-2 text-xs"><dt className="text-zinc-500">Kickoff</dt><dd className="text-right font-mono tabular-nums">{snapshot?.startSubmitted && team.start ? `$${formatUnits(team.start, PRICE_DECIMALS)}` : "Pending"}</dd><dt className="text-zinc-500">Full time</dt><dd className="text-right font-mono tabular-nums">{final && team.end ? `$${formatUnits(team.end, PRICE_DECIMALS)}` : "Pending"}</dd><dt className="text-zinc-500">Change</dt><dd className="text-right font-bold tabular-nums">{final && change !== null ? formatSignedPct(change) : "Pending"}</dd></dl></div>;
    })}</div>
    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{settled ? `On-chain result: ${cupTeamName(match.teamA)} ${match.goalsA}–${match.goalsB} ${cupTeamName(match.teamB)}. ${cupTeamName(match.winner)} advances.` : final ? "Final prices are recorded; settlement is pending." : "The full-time prices and result will appear here when submitted."}</p>
    <p className="mt-2 text-xs text-zinc-500">A raw move of 30% or more in either direction triggers DAO review before settlement. On-chain snapshots make the calculation auditable; they do not independently verify the external price source.</p>
    {CUP_CONTRACTS.engine && <a href={`${explorer}/address/${CUP_CONTRACTS.engine}`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline dark:text-amber-300">View CupEngine on the explorer <ExternalLink className="h-3.5 w-3.5" /></a>}
  </section>;
}
