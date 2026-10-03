/**
 * Markets page (v0.3): the permissionless outright-markets board.
 *
 * Two sections:
 * - Featured markets (league-created templates, e.g. Matchday Top Gainer)
 * - Community markets (created by anyone via the factory)
 *
 * Market cards share the homepage layout, with template-specific questions,
 * team identity, live pool shares, and close-time context.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Trophy,
  Users,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import { getPublicClient } from "../../hooks/usePublicClient";
import { useTeams } from "../../hooks/useTeams";
import {
  MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  normalizeMarketInfo,
  normalizeMarketSettlement,
  TEMPLATE_NAMES,
  TEMPLATES,
} from "../../lib/marketFactory";
import { SectionTitle, ErrorState, EmptyState, SkeletonCards } from "../../components/States";
import { SEASON_DISPLAY_NAME } from "../../lib/contracts";
import { Countdown } from "../../components/Countdown";
import { ShareButtons } from "../../components/ShareButtons";
import { formatTick } from "../../lib/format";
import { TeamBadge } from "../../components/TeamBadge";
import { SpreadFixtureBadges } from "../../components/SpreadFixtureBadges";
import { QuickStakeChips, QuickStakeSheet, type QuickStakeOutcome } from "../../components/QuickStake";
import { api, type ApiFixture, type ApiFixtureTeam } from "../../lib/api";
import { useMarkets as useCachedMarkets } from "../../lib/query/useMarkets";
import { useFactoryEvents } from "../../lib/query/useFactoryEvents";

export interface MarketSummary {
  id: bigint;
  templateId: number;
  creator: string;
  creatorName: string;
  bettingCloseTime: bigint;
  endTime: bigint;
  outcomeCount: number;
  seedAmount: bigint;
  totalStaked: bigint;
  state: number;
  winnerBitmap: bigint;
  params: `0x${string}`;
  outcomeTotals: bigint[];
  /** ms timestamp of the last live stake event seen for this market (0 = none). */
  lastStakeAt: number;
}

type TeamRef = { teamId: number; name: string; symbol: string };

function useMarkets() {
  const { markets: summaries, error: queryError } = useCachedMarkets();
  useFactoryEvents();
  const markets = useMemo<MarketSummary[] | null>(() => summaries?.map((s) => ({
    id: BigInt(s.id),
    templateId: s.templateId,
    creator: s.creator,
    creatorName: s.creatorName,
    bettingCloseTime: BigInt(s.bettingCloseTime),
    endTime: BigInt(s.endTime),
    outcomeCount: s.outcomeCount,
    seedAmount: BigInt(s.seedAmount),
    totalStaked: BigInt(s.totalStaked),
    state: s.state,
    winnerBitmap: BigInt(s.winnerBitmap),
    params: s.params as `0x${string}`,
    outcomeTotals: s.outcomeTotals.map((t) => BigInt(t)),
    lastStakeAt: 0,
  })) ?? null, [summaries]);
  return { markets, error: queryError?.message ?? null };
}

// ── outcome identity ────────────────────────────────────────────────
// For TOP_GAINER and CHAMPION the outcome index IS the teamId (the
// contract mints the winner bitmap as 1 << teamId), so the label is the
// coin itself — never "Outcome 12".

function outcomeTeamId(
  market: MarketSummary,
  outcomeIndex: number,
  fixtures: Map<string, ApiFixture> = new Map()
): number | null {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
      return outcomeIndex;
    }
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return outcomeIndex === 0 ? a : b;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      return Number(decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params)[0]);
    }
    if (market.templateId === TEMPLATES.SPREAD) {
      const si = getSpreadInfo(market, fixtures);
      const team = outcomeIndex === 0 ? si?.home : si?.away;
      return team?.teamId ?? null;
    }
  } catch {
    /* Keep the card usable if an older market has malformed metadata. */
  }
  return null;
}

function outcomeLabel(
  market: MarketSummary,
  outcomeIndex: number,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
      return teams.find((t) => t.teamId === outcomeIndex)?.symbol ?? `Outcome ${outcomeIndex + 1}`;
    }
    if (market.templateId === TEMPLATES.H2H) {
      const teamId = outcomeTeamId(market, outcomeIndex, fixtures);
      return `${teams.find((t) => t.teamId === teamId)?.symbol ?? `#${teamId}`} wins`;
    }
    if (market.templateId === TEMPLATES.TARGET) return outcomeIndex === 0 ? "Yes" : "No";
    // SPREAD is a YES/NO market ("Yes" = the home side covers the spread).
    // The coin logos still anchor each side visually via outcomeTeamId.
    if (market.templateId === TEMPLATES.SPREAD) return outcomeIndex === 0 ? "Yes" : "No";
  } catch {
    /* fall through */
  }
  return `Outcome ${outcomeIndex + 1}`;
}

