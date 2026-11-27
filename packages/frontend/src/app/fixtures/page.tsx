"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { api, type ApiFixture } from "../../lib/api";
import { stockApi, STOCK_CONTRACTS, STOCK_PRICE_DECIMALS, STOCK_PRICE_ORACLE_ABI, STOCK_SEASON_ID, type StockApiFixture } from "../../lib/stockContracts";
import { stockMatchdayDate, stockRoundLabel, stockRoundWave, stockScoreline, STOCK_DOUBLE_HEADER_DATE, STOCK_TOTAL_ROUNDS, utcDayKey } from "../../lib/stockFormat";
import { FixtureCard, fixtureStatus } from "../../components/FixtureCard";
import { StockFixtureCard, stockFixtureStatus } from "../../components/StockFixtureCard";
import { MemeClashCard } from "../../components/MemeClashCard";
import { useArenaClashes } from "../../lib/query/useArena";
import type { ClashSummary } from "../../lib/arenaContracts";
import { StockScoringExplainer } from "../../components/StockScoringExplainer";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import { cn } from "../../lib/cn";
import { CONTRACTS, PRICE_ORACLE_ABI, PRICE_DECIMALS, SEASON_ID } from "../../lib/contracts";
import { getPublicClient } from "../../hooks/usePublicClient";
import { usePriceFeed } from "../../lib/price/usePriceFeed";
import { useStockLiveFeed } from "../../hooks/useStockLiveFeed";
import { normalizeScoreline, roundPctLikeOracle } from "../../lib/format";

type LeagueFilter = "all" | "crypto" | "stocks" | "memes";
type FixtureSnapshot = { homeStart: bigint; awayStart: bigint; homeEnd: bigint; awayEnd: bigint; startSubmitted: boolean; endSubmitted: boolean };
type TimelineFixture = { kind: "crypto"; fixture: ApiFixture } | { kind: "stocks"; fixture: StockApiFixture } | { kind: "memes"; clash: ClashSummary };

const REFETCH_MS = 15_000;
const dayTime = (fixture: ApiFixture | StockApiFixture) => fixture.kickoff ?? ("scheduledKickoff" in fixture ? fixture.scheduledKickoff : null) ?? fixture.windowStart;
const dayKey = (fixture: ApiFixture | StockApiFixture) => utcDayKey(dayTime(fixture));

