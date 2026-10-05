"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import type { Address } from "viem";
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, CircleHelp, LockKeyhole } from "lucide-react";
import { useTickr } from "../../hooks/useTickr";
import { useTeams } from "../../hooks/useTeams";
import { getPublicClient } from "../../hooks/usePublicClient";
import { CONTRACTS, PREDICTION_POOL_ABI } from "../../lib/contracts";
import { social, ApiError, type SocialAnalytics, type SocialMarket, type SocialPrediction, type SocialProfile } from "../../lib/social";
import { api, type ApiFixture } from "../../lib/api";
import { marketQuestion, pickLabel, type TeamRef } from "../../lib/marketQuestion";
import { TEMPLATE_NAMES } from "../../lib/marketFactory";
import { TeamBadge } from "../../components/TeamBadge";
import { ProfileInsights } from "../../components/ProfileInsights";
import { formatTick, OUTCOME_SHORT, truncateAddress } from "../../lib/format";

type Tab = "activity" | "fixtures" | "created" | "insights";
const surface = "overflow-hidden rounded-[1.5rem] border border-black/[.08] bg-white dark:border-white/[.09] dark:bg-[#101821]";
const divider = "divide-y divide-black/[.06] dark:divide-white/[.07]";

function date(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Date unavailable";
}

function signedTick(value: string) {
  const raw = BigInt(value);
  return `${raw > 0n ? "+" : raw < 0n ? "−" : ""}${formatTick(raw < 0n ? -raw : raw)}`;
}

function StateLabel({ state }: { state: "open" | "resolved" | "voided" }) {
  const tone = state === "open" ? "bg-blue-500/10 text-blue-600 dark:text-blue-300" : state === "resolved" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}>{state}</span>;
}

function SectionIntro({ title, detail }: { title: string; detail: string }) {
  return <div className="flex flex-wrap items-end justify-between gap-2 px-5 py-5 sm:px-6"><div><h2 className="font-display text-xl font-black">{title}</h2><p className="mt-1 text-sm text-zinc-500">{detail}</p></div></div>;
}

function Feedback({ message }: { message: string }) {
  return <div className={`${surface} p-8 text-center text-sm text-zinc-500`}>{message}</div>;
}

