"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

type Row = { walletAddress: string; username: string; points: number; rank: number };

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/social/leaderboard", { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error("unavailable"); return response.json(); })
      .then((data: { rows: Row[]; totalUsers: number }) => { setRows(data.rows); setTotalUsers(data.totalUsers); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
    <div className="rounded-3xl border border-amber-400/25 bg-gradient-to-br from-amber-500/15 to-transparent p-6 sm:p-8">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-amber-700 dark:text-amber-300"><Trophy className="h-4 w-4" /> Crypto Price World Cup</p>
      <h1 className="mt-2 font-display text-3xl font-black">WC leaderboard</h1>
      {!loading && !error && <p className="mt-2 text-xs font-extrabold uppercase tracking-widest text-amber-700 dark:text-amber-300">{totalUsers.toLocaleString()} Tickr users</p>}
      <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">TP means Tickr points. Each Cup market you back earns 1 TP; a correct pick earns 5 TP, a top quarter stake earns 2 TP, a single outcome backed with at least 10 TICK earns 1 conviction TP, and one submitted X post link earns 1 TP. Repeat stakes count as one prediction per market.</p>
    </div>
    <div className="mt-6 overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#101821]">
      {loading ? <p className="p-6 text-sm text-zinc-500">Loading WC points…</p> : error ? <p className="p-6 text-sm text-red-500">WC points are unavailable. Please try again shortly.</p> : !rows.length ? <p className="p-6 text-sm text-zinc-500">No Tickr users yet.</p> : <table className="w-full min-w-[320px] text-left text-sm"><thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10"><tr><th className="p-4">Rank</th><th className="p-4">Player</th><th className="p-4 text-right">Points</th></tr></thead><tbody>{rows.map((row) => <tr key={row.walletAddress} className="border-b border-black/5 last:border-0 dark:border-white/5"><td className="p-4 font-bold">#{row.rank}</td><td className="p-4"><Link href={`/${encodeURIComponent(row.username)}`} className="font-bold hover:underline">{row.username}</Link><div className="font-mono text-xs text-zinc-500">{row.walletAddress.slice(0, 6)}…{row.walletAddress.slice(-4)}</div></td><td className="p-4 text-right font-black tabular-nums text-amber-700 dark:text-amber-300">{row.points} TP</td></tr>)}</tbody></table>}
    </div>
  </main>;
}
