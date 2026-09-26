/**
 * Match page (spec P3.6–P3.8): pre-match staking, live % bars, post-match
 * result + claim. State derives from the fixture (backend) merged with
 * live WebSocket updates, plus the PriceOracle kickoff snapshot on-chain.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  CONTRACTS,
  PRICE_ORACLE_ABI,
  SEASON_ID,
} from "../../../lib/contracts";
import { MATCH_REGISTRY_V2_ABI } from "../../../lib/marketFactory";
import { api, type ApiFixture, type ApiPool } from "../../../lib/api";
import { isoToMs } from "../../../lib/format";
import { useTickr } from "../../../hooks/useTickr";
import { useTickBalance } from "../../../hooks/useTickBalance";
import { useLiveFeed } from "../../../hooks/useLiveFeed";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { fixtureStatus, type FixtureStatus } from "../../../components/FixtureCard";
import { StakePanel } from "../../../components/StakePanel";
import { LiveMatchPanel } from "../../../components/LiveMatchPanel";
import { PostMatchPanel, type FullSnapshot } from "../../../components/PostMatchPanel";
import { PoolBars } from "../../../components/PoolBars";
import { Countdown } from "../../../components/Countdown";
import { TeamBadge } from "../../../components/TeamBadge";
import { SectionTitle, LoadingState, ErrorState, EmptyState } from "../../../components/States";

const MATCH_MS = 60 * 60 * 1000;

export default function MatchPage() {
  const params = useParams();
  const id = params.id as string;
  const { authenticated, login, playerAddress } = useTickr();
  const { balance, refresh: refreshBalance } = useTickBalance(playerAddress);
  const { prices, fixtureUpdates } = useLiveFeed(true);

  const [fixture, setFixture] = useState<ApiFixture | null>(null);
  const [pool, setPool] = useState<ApiPool | null>(null);
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [bettingCloseMs, setBettingCloseMs] = useState<number | null>(null);
  const [bettingOpen, setBettingOpen] = useState(false);

  // Tick so the status recomputes as kickoff/windows pass.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const loadFixture = useCallback(async () => {
    const f = await api.fixture(id);
    setFixture(f);
    if (!CONTRACTS.matchRegistryS1) return;
    try {
      const pc = getPublicClient();
      const [open, onChainFixture] = await Promise.all([
        pc.readContract({
          address: CONTRACTS.matchRegistryS1 as `0x${string}`,
          abi: MATCH_REGISTRY_V2_ABI,
          functionName: "isBettingOpen",
          args: [BigInt(id)],
        }),
        pc.readContract({
          address: CONTRACTS.matchRegistryS1 as `0x${string}`,
          abi: MATCH_REGISTRY_V2_ABI,
          functionName: "getFixture",
          args: [BigInt(id)],
        }),
      ]);
      setBettingOpen(open);
      const matchEnd = onChainFixture.matchEndTimestamp;
      setBettingCloseMs(matchEnd > 0n ? Number(matchEnd) * 1000 - 5 * 60 * 1000 : null);
    } catch {
      setBettingOpen(false);
      setBettingCloseMs(null);
    }
  }, [id]);

  const refreshBettingWindow = useCallback(async () => {
    if (!CONTRACTS.matchRegistryS1) return;
    try {
      const open = await getPublicClient().readContract({
        address: CONTRACTS.matchRegistryS1 as `0x${string}`,
        abi: MATCH_REGISTRY_V2_ABI,
        functionName: "isBettingOpen",
        args: [BigInt(id)],
      });
      setBettingOpen(open);
    } catch {
      /* Keep the last known state if the RPC read fails. */
    }
  }, [id]);

  const loadPool = useCallback(async () => {
    try {
      const p = await api.pool(id);
      setPool(p);
    } catch {
      /* pool may 404 before first stake — non-fatal */
    }
  }, [id]);

  const loadSnapshot = useCallback(async () => {
    if (!CONTRACTS.priceOracle) return;
    try {
      const s = (await getPublicClient().readContract({
        address: CONTRACTS.priceOracle,
        abi: PRICE_ORACLE_ABI,
        functionName: "getSnapshot",
        args: [SEASON_ID, BigInt(id)],
      })) as unknown as {
        homeStart: bigint; awayStart: bigint;
        homeEnd: bigint; awayEnd: bigint;
        startSubmitted: boolean; endSubmitted: boolean;
      };
      if (s.startSubmitted) {
        setSnapshot({
          homeStart: s.homeStart,
          awayStart: s.awayStart,
          homeEnd: s.homeEnd,
          awayEnd: s.awayEnd,
          endSubmitted: s.endSubmitted,
        });
      }
    } catch {
      /* oracle read failed — panels degrade gracefully */
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadFixture()
      .then(() => {
        if (alive) loadPool();
        if (alive) loadSnapshot();
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [loadFixture, loadPool, loadSnapshot]);

  // Refetch fixture when the WS reports a state change for this match.
  useEffect(() => {
    if (fixtureUpdates[id]) loadFixture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureUpdates[id]]);

  // Live pool polling while the match is still open for staking / in play.
  useEffect(() => {
    if (!fixture) return;
    const status = fixtureStatus(fixture, fixtureUpdates[id]);
    if (status === "settled") return;
    const t = setInterval(loadPool, 8_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, fixtureUpdates[id], loadPool]);

  useEffect(() => {
    if (!fixture || fixtureStatus(fixture, fixtureUpdates[id]) !== "live") return;
    void refreshBettingWindow();
    const t = setInterval(() => void refreshBettingWindow(), 1_000);
    return () => clearInterval(t);
  }, [fixture, fixtureUpdates, id, refreshBettingWindow]);

  const handleStaked = useCallback(() => {
    loadPool();
    refreshBalance();
  }, [loadPool, refreshBalance]);

  if (error) {
    return (
      <div className="py-10">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!fixture) return <LoadingState label="Loading match…" />;
  if (!fixture.home || !fixture.away) {
    return (
      <EmptyState title="Match not found.">
        <Link href="/fixtures" className="font-semibold text-[#1D4ED8] hover:underline dark:text-[#7db3ff]">
          Back to fixtures
        </Link>
      </EmptyState>
    );
  }

  const liveUpdate = fixtureUpdates[id];
  const status: FixtureStatus = fixtureStatus(fixture, liveUpdate);
  const kickoffMs = liveUpdate?.kickoffMs ?? isoToMs(fixture.kickoff);
  const windowEndMs = isoToMs(fixture.windowEnd) ?? (kickoffMs !== null ? kickoffMs + MATCH_MS : null);

  return (
    <div>
      <Link
        href="/fixtures"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-[#1D4ED8] dark:text-zinc-400 dark:hover:text-[#7db3ff]"
      >
        <ArrowLeft className="h-4 w-4" /> Fixtures
      </Link>

      <SectionTitle title={`Matchday ${fixture.matchdayIndex + 1}`} />

      {/* Match header */}
      <div className="glass relative mb-6 overflow-hidden rounded-3xl p-6 md:p-8">
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-40 w-[36rem] -translate-x-1/2 rounded-full bg-[#2E7CF6]/12 blur-3xl dark:bg-[#2E7CF6]/18"
          aria-hidden
        />
        <div className="relative grid grid-cols-3 items-center gap-2 text-center">
          <div className="flex flex-col items-center gap-2">
            <TeamBadge teamId={fixture.home.teamId} size={56} showName={false} />
            <p className="font-display font-bold text-zinc-900 dark:text-white">{fixture.home.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              HOME · {fixture.home.symbol}
            </p>
          </div>
          <div>
            {status === "tba" || status === "upcoming" ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">Kickoff in</p>
                <Countdown target={kickoffMs} className="text-gradient text-2xl font-bold md:text-3xl" />
                {kickoffMs === null && <p className="text-sm text-zinc-500">TBA</p>}
              </>
            ) : (
              <p className="font-display text-2xl font-bold text-zinc-900 dark:text-white">
                {status === "live" ? (
                  <span className="text-gradient-animate">LIVE</span>
                ) : status === "settled" ? (
                  "FT"
                ) : (
                  "—"
                )}
              </p>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <TeamBadge teamId={fixture.away.teamId} size={56} showName={false} />
            <p className="font-display font-bold text-zinc-900 dark:text-white">{fixture.away.name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              AWAY · {fixture.away.symbol}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {status === "settled" ? (
            <PostMatchPanel
              fixture={fixture}
              pool={pool}
              snapshot={snapshot}
              playerAddress={playerAddress}
              onClaimed={handleStaked}
            />
          ) : status === "live" ? (
            <div className="space-y-6">
              <LiveMatchPanel
                fixture={fixture}
                snapshot={snapshot ? { homeStart: snapshot.homeStart, awayStart: snapshot.awayStart } : null}
                prices={prices}
                windowEndMs={windowEndMs}
              />
              {bettingOpen && bettingCloseMs !== null && bettingCloseMs > now ? (
                <div className="glass rounded-2xl border-emerald-500/25! p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-display text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                      <span className="live-badge mr-2">Live</span> In-play betting open
                    </h3>
                    <span className="text-xs text-zinc-500">
                      Closes in <Countdown target={bettingCloseMs} />
                    </span>
                  </div>
                  <StakePanel
                    fixture={fixture}
                    pool={pool}
                    playerAddress={playerAddress}
                    balance={balance}
                    authenticated={authenticated}
                    onLogin={login}
                    onStaked={handleStaked}
                  />
                </div>
              ) : bettingOpen ? (
                <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                  In-play betting closes 5 minutes before full time.
                </p>
              ) : null}
            </div>
          ) : status === "awaiting" ? (
            <div className="glass rounded-2xl border-amber-500/25! p-8 text-center">
              <p className="font-display text-lg font-bold text-zinc-900 dark:text-white">Full time</p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                The window has closed — the result is being finalized on-chain.
              </p>
            </div>
          ) : (
            <StakePanel
              fixture={fixture}
              pool={pool}
              playerAddress={playerAddress}
              balance={balance}
              authenticated={authenticated}
              onLogin={login}
              onStaked={handleStaked}
            />
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="glass rounded-2xl p-5">
            <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Pool — live
            </h3>
            {pool ? (
              <PoolBars pool={pool} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                No stakes yet — be the first to move the odds.
              </p>
            )}
            <div className="mt-4 border-t border-black/8 pt-3 text-xs text-zinc-500 dark:border-white/8 dark:text-zinc-500">
              <p>
                Window:{" "}
                {isoToMs(fixture.windowStart)
                  ? new Date(fixture.windowStart).toLocaleString()
                  : "TBA"}
              </p>
              <p className="mt-1">Outcome 1 = home win · X = draw · 2 = away win</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