function MarketActivity({ username, owner, teams, fixtures }: { username: string; owner: boolean; teams: TeamRef[]; fixtures: Map<string, ApiFixture> }) {
  const { getAccessToken } = usePrivy();
  const [rows, setRows] = useState<SocialPrediction[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setCursor(null);
    setError(null);
    social.predictions(username, "all", 25, null, owner ? getAccessToken : undefined)
      .then((page) => { if (active) { setRows(page.items); setCursor(page.nextCursor); } })
      .catch(() => { if (active) setError("Market activity is unavailable right now."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username, owner, getAccessToken]);
  const loadMore = async () => {
    if (cursor === null || moreLoading) return;
    setMoreLoading(true);
    try {
      const page = await social.predictions(username, "all", 25, cursor, owner ? getAccessToken : undefined);
      setRows((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch { setError("More activity could not be loaded."); }
    finally { setMoreLoading(false); }
  };
  return <section className={surface}>
    <SectionIntro title="Market activity" detail="Each row is a stake event. One market can appear more than once when several outcomes were backed." />
    {loading ? <p className="px-6 pb-8 text-sm text-zinc-500">Loading market activity…</p> : error && !rows.length ? <p className="px-6 pb-8 text-sm text-red-500">{error}</p> : !rows.length ? <p className="px-6 pb-8 text-sm text-zinc-500">No market stakes indexed for this season.</p> : <div className={divider}>{rows.map((row) => <Link key={row.stakeId} href={`/markets/${row.marketId}`} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-black/[.025] dark:hover:bg-white/[.025] sm:px-6">
      <div className="min-w-0 flex-1"><p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">{TEMPLATE_NAMES[row.templateId] ?? "Market"} · #{row.marketId}</p><p className="font-semibold leading-snug">{marketQuestion(row.templateId, row.params, teams, fixtures)}</p><p className="mt-1 text-xs text-zinc-500">Picked {pickLabel(row.templateId, row.outcome, row.params, teams, fixtures)} · {date(row.stakedAt)}</p></div>
      <div className="flex items-center gap-3"><div className="text-right">{owner && row.amountTick !== null && <p className="text-sm font-bold tabular-nums">{formatTick(row.amountTick)} TICK</p>}{owner && row.pnlTick !== null && <p className={`text-xs font-semibold tabular-nums ${BigInt(row.pnlTick) >= 0n ? "text-emerald-600" : "text-red-500"}`}>{signedTick(row.pnlTick)} TICK result</p>}</div><StateLabel state={row.status} /><ArrowUpRight className="h-4 w-4 text-zinc-400" /></div>
    </Link>)}</div>}
    {error && rows.length > 0 && <p className="px-6 py-3 text-sm text-red-500">{error}</p>}
    {cursor !== null && <button type="button" onClick={loadMore} disabled={moreLoading} className="w-full border-t border-black/[.06] px-5 py-4 text-sm font-bold text-blue-600 transition hover:bg-black/[.025] disabled:opacity-50 dark:border-white/[.07]">{moreLoading ? "Loading…" : "Load more activity"}</button>}
  </section>;
}

interface FixturePosition { fixture: ApiFixture; stakes: [bigint, bigint, bigint]; winningOutcome: number | null }

function FixtureActivity({ wallet, season }: { wallet: string; season: number }) {
  const [positions, setPositions] = useState<FixturePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setPositions([]);
      setError(null);
      if (!CONTRACTS.predictionPool) { setError("Fixture contract is unavailable."); setLoading(false); return; }
      try {
        const fixtures = (await api.fixtures()).filter((fixture) => Number(fixture.seasonId) === season);
        const client = getPublicClient();
        const found: FixturePosition[] = [];
        let failed = false;
        for (let offset = 0; offset < fixtures.length; offset += 25) {
          const batch = fixtures.slice(offset, offset + 25);
          const contracts = batch.flatMap((fixture) => [0, 1, 2].map((outcome) => ({
            address: CONTRACTS.predictionPool as Address, abi: PREDICTION_POOL_ABI,
            functionName: "getStake" as const,
            args: [BigInt(fixture.seasonId), BigInt(fixture.fixtureId), wallet as Address, outcome] as const,
          })));
          const results = await client.multicall({ contracts, allowFailure: true });
          for (let i = 0; i < batch.length; i++) {
            const trio = results.slice(i * 3, i * 3 + 3);
            if (trio.some((result) => result.status !== "success")) { failed = true; continue; }
            const stakes = trio.map((result) => result.result as bigint) as [bigint, bigint, bigint];
            if (stakes.some((stake) => stake > 0n)) found.push({ fixture: batch[i], stakes, winningOutcome: null });
          }
        }
        const settled = found.filter((row) => row.fixture.settled && !row.fixture.voided);
        const pools = await Promise.allSettled(settled.map((row) => api.pool(row.fixture.fixtureId)));
        pools.forEach((result, index) => { if (result.status === "fulfilled") settled[index].winningOutcome = result.value.winningOutcome; else failed = true; });
        if (active) { setPositions(found.sort((a, b) => Number(b.fixture.fixtureId) - Number(a.fixture.fixtureId))); if (failed) setError("Some fixture positions could not be verified. The list may be incomplete."); }
      } catch {
        if (active) setError("Fixture picks could not be loaded.");
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [wallet, season]);
  return <section className={surface}>
    <SectionIntro title="Fixture picks" detail="Current on-chain match positions. Refunded void picks no longer appear after a claim." />
    {error && <p className="px-6 pb-4 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
    {loading ? <p className="px-6 pb-8 text-sm text-zinc-500">Checking fixture positions on-chain…</p> : !positions.length ? <p className="px-6 pb-8 text-sm text-zinc-500">{error ? "No verified fixture positions are available." : "No fixture picks found."}</p> : <div className={divider}>{positions.map(({ fixture, stakes, winningOutcome }) => {
      const picked = stakes.map((amount, index) => amount > 0n ? OUTCOME_SHORT[index] : null).filter(Boolean).join(" · ");
      const state = fixture.voided ? "Voided" : fixture.settled ? "Settled" : "Open";
      return <Link key={`${fixture.seasonId}:${fixture.fixtureId}`} href={`/match/${fixture.fixtureId}`} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-black/[.025] dark:hover:bg-white/[.025] sm:px-6"><div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">Matchday {fixture.matchdayIndex + 1} · Fixture #{fixture.fixtureId}</p><p className="mt-1 font-semibold">{fixture.home?.name ?? "Home"} vs {fixture.away?.name ?? "Away"}</p><p className="mt-1 text-xs text-zinc-500">Backed {picked} · {date(fixture.kickoff ?? fixture.windowStart)}</p></div><div className="text-right text-xs text-zinc-500"><p className="font-bold uppercase tracking-wide">{state}</p>{winningOutcome !== null && <p>{stakes[winningOutcome] > 0n ? "Winning side backed" : "Winning side not backed"}</p>}{fixture.voided && <p>Stake refundable</p>}</div><ArrowUpRight className="h-4 w-4 text-zinc-400" /></Link>;
    })}</div>}
  </section>;
}

function CreatedMarkets({ username, teams, fixtures }: { username: string; teams: TeamRef[]; fixtures: Map<string, ApiFixture> }) {
  const [rows, setRows] = useState<SocialMarket[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setRows([]); setCursor(null); setError(null);
    social.createdMarkets(username).then((page) => { if (active) { setRows(page.items); setCursor(page.nextCursor); } })
      .catch(() => { if (active) setError("Created markets could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username]);
  const loadMore = async () => {
    if (cursor === null) return;
    setLoading(true);
    try { const page = await social.createdMarkets(username, "all", 25, cursor); setRows((current) => [...current, ...page.items]); setCursor(page.nextCursor); }
    catch { setError("More markets could not be loaded."); }
    finally { setLoading(false); }
  };
  return <section className={surface}><SectionIntro title="Markets created" detail="Markets this player launched in the current season. Stake volume excludes seed liquidity." />
    {error && <p className="px-6 pb-4 text-sm text-red-500">{error}</p>}
    {loading && !rows.length ? <p className="px-6 pb-8 text-sm text-zinc-500">Loading created markets…</p> : !rows.length ? <p className="px-6 pb-8 text-sm text-zinc-500">No markets created this season.</p> : <div className={divider}>{rows.map((row) => <Link key={row.marketId} href={`/markets/${row.marketId}`} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-black/[.025] dark:hover:bg-white/[.025] sm:px-6"><div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">{TEMPLATE_NAMES[row.templateId] ?? "Market"} · #{row.marketId}</p><p className="mt-1 font-semibold">{marketQuestion(row.templateId, row.params, teams, fixtures)}</p><p className="mt-1 text-xs text-zinc-500">{formatTick(row.totalStakedTick)} TICK staked · {row.bettors} {row.bettors === 1 ? "backer" : "backers"}</p></div><StateLabel state={row.state} /><ArrowUpRight className="h-4 w-4 text-zinc-400" /></Link>)}</div>}
    {cursor !== null && <button type="button" onClick={loadMore} disabled={loading} className="w-full border-t border-black/[.06] px-5 py-4 text-sm font-bold text-blue-600 disabled:opacity-50 dark:border-white/[.07]">{loading ? "Loading…" : "Load more markets"}</button>}
  </section>;
}

export default function ProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username);
  const { playerAddress } = useTickr();
  const { getAccessToken } = usePrivy();
  const { teams } = useTeams();
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [fixtureList, setFixtureList] = useState<ApiFixture[]>([]);
  const [analytics, setAnalytics] = useState<SocialAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const owner = !!profile && !!playerAddress && profile.walletAddress.toLowerCase() === playerAddress.toLowerCase();
  const teamRefs = useMemo<TeamRef[]>(() => teams.map(({ teamId, symbol, name }) => ({ teamId, symbol, name })), [teams]);
  const fixtures = useMemo(() => new Map(fixtureList.map((fixture) => [fixture.fixtureId, fixture])), [fixtureList]);
  useEffect(() => {
    let active = true;
    setLoading(true); setProfile(null); setProfileError(null); setAnalytics(null); setTab("activity");
    social.profile(username).then((result) => { if (active) setProfile(result); })
      .catch((error) => { if (active) setProfileError(error instanceof ApiError && error.status === 404 ? "This profile does not exist." : "This profile could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username]);
  useEffect(() => { api.fixtures().then(setFixtureList).catch(() => setFixtureList([])); }, []);
  useEffect(() => {
    if (tab !== "insights" || !owner || !profile) return;
    let active = true;
    setAnalyticsLoading(true); setAnalyticsError(null);
    social.analytics(profile.walletAddress, profile.seasonId, getAccessToken)
      .then((data) => { if (active) setAnalytics(data); })
      .catch(() => { if (active) setAnalyticsError("Please try again shortly."); })
      .finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [tab, owner, profile, getAccessToken]);
  if (loading) return <div className="mx-auto max-w-6xl px-5 py-16"><Feedback message="Loading profile…" /></div>;
  if (!profile) return <div className="mx-auto max-w-6xl px-5 py-16"><Feedback message={profileError ?? "This profile is unavailable."} /></div>;
  const displayTeam = teams.find((team) => team.teamId === profile.favouriteTeamId);
  const stats = [
    { label: "Markets backed", value: profile.stats.marketsBacked, help: "Distinct markets with at least one stake" },
    { label: "Open", value: profile.stats.openMarkets, help: "Backed markets awaiting resolution" },
    { label: "Resolved", value: profile.stats.resolvedMarkets, help: "Backed markets with a final outcome" },
    { label: "Markets created", value: profile.stats.marketsCreated, help: "Markets launched by this player" },
  ];
  const tabs: { id: Tab; label: string }[] = [
    { id: "activity", label: "Market activity" }, { id: "fixtures", label: "Fixture picks" },
    { id: "created", label: "Created markets" }, ...(owner ? [{ id: "insights" as const, label: "Private insights" }] : []),
  ];
  return <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
    <Link href="/leaderboard" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 transition hover:text-blue-600"><ArrowLeft className="h-4 w-4" /> Leaderboard</Link>
    <header className={`${surface} relative`}>
      <div className="relative overflow-hidden bg-[#0c1b36] px-6 pb-8 pt-9 text-white sm:px-9 sm:pb-9"><div className="pointer-events-none absolute -right-16 -top-36 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" /><div className="relative flex flex-wrap items-start gap-5">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10 text-2xl font-black uppercase sm:h-20 sm:w-20">{profile.username[0]}</div>
        <div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-[.22em] text-blue-200">Player profile · Season {profile.seasonId}</p><h1 className="mt-1 break-all font-display text-3xl font-black tracking-tight sm:text-4xl">@{profile.username}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">{profile.bio || "No bio yet."}</p><div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/60"><span>{truncateAddress(profile.walletAddress)}</span>{displayTeam && <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-white"><TeamBadge teamId={displayTeam.teamId} size={16} showName={false} />{displayTeam.name}</span>}</div></div>
      </div></div>
      <div className="grid grid-cols-2 divide-x divide-y divide-black/[.06] dark:divide-white/[.07] sm:grid-cols-4 sm:divide-y-0">{stats.map((stat) => <div key={stat.label} className="p-5 sm:p-6"><p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{stat.label}</p><p className="mt-2 font-display text-3xl font-black tabular-nums">{stat.value.toLocaleString()}</p><p className="mt-1 text-xs leading-snug text-zinc-500">{stat.help}</p></div>)}</div>
    </header>
    <div className="mt-4 flex flex-wrap items-start gap-2 rounded-xl border border-blue-500/10 bg-blue-500/[.05] px-4 py-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" /><span>These counts cover indexed market activity for season {profile.seasonId}. Fixture picks are listed separately. Voided backed markets: {profile.stats.voidedMarkets}. Indexing may lag recent transactions.</span></div>
    <nav className="mt-7 flex gap-1 overflow-x-auto border-b border-black/[.08] dark:border-white/[.08]" aria-label="Profile sections">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-bold transition ${tab === item.id ? "border-blue-500 text-blue-600 dark:text-blue-300" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"}`}>{item.id === "insights" && <LockKeyhole className="mr-1 inline h-3.5 w-3.5" />}{item.label}</button>)}</nav>
    <div className="mt-5">{tab === "activity" && <MarketActivity username={profile.username} owner={owner} teams={teamRefs} fixtures={fixtures} />}{tab === "fixtures" && <FixtureActivity wallet={profile.walletAddress} season={profile.seasonId} />}{tab === "created" && <CreatedMarkets username={profile.username} teams={teamRefs} fixtures={fixtures} />}{tab === "insights" && owner && <ProfileInsights analytics={analytics} loading={analyticsLoading} error={analyticsError} />}</div>
    <p className="mt-5 flex items-center gap-1.5 text-xs text-zinc-500"><ChartNoAxesCombined className="h-3.5 w-3.5" /> Financial performance is visible only to the account owner.</p>
  </main>;
}