function teamSymbol(teams: TeamRef[], teamId: number): string {
  return teams.find((t) => t.teamId === teamId)?.symbol ?? `#${teamId}`;
}

/** Full spread context: fixture teams in home/away order, the spread in goals, timing. */
interface SpreadInfo {
  fixtureId: string;
  spread: number;
  home: ApiFixtureTeam | null;
  away: ApiFixtureTeam | null;
  matchdayIndex: number;
  kickoff: string | null;
}

function getSpreadInfo(market: MarketSummary, fixtures: Map<string, ApiFixture>): SpreadInfo | null {
  try {
    const [, fixtureId, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), market.params);
    const f = fixtures.get(fixtureId.toString());
    return {
      fixtureId: fixtureId.toString(),
      spread,
      home: f?.home ?? null,
      away: f?.away ?? null,
      matchdayIndex: f?.matchdayIndex ?? -1,
      kickoff: f?.kickoff ?? null,
    };
  } catch {
    return null;
  }
}

/** Short meta line under the template tag, e.g. "Matchday 4 · 20 coins". */
function marketMeta(
  market: MarketSummary,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Matchday ${Number(matchday) + 1} · ${market.outcomeCount} coins`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return `${SEASON_DISPLAY_NAME} · ${market.outcomeCount} coins`;
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return `${teamSymbol(teams, a)} vs ${teamSymbol(teams, b)}`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, price, , above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params);
      return `${teamSymbol(teams, team)} ${above ? "≥" : "≤"} $${(Number(price) / 1e8).toLocaleString()}`;
    }
    const si = getSpreadInfo(market, fixtures);
    if (si) {
      const md = si.matchdayIndex >= 0 ? ` · Matchday ${si.matchdayIndex + 1}` : "";
      return `Fixture #${si.fixtureId}${md}`;
    }
    return `${market.outcomeCount} outcomes`;
  } catch {
    return `${market.outcomeCount} outcomes`;
  }
}

function describeCardMarket(
  market: MarketSummary,
  teams: TeamRef[],
  fixtures: Map<string, ApiFixture> = new Map()
): string {
  try {
    if (market.templateId === TEMPLATES.TOP_GAINER) {
      const [, matchday] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), market.params);
      return `Which coin gains the most on matchday ${Number(matchday) + 1}?`;
    }
    if (market.templateId === TEMPLATES.CHAMPION) return "Who will win the season championship?";
    if (market.templateId === TEMPLATES.H2H) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), market.params);
      return `Will ${teamSymbol(teams, a)} outperform ${teamSymbol(teams, b)}?`;
    }
    if (market.templateId === TEMPLATES.TARGET) {
      const [team, price, , above] = decodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), market.params);
      const symbol = teamSymbol(teams, team);
      return `Will ${symbol} finish ${above ? "above" : "below"} $${(Number(price) / 1e8).toLocaleString()}?`;
    }
    // Spread: name the teams in home/away order and state the number.
    // Home covers iff (homeGoals − awayGoals) > spread.
    const si = getSpreadInfo(market, fixtures);
    if (si?.home && si?.away) {
      const abs = Math.abs(si.spread);
      const goalWord = abs === 1 ? "goal" : "goals";
      if (si.spread >= 0) {
        return `Will ${si.home.symbol} beat ${si.away.symbol} by more than ${abs} ${goalWord}?`;
      }
      return `Will ${si.home.symbol} avoid losing to ${si.away.symbol} by ${abs}+ ${goalWord}?`;
    }
    return "Will the home team cover the fixture spread?";
  } catch {
    return TEMPLATE_NAMES[market.templateId] ?? "Prediction market";
  }
}

// ── card pieces ─────────────────────────────────────────────────────

