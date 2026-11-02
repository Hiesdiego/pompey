"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowDown, Mic2, Radio, RefreshCw, Sparkles } from "lucide-react";
import { BACKEND_API_URL } from "../lib/contracts";

type Line = { id: string; minute: number; voice: "professional" | "witty"; text: string; eventType: string; createdAt: string };
const LABELS: Record<string, string> = { kickoff: "Kickoff", goal: "Goal", "chalked-off": "Score revised", "near-miss": "Close call", pressure: "Pressure", stalemate: "Stalemate", ht: "Half-time", ft: "Full-time" };
type Phase = "upcoming" | "live" | "awaiting" | "settled" | "disputed";

export function CupCommentaryFeed({ matchId, phase }: { matchId: number; phase: Phase }) {
  const active = phase === "live" || phase === "awaiting" || phase === "disputed";
  const pollMs = phase === "live" ? 30_000 : phase === "awaiting" ? 60_000 : 300_000;
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let etag = "";
    const schedule = (delay: number) => { if (!cancelled && active) timer = window.setTimeout(() => void load(), delay); };
    const load = async () => {
      if (cancelled || document.hidden || !navigator.onLine) return;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(`${BACKEND_API_URL}/api/cup/matches/${matchId}/commentary`, { cache: "no-store", signal: requestController.signal, headers: etag ? { "If-None-Match": etag } : {} });
        if (response.status === 304) { failures = 0; setStatus("ready"); schedule(pollMs); return; }
        if (!response.ok) throw new Error(`Commentary request failed: ${response.status}`);
        const body = await response.json() as { lines: Line[] };
        if (cancelled) return;
        etag = response.headers.get("ETag") ?? "";
        setLines(body.lines);
        setStatus("ready");
        failures = 0;
        schedule(pollMs);
      } catch {
        if (cancelled || requestController.signal.aborted) return;
        setStatus("error");
        failures++;
        schedule(Math.min(pollMs * 2 ** failures, 300_000));
      }
    };
    const resume = () => {
      if (document.hidden || !navigator.onLine) { window.clearTimeout(timer); controller?.abort(); return; }
      window.clearTimeout(timer);
      void load();
    };
    void load();
    if (active) {
      document.addEventListener("visibilitychange", resume);
      window.addEventListener("online", resume);
      window.addEventListener("offline", resume);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [matchId, active, pollMs, refresh]);

  const latest = lines.at(-1);
  return <section className="relative mb-6 overflow-hidden rounded-[1.75rem] border border-amber-400/25 bg-white/90 shadow-[0_24px_70px_rgba(31,24,9,.08)] dark:bg-[#17130b]/95" aria-label="World Cup commentary">
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-600 via-yellow-300 to-amber-600" />
    <div className="border-b border-black/[.06] bg-gradient-to-br from-amber-500/[.11] via-transparent to-transparent px-5 pb-5 pt-6 dark:border-white/10 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"><Radio className="h-5 w-5" /></div><div><p className="text-[10px] font-extrabold uppercase tracking-[.22em] text-amber-700 dark:text-amber-300">TICKR World Cup broadcast</p><h2 className="mt-1 font-display text-xl font-black tracking-tight sm:text-2xl">From the commentary booth</h2><p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Dee and Rekt follow the price action, one match at a time.</p></div></div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ${phase === "live" ? "border-red-400/25 bg-red-500/10 text-red-600 dark:text-red-300" : "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${phase === "live" ? "bg-red-500 animate-pulse" : "bg-amber-500"}`} />{phase === "live" ? "Live updates" : phase === "upcoming" ? "Before kickoff" : phase === "settled" ? "Match archive" : "Awaiting result"}</div>
      </div>
      {latest && <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/[.06] pt-4 text-[11px] font-semibold text-zinc-500 dark:border-white/10 dark:text-zinc-400"><span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-amber-600" /> {lines.length} {lines.length === 1 ? "update" : "updates"}</span><span className="inline-flex items-center gap-1.5"><ArrowDown className="h-3.5 w-3.5 text-amber-600" /> Latest: {latest.minute}&prime; · {LABELS[latest.eventType] ?? "Match update"}</span></div>}
    </div>
    <div className="px-5 py-5 sm:px-7 sm:py-6">
      {status === "loading" && !lines.length ? <div className="space-y-4" aria-label="Loading commentary"><div className="h-4 w-1/3 animate-pulse rounded bg-amber-500/10" /><div className="h-16 animate-pulse rounded-xl bg-black/[.04] dark:bg-white/[.04]" /></div>
        : status === "error" && !lines.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-500/[.05] p-4"><p className="text-sm text-zinc-600 dark:text-zinc-300">The booth is temporarily out of reach.</p><button type="button" onClick={() => setRefresh((value) => value + 1)} className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 hover:underline dark:text-amber-300"><RefreshCw className="h-3.5 w-3.5" /> Try again</button></div>
        : !lines.length ? <div className="flex items-start gap-3 rounded-xl border border-dashed border-amber-400/30 bg-amber-500/[.04] p-5"><Mic2 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="text-sm font-bold">{phase === "upcoming" ? "The booth opens at kickoff" : "Commentary is on its way"}</p><p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">Updates appear here as the World Cup match unfolds.</p></div></div>
        : <ol className="relative ml-4 border-l border-amber-400/30 pl-6 sm:ml-5 sm:pl-8">{lines.map((line) => {
          const pro = line.voice === "professional";
          const major = line.eventType === "goal" || line.eventType === "chalked-off" || line.eventType === "ft";
          return <li key={line.id} className="relative pb-5 last:pb-0"><span className={`absolute -left-[31px] top-3 h-3 w-3 rounded-full border-2 border-white dark:border-[#17130b] sm:-left-[39px] ${major ? "bg-amber-500 ring-4 ring-amber-500/15" : pro ? "bg-blue-500" : "bg-violet-500"}`} /><article className={`rounded-2xl border px-4 py-3.5 sm:px-5 ${major ? "border-amber-400/30 bg-amber-500/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.08] dark:bg-white/[.025]"}`}><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-display text-xs font-black tabular-nums text-amber-700 dark:text-amber-300">{line.minute}&prime;</span><span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${pro ? "bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-violet-500/10 text-violet-700 dark:text-violet-300"}`}>{pro ? "Dee · Lead" : "Rekt · Colour"}</span><span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{LABELS[line.eventType] ?? "Match update"}</span>{!pro && <Sparkles className="h-3 w-3 text-violet-500" />}</div><p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-100 sm:text-[15px]">{line.text}</p></article></li>;
        })}</ol>}
      {status === "error" && lines.length > 0 && <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">Showing the latest available commentary. Updates will resume when the connection returns.</p>}
    </div>
  </section>;
}