function DayPager({ values, selected, onChange, stock = false }: { values: [number, (ApiFixture | StockApiFixture)[]][]; selected: number; onChange: (day: number) => void; stock?: boolean }) {
  const selectedIndex = values.findIndex(([day]) => day === selected);
  const label = (day: number) => stock ? stockRoundLabel(day) : `Matchday ${day + 1}`;
  return <div className="glass mb-6 flex items-center gap-2 rounded-2xl p-2">
    <button onClick={() => onChange(values[Math.max(0, selectedIndex - 1)]?.[0] ?? selected)} disabled={selectedIndex <= 0} className="rounded-xl border border-black/10 p-2 text-zinc-600 disabled:opacity-30 dark:border-white/10 dark:text-zinc-300" aria-label="Previous matchday"><ChevronLeft className="h-4 w-4" /></button>
    <div className="flex-1 overflow-x-auto"><div className="flex gap-1.5">{values.map(([day, list]) => {
      const open = list.some((f) => f.settled !== true);
      const wave = stock ? stockRoundWave(day) : null;
      return <button key={day} onClick={() => onChange(day)} title={label(day)} aria-label={label(day)} className={cn("relative shrink-0 rounded-lg px-2.5 py-1.5 font-display text-xs font-bold tabular-nums", day === selected ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white" : "bg-black/5 text-zinc-500 dark:bg-white/5 dark:text-zinc-400", wave && "ring-1 ring-amber-500/60")}>
        {day + 1}{wave && <span className="ml-1 text-[9px] uppercase">{wave === "morning" ? "AM" : "PM"}</span>}{open && day !== selected && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#1D9E75]" />}
      </button>;
    })}</div></div>
    <button onClick={() => onChange(values[Math.min(values.length - 1, selectedIndex + 1)]?.[0] ?? selected)} disabled={selectedIndex < 0 || selectedIndex >= values.length - 1} className="rounded-xl border border-black/10 p-2 text-zinc-600 disabled:opacity-30 dark:border-white/10 dark:text-zinc-300" aria-label="Next matchday"><ChevronRight className="h-4 w-4" /></button>
  </div>;
}

export default function FixturesPage() {
  const [cryptoFixtures, setCryptoFixtures] = useState<ApiFixture[] | null>(null);
  const [stockFixtures, setStockFixtures] = useState<StockApiFixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeagueFilter>("all");
  const [cryptoDay, setCryptoDay] = useState<number | null>(null);
  const [stockDay, setStockDay] = useState<number | null>(null);
  const { prices } = usePriceFeed(true);
  const { fixtureUpdates, prices: stockPrices } = useStockLiveFeed(true);
  const arenaClashesQuery = useArenaClashes();
  const arenaClashes = useMemo(() => arenaClashesQuery.data?.clashes ?? [], [arenaClashesQuery.data]);

  useEffect(() => {
    const requestedLeague = new URLSearchParams(window.location.search).get("league");
    if (requestedLeague === "crypto" || requestedLeague === "stocks" || requestedLeague === "all" || requestedLeague === "memes") setFilter(requestedLeague);
    let alive = true;
    const load = async () => {
      try {
        const [crypto, stocks] = await Promise.all([api.fixtures(), stockApi.fixtures()]);
        if (!alive) return;
        setCryptoFixtures(crypto);
        setStockFixtures(stocks);
        // Default to the current round: the first round with a fixture
        // still to play. A voided fixture is never settled, so it must
        // be excluded here, or one voided fixture pins the page to its
        // round forever (stock fixture 5, voided on Thanksgiving 2026,
        // pinned the stocks view to round 1). If every fixture is
        // settled or voided, fall back to the last round, not round 1.
        setCryptoDay((value) => value ?? (crypto.find((f) => !f.settled && !f.voided)?.matchdayIndex ?? crypto[crypto.length - 1]?.matchdayIndex ?? 0));
        setStockDay((value) => value ?? (stocks.find((f) => !f.settled && !f.voided)?.matchdayIndex ?? stocks[stocks.length - 1]?.matchdayIndex ?? 0));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFETCH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const cryptoDays = useMemo(() => {
    const groups = new Map<number, ApiFixture[]>();
    for (const f of cryptoFixtures ?? []) groups.set(f.matchdayIndex, [...(groups.get(f.matchdayIndex) ?? []), f]);
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [cryptoFixtures]);
  const stockDays = useMemo(() => {
    const groups = new Map<number, StockApiFixture[]>();
    for (const f of stockFixtures ?? []) groups.set(f.matchdayIndex, [...(groups.get(f.matchdayIndex) ?? []), f]);
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [stockFixtures]);

  const timeline = useMemo(() => {
    const groups = new Map<string, TimelineFixture[]>();
    for (const f of cryptoFixtures ?? []) { const day = dayKey(f); if (day) groups.set(day, [...(groups.get(day) ?? []), { kind: "crypto", fixture: f }]); }
    for (const f of stockFixtures ?? []) { const day = dayKey(f); if (day) groups.set(day, [...(groups.get(day) ?? []), { kind: "stocks", fixture: f }]); }
    for (const c of arenaClashes) { const day = utcDayKey(new Date(c.windowStart * 1000).toISOString()); if (day) groups.set(day, [...(groups.get(day) ?? []), { kind: "memes", clash: c }]); }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, matches]) => [day, matches.sort((a, b) => (b.kind === "memes" ? b.clash.windowStart * 1000 : new Date(dayTime(b.fixture)).getTime()) - (a.kind === "memes" ? a.clash.windowStart * 1000 : new Date(dayTime(a.fixture)).getTime()))] as const);
  }, [cryptoFixtures, stockFixtures, arenaClashes]);

  const memeTimeline = useMemo(() => {
    const groups = new Map<string, ClashSummary[]>();
    for (const c of arenaClashes) { const day = utcDayKey(new Date(c.windowStart * 1000).toISOString()); if (day) groups.set(day, [...(groups.get(day) ?? []), c]); }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => [day, [...list].sort((a, b) => b.windowStart - a.windowStart)] as const);
  }, [arenaClashes]);

  const activeCrypto = filter === "crypto" ? cryptoDays.find(([day]) => day === cryptoDay)?.[1] ?? [] : [];
  // The All timeline uses the same score-bearing cards as the league views,
  // so fetch snapshots for every live or settled crypto fixture it can show.
  const scoreFixtures = (filter === "all" ? cryptoFixtures ?? [] : activeCrypto)
    .filter((f) => ["live", "settled"].includes(fixtureStatus(f)));
  const scoreIds = scoreFixtures.map((f) => f.fixtureId).join(",");
  const [snapshots, setSnapshots] = useState<Record<string, FixtureSnapshot>>({});
  useEffect(() => {
    if (!scoreIds || !CONTRACTS.priceOracle) return;
    let alive = true;
    Promise.all(scoreIds.split(",").map(async (id) => {
      try { const result = await getPublicClient().readContract({ address: CONTRACTS.priceOracle as `0x${string}`, abi: PRICE_ORACLE_ABI, functionName: "getSnapshot", args: [SEASON_ID, BigInt(id)] }); return [id, result as unknown as FixtureSnapshot] as const; }
      catch { return [id, null] as const; }
    })).then((results) => { if (alive) setSnapshots((old) => ({ ...old, ...Object.fromEntries(results.filter((r): r is readonly [string, FixtureSnapshot] => r[1] !== null)) })); });
    return () => { alive = false; };
  }, [scoreIds]);

  // Stock snapshots: only live stock fixtures, and settled stock fixtures
  // whose API scoreline is missing, need an on-chain read. Settled stock
  // cards normally show homeGoals and awayGoals from /api/stocks/fixtures,
  // so they need no snapshot at all. Live cards have no goals yet, so the
  // page derives the livescore from the kickoff snapshot plus live NAV
  // prices, exactly like scoreFor does for crypto.
  const stockScoreIds = useMemo(() => (stockFixtures ?? []).filter((f) => {
    const status = stockFixtureStatus(f, fixtureUpdates[f.fixtureId]);
    if (status === "live") return true;
    if (status !== "settled" && status !== "forfeit") return false;
    return f.homeGoals === null || f.homeGoals === undefined || f.awayGoals === null || f.awayGoals === undefined;
  }).map((f) => f.fixtureId).join(","), [stockFixtures, fixtureUpdates]);
  const [stockSnapshots, setStockSnapshots] = useState<Record<string, FixtureSnapshot>>({});
  useEffect(() => {
    if (!stockScoreIds || !STOCK_CONTRACTS.priceOracle) return;
    let alive = true;
    Promise.all(stockScoreIds.split(",").map(async (id) => {
      try { const result = await getPublicClient().readContract({ address: STOCK_CONTRACTS.priceOracle as `0x${string}`, abi: STOCK_PRICE_ORACLE_ABI, functionName: "getSnapshot", args: [STOCK_SEASON_ID, BigInt(id)] }); return [id, result as unknown as FixtureSnapshot] as const; }
      catch { return [id, null] as const; }
    })).then((results) => { if (alive) setStockSnapshots((old) => ({ ...old, ...Object.fromEntries(results.filter((r): r is readonly [string, FixtureSnapshot] => r[1] !== null)) })); });
    return () => { alive = false; };
  }, [stockScoreIds]);

  const scoreFor = (fixture: ApiFixture): [number, number] | null => {
    if (!fixture.home || !fixture.away) return null;
    const status = fixtureStatus(fixture); const snapshot = snapshots[fixture.fixtureId];
    if (!snapshot?.startSubmitted) return null;
    const pct = (start: bigint, current: number | bigint | null) => {
      if (current === null || start <= 0n) return null;
      const startPrice = Number(start) / 10 ** PRICE_DECIMALS;
      const currentPrice = typeof current === "bigint" ? Number(current) / 10 ** PRICE_DECIMALS : current;
      return startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : null;
    };
    const h = status === "settled" && snapshot.endSubmitted ? pct(snapshot.homeStart, snapshot.homeEnd) : status === "live" ? pct(snapshot.homeStart, prices[fixture.home.symbol] ?? null) : null;
    const a = status === "settled" && snapshot.endSubmitted ? pct(snapshot.awayStart, snapshot.awayEnd) : status === "live" ? pct(snapshot.awayStart, prices[fixture.away.symbol] ?? null) : null;
    return h === null || a === null ? null : normalizeScoreline(roundPctLikeOracle(h), roundPctLikeOracle(a));
  };

  const stockScoreFor = (fixture: StockApiFixture): [number, number] | null => {
    if (!fixture.home || !fixture.away) return null;
    const status = stockFixtureStatus(fixture, fixtureUpdates[fixture.fixtureId]);
    // Settled cards show the API scoreline; only derive one here when the
    // API sent no goals. Upcoming, TBD and awaiting cards show no score.
    if (status === "settled" || status === "forfeit") {
      if (fixture.homeGoals !== null && fixture.homeGoals !== undefined && fixture.awayGoals !== null && fixture.awayGoals !== undefined) return null;
    } else if (status !== "live") {
      return null;
    }
    const snapshot = stockSnapshots[fixture.fixtureId];
    if (!snapshot?.startSubmitted) return null;
    const pct = (start: bigint, current: number | null) => {
      if (current === null || start <= 0n) return null;
      const startPrice = Number(start) / 10 ** STOCK_PRICE_DECIMALS;
      return startPrice > 0 ? ((current - startPrice) / startPrice) * 100 : null;
    };
    const live = status === "live";
    const homePrice = live
      ? (stockPrices[fixture.home.teamId]?.price ? Number(stockPrices[fixture.home.teamId].price) : null)
      : (snapshot.endSubmitted ? Number(snapshot.homeEnd) / 10 ** STOCK_PRICE_DECIMALS : null);
    const awayPrice = live
      ? (stockPrices[fixture.away.teamId]?.price ? Number(stockPrices[fixture.away.teamId].price) : null)
      : (snapshot.endSubmitted ? Number(snapshot.awayEnd) / 10 ** STOCK_PRICE_DECIMALS : null);
    const h = pct(snapshot.homeStart, homePrice);
    const a = pct(snapshot.awayStart, awayPrice);
    if (h === null || a === null) return null;
    const scored = stockScoreline(h, a);
    return [scored.homeGoals, scored.awayGoals];
  };

  if (error) return <div className="py-10"><ErrorState message={error} onRetry={() => window.location.reload()} /></div>;
  const loading = !cryptoFixtures || !stockFixtures || cryptoDay === null || stockDay === null;

  return <div>
    <SectionTitle title="Fixtures" action={<Link href="/standings" className="inline-flex items-center gap-1 text-sm font-semibold text-[#1D4ED8] dark:text-[#7db3ff]"><Table2 className="h-4 w-4" /> League standings</Link>} />
    <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Fixture league">
      {(["all", "crypto", "stocks", "memes"] as LeagueFilter[]).map((value) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={cn("rounded-xl px-4 py-1.5 text-sm font-semibold", filter === value ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] text-white" : "glass text-zinc-500 dark:text-zinc-400")}>{value === "all" ? "All" : value === "crypto" ? "Crypto" : value === "stocks" ? "Stocks" : "Memes"}</button>)}
    </div>
    <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><CalendarDays className="h-4 w-4 text-[#2E7CF6]" />{filter === "all" ? "All crypto, stock and meme fixtures, newest first by UTC date and kickoff time" : filter === "crypto" ? "Crypto season fixtures, sorted by matchday" : filter === "memes" ? "Meme clashes from the Stock Meme Arena, newest first by window start date, all times UTC" : `Stock Season 1 · ${STOCK_TOTAL_ROUNDS} rounds · all times UTC`}</p>
    {loading ? <SkeletonCards cards={6} /> : filter === "all" ? timeline.length === 0 ? <EmptyState title="No fixtures available." /> : <div className="space-y-9">{timeline.map(([day, matches]) => <section key={day}>
      <h2 className="mb-4 border-b border-black/10 pb-2 font-display text-lg font-bold text-zinc-900 dark:border-white/10 dark:text-white">{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}<span className="ml-2 text-sm font-normal text-zinc-500">UTC · {matches.length} fixtures</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{matches.map((entry) => entry.kind === "crypto" ? <FixtureCard key={`crypto-${entry.fixture.fixtureId}`} fixture={entry.fixture} score={scoreFor(entry.fixture)} /> : entry.kind === "stocks" ? <StockFixtureCard key={`stock-${entry.fixture.fixtureId}`} fixture={entry.fixture} liveUpdate={fixtureUpdates[entry.fixture.fixtureId]} liveScore={stockScoreFor(entry.fixture)} /> : <MemeClashCard key={`meme-${entry.clash.id}`} clash={entry.clash} />)}</div>
    </section>)}</div> : filter === "crypto" ? <>
      {cryptoDay !== null && <DayPager values={cryptoDays} selected={cryptoDay} onChange={setCryptoDay} />}
      {cryptoDays.find(([day]) => day === cryptoDay) ? <><h2 className="mb-4 font-display text-base font-bold">Matchday {cryptoDay! + 1}<span className="ml-2 text-sm font-normal text-zinc-500">{activeCrypto.length} matches</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{activeCrypto.map((f) => <FixtureCard key={f.fixtureId} fixture={f} score={scoreFor(f)} />)}</div></> : <EmptyState title="No fixtures for this matchday." />}
    </> : filter === "memes" ? memeTimeline.length === 0 ? <EmptyState title="No meme clashes available." /> : <div className="space-y-9">{memeTimeline.map(([day, clashes]) => <section key={day}>
      <h2 className="mb-4 border-b border-black/10 pb-2 font-display text-lg font-bold text-zinc-900 dark:border-white/10 dark:text-white">{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}<span className="ml-2 text-sm font-normal text-zinc-500">UTC · {clashes.length} clashes</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{clashes.map((c) => <MemeClashCard key={`meme-${c.id}`} clash={c} />)}</div>
    </section>)}</div> : <>
      {stockDay !== null && <DayPager values={stockDays} selected={stockDay} onChange={setStockDay} stock />}
      {stockDay !== null && stockMatchdayDate(stockDay) === STOCK_DOUBLE_HEADER_DATE && stockRoundWave(stockDay) && <p className="mb-5 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">Dec 16 hosts rounds 21 and 22 in two waves, morning and evening.</p>}
      {stockDays.find(([day]) => day === stockDay) ? <><h2 className="mb-4 font-display text-base font-bold">Round {stockDay! + 1}<span className="ml-2 text-sm font-normal text-zinc-500">{stockMatchdayDate(stockDay!)} UTC · {stockDays.find(([day]) => day === stockDay)?.[1].length} matches</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{(stockDays.find(([day]) => day === stockDay)?.[1] ?? []).map((f) => <StockFixtureCard key={f.fixtureId} fixture={f} liveUpdate={fixtureUpdates[f.fixtureId]} liveScore={stockScoreFor(f)} />)}</div></> : <EmptyState title="No fixtures for this round." />}
      <div className="mt-8"><StockScoringExplainer compact /></div>
    </>}
  </div>;
}