function MarketCard({
  market,
  teams,
  fixtures,
}: {
  market: MarketSummary;
  teams: TeamRef[];
  fixtures: Map<string, ApiFixture>;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const bettingOpen = market.state === 0 && Number(market.bettingCloseTime) > nowSec;
  const secondsLeft = Number(market.bettingCloseTime) - nowSec;
  const closingSoon = bettingOpen && secondsLeft < 3600;
  const poolTick = market.totalStaked + market.seedAmount;
  const stakedTotal = market.outcomeTotals.reduce((sum, value) => sum + value, 0n);
  const question = describeCardMarket(market, teams, fixtures);
  const meta = marketMeta(market, teams, fixtures);
  const targetTeamId = market.templateId === TEMPLATES.TARGET ? outcomeTeamId(market, 0, fixtures) : null;
  const ranked = market.outcomeTotals.map((amount, index) => ({ amount, index }));
  if (market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) {
    ranked.sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.index - b.index);
  }
  const statusClass = bettingOpen
    ? "bg-red-500/10 text-red-500"
    : "bg-zinc-500/10 text-zinc-500";

  // Quick-stake: top outcomes by pool share, odds identical to the detail page.
  const [quickPick, setQuickPick] = useState<QuickStakeOutcome | null>(null);
  const quickOutcomes: QuickStakeOutcome[] = market.outcomeTotals.map((total, index) => ({
    index,
    label: outcomeLabel(market, index, teams, fixtures),
    share: stakedTotal > 0n ? Number((total * 10_000n) / stakedTotal) / 100 : 0,
    total,
    teamId: outcomeTeamId(market, index, fixtures),
  }));

  // Chips are interactive buttons, so they live outside the <Link> (invalid
  // HTML otherwise). The wrapper carries `group` so hover still reveals them.
  return (
    <div className="group relative flex h-full flex-col">
    <div className="absolute right-3 top-3 z-20">
      <ShareButtons path={`/markets/${market.id.toString()}`} text={`${question} — predict on TICKR`} compact />
    </div>
    <Link
      href={`/markets/${market.id.toString()}`}
      className="surface-card relative flex h-full flex-col overflow-hidden p-5 transition duration-300 hover:-translate-y-1 hover:border-[#2E7CF6]/40 hover:shadow-[0_20px_60px_rgba(46,124,246,.13)]"
    >
      <div className="relative flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#2E7CF6]/10"><Trophy className="h-4 w-4" /></span>{TEMPLATE_NAMES[market.templateId] ?? "Prediction market"}</span>
        <span className={`mr-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider ${statusClass}`}><i className={`h-1.5 w-1.5 rounded-full ${bettingOpen ? "bg-red-500" : "bg-zinc-400"}`} />{bettingOpen ? closingSoon ? "Closing soon" : "Open" : market.state === 0 ? "Closed" : market.state === 1 ? "Resolved" : "Voided"}</span>
      </div>
      <h3 className="relative mt-5 font-display text-lg font-bold leading-tight tracking-tight text-zinc-950 dark:text-white">
        {question}
      </h3>
      {market.templateId !== TEMPLATES.TARGET && <p className="relative mt-2 text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>}
      {market.templateId === TEMPLATES.TARGET && targetTeamId !== null && <div className="relative mt-4 flex items-center gap-3"><TeamBadge teamId={targetTeamId} size={40} showName={false} showSymbol /><span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Target coin</span></div>}
      {market.templateId === TEMPLATES.SPREAD && <SpreadFixtureBadges market={market} fixtures={fixtures} className="relative mt-4" />}
      {market.templateId === TEMPLATES.TARGET ? <div className="relative mt-5 grid grid-cols-1 gap-2.5">
        {ranked.map(({ amount, index }) => {
          const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
          const leading = index === market.outcomeTotals.reduce((best, value, i, all) => value > (all[best] ?? 0n) ? i : best, 0) && stakedTotal > 0n;
          return <div key={index} className={`min-w-0 rounded-2xl border px-4 py-3.5 ${leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}><div className="flex items-center gap-3"><span className="text-sm font-extrabold text-zinc-800 dark:text-zinc-100">{outcomeLabel(market, index, teams, fixtures)}</span><span className="ml-auto font-display text-lg font-extrabold tabular-nums text-zinc-950 dark:text-white">{pct.toFixed(0)}%</span></div><div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div></div>;
        })}
      </div> : <div className="relative mt-6 grid grid-cols-2 gap-2">
        {ranked.slice(0, 4).map(({ amount, index }) => {
          const pct = stakedTotal > 0n ? Number((amount * 10_000n) / stakedTotal) / 100 : 0;
          const leading = index === market.outcomeTotals.reduce((best, value, i, all) => value > (all[best] ?? 0n) ? i : best, 0) && stakedTotal > 0n;
          return <div key={index} className={`min-w-0 rounded-2xl border p-3 ${leading ? "border-[#2E7CF6]/35 bg-[#2E7CF6]/[.07]" : "border-black/[.06] bg-black/[.02] dark:border-white/[.07] dark:bg-white/[.025]"}`}><div className="flex items-center gap-2.5">{(market.templateId === TEMPLATES.TOP_GAINER || market.templateId === TEMPLATES.CHAMPION) && <TeamBadge teamId={index} size={26} showName={false} />}<span className="truncate text-sm font-bold text-zinc-800 dark:text-zinc-100">{outcomeLabel(market, index, teams, fixtures)}</span><span className="ml-auto shrink-0 font-display text-sm font-extrabold tabular-nums text-zinc-950 dark:text-white">{pct.toFixed(0)}%</span></div><div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]"><div className={`h-full rounded-full ${leading ? "bg-gradient-to-r from-[#2E7CF6] to-cyan-400" : "bg-zinc-300 dark:bg-zinc-600"}`} style={{ width: `${Math.max(pct, pct ? 3 : 0)}%` }} /></div></div>;
        })}
      </div>}
      <div className="relative mt-auto flex items-center justify-between gap-3 border-t border-black/[.06] pt-4 dark:border-white/[.07]" style={{ marginTop: 18 }}>
        <div><p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Total pool</p><p className="mt-0.5 font-display text-sm font-extrabold tabular-nums text-zinc-900 dark:text-white">{formatTick(poolTick)} <span className="text-xs font-semibold text-zinc-500">TICK</span></p></div>
        {bettingOpen ? <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums text-zinc-500"><Clock className="h-3.5 w-3.5" /><Countdown target={Number(market.bettingCloseTime) * 1000} /></div> : <span className="text-xs font-semibold text-zinc-500">View market</span>}
        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2E7CF6] text-white transition-transform group-hover:translate-x-1"><ArrowUpRight className="h-4 w-4" /></span>
      </div>
    </Link>
      {/* Quick-stake strip — outside the Link so taps don't navigate. */}
      <div className="relative -mt-2 px-1 pb-1">
        <QuickStakeChips
          outcomes={quickOutcomes}
          bettingOpen={bettingOpen}
          onPick={setQuickPick}
        />
      </div>
      <QuickStakeSheet
        marketId={market.id}
        question={question}
        outcome={quickPick}
        outcomeTotals={market.outcomeTotals}
        totalStaked={market.totalStaked}
        seedAmount={market.seedAmount}
        onClose={() => setQuickPick(null)}
      />
    </div>
  );
}

export default function MarketsPage() {
  const { markets, error } = useMarkets();
  const { teams } = useTeams();

  // Fixture directory for spread markets: teams in home/away order,
  // matchday, kickoff. Fails soft — spread cards fall back to generic text.
  const [fixtures, setFixtures] = useState<Map<string, ApiFixture>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .fixtures()
      .then((list) => {
        if (!alive) return;
        setFixtures(new Map(list.map((f) => [f.fixtureId, f])));
      })
      .catch(() => {
        /* Board still renders without fixture enrichment. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const { featured, community } = useMemo(() => {
    if (!markets) return { featured: null, community: null };
    const now = BigInt(Math.floor(Date.now() / 1000));
    const open = markets.filter((m) => m.state === 0 && m.bettingCloseTime > now);
    // Featured = Matchday Top Gainer + Season Champion (league templates).
    const featured = open.filter((m) => m.templateId === TEMPLATES.TOP_GAINER || m.templateId === TEMPLATES.CHAMPION);
    const community = open.filter((m) => m.templateId !== TEMPLATES.TOP_GAINER && m.templateId !== TEMPLATES.CHAMPION);
    return { featured, community };
  }, [markets]);
  const openMarketCount = (featured?.length ?? 0) + (community?.length ?? 0);

  if (!MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
        <EmptyState
          title="Markets not deployed yet"
          message="The MarketFactory contract hasn't been deployed on this network. Community markets go live with the v0.2 redeploy."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <SectionTitle title="Prediction Markets" />
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Users className="h-4 w-4 text-[#2E7CF6]" />
            Permissionless outrights — anyone can create a market, anyone can resolve it.
            Every market resolves from on-chain data, never by vote.
          </p>
        </div>
        <Link
          href="/markets/create"
          className="gradient-cta flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(46,124,246,0.4)] transition-all hover:shadow-[0_0_30px_rgba(46,124,246,0.6)] active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Create market
        </Link>
      </div>

      {!markets ? (
        <SkeletonCards cards={6} />
      ) : openMarketCount === 0 ? (
        <EmptyState
          title="No open markets right now"
          message="New markets will appear here when they open for predictions."
        />
      ) : (
        <>
          {featured && featured.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Trophy className="h-5 w-5 text-amber-500" />
                Featured
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((m) => (
                  <MarketCard key={m.id.toString()} market={m} teams={teams ?? []} fixtures={fixtures} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Users className="h-5 w-5 text-[#2E7CF6]" />
              Community
              <span className="text-sm font-normal text-zinc-500">
                ({community?.length ?? 0})
              </span>
            </h2>
            {community && community.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {community.map((m) => (
                  <MarketCard key={m.id.toString()} market={m} teams={teams ?? []} fixtures={fixtures} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No community markets yet"
                message="Create the first one with the button above."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
