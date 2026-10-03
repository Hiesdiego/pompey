/**
 * Create market page (v0.3): permissionless market creation flow.
 *
 * Step 1: pick a template (5 cards with descriptions).
 * Step 2: fill template params — every selector is gated by on-chain truth:
 *   - TOP_GAINER: matchday cards; only future, not-yet-created matchdays are
 *     selectable. Ineligible ones are grayed out with the reason.
 *   - CHAMPION: can only ever exist once; the card is disabled once created.
 *   - TARGET: "at time" defaults to 2 hours out (ceiled to the minute
 *     so the picker can never produce a value the contract would reject),
 *     and the picker forbids anything earlier or more than 30 days out.
 *   - SPREAD: fixtures grouped by matchday; only unplayed fixtures are
 *     selectable. Multiple spreads per fixture are allowed as long as the
 *     spread points differ — only an exact (fixture, points) duplicate is
 *     blocked (the contract enforces the same rule).
 * Step 3: enter a display name, approve 250 TICK, create.
 *
 * The 250 TICK is NOT a bet — it's seed liquidity that goes into the
 * market's pool unallocated and subsidizes winner payouts at settlement.
 * The creator can still stake on their own market afterwards like anyone.
 *
 * The contract re-validates everything on-chain (immutable market terms,
 * timing guards); this UI just makes it impossible to pick a losing term.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Info, Trophy, Crown, Swords, Target, BarChart3 } from "lucide-react";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { useTickr } from "../../../hooks/useTickr";
import { useMyProfile } from "../../../hooks/useMyProfile";
import { getPublicClient } from "../../../hooks/usePublicClient";
import { useTeams } from "../../../hooks/useTeams";
import { useContractWrite } from "../../../hooks/useContractWrite";
import {
  MARKET_FACTORY_ADDRESS,
  MARKET_FACTORY_ABI,
  TEMPLATES,
  TEMPLATE_NAMES,
  TEMPLATE_DESCRIPTIONS,
  CREATION_SEED_TICK,
} from "../../../lib/marketFactory";
import { CONTRACTS, TICK_TOKEN_ABI, SEASON_DISPLAY_NAME } from "../../../lib/contracts";
import { SectionTitle, ErrorState } from "../../../components/States";
import { cn } from "../../../lib/cn";
import { TeamBadge } from "../../../components/TeamBadge";
import { api, type ApiFixture } from "../../../lib/api";
import { usePriceFeed } from "../../../lib/price/usePriceFeed";

const TEMPLATE_IDS = [
  TEMPLATES.TOP_GAINER,
  TEMPLATES.CHAMPION,
  TEMPLATES.H2H,
  TEMPLATES.TARGET,
  TEMPLATES.SPREAD,
];

const TEMPLATE_ICONS = [Trophy, Crown, Swords, Target, BarChart3];

/** "2026-09-29T15:04" in the user's local timezone. */
function localDateTimeFromMs(ms: number) {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/**
 * Round UP to the next whole minute. datetime-local inputs have minute
 * precision and drop seconds — without the ceil, a default of "now + 60min"
 * could land up to 59s inside the contract's 1-hour lead and revert.
 */
function ceilToMinute(ms: number) {
  return Math.ceil(ms / 60_000) * 60_000;
}

/** "Sep 29 → Oct 1" for a matchday window. */
function formatRange(startMs: number, endMs: number) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(startMs).toLocaleDateString(undefined, opts);
  const e = new Date(endMs).toLocaleDateString(undefined, opts);
  return s === e ? s : `${s} → ${e}`;
}

/** "Sep 29, 15:04" from a "YYYY-MM-DDTHH:mm" local string. */
function formatDateTimeLocal(local: string) {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface MatchdayCard {
  index: number;
  startsAt: number;
  endsAt: number;
  created: boolean;
  started: boolean;
  eligible: boolean;
}

interface FixtureOption {
  fixture: ApiFixture;
  eligible: boolean;
  reason: string;
}

export default function CreateMarketPage() {
  const router = useRouter();
  const { playerAddress: address, authenticated, walletsReady } = useTickr();
  const publicClient = getPublicClient();
  const { teams } = useTeams();
  const { prices, status: priceFeedStatus } = usePriceFeed(true);
  const { write: writeApprove, status: approveStatus } = useContractWrite();
  const { write: writeCreate, status: createStatus } = useContractWrite();
  const { ready: walletReady } = useContractWrite();

  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [creatorName, setCreatorName] = useState("");
  const { profile: myProfile } = useMyProfile();

  useEffect(() => {
    if (myProfile?.username && !creatorName) setCreatorName(myProfile.username);
  }, [myProfile, creatorName]);
  const [duplicateMarketId, setDuplicateMarketId] = useState<bigint | null>(null);
  // Set when the exact terms were used before (market since resolved/voided).
  const [reusedMarketId, setReusedMarketId] = useState<bigint | null>(null);
  // Template params (as strings from inputs).
  const [matchdayIndex, setMatchdayIndex] = useState("0");
  const [teamA, setTeamA] = useState("0");
  const [teamB, setTeamB] = useState("1");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [targetTeam, setTargetTeam] = useState("0");
  const [targetPrice, setTargetPrice] = useState("");
  // Strict target-time bounds, fixed when the page loads: the earliest
  // selectable minute is ceil(now + 1h) so the picker can never produce a
  // value the contract's 1-hour lead would reject; the latest is +30 days
  // (the contract's MAX_MARKET_WINDOW).
  const [targetMin] = useState(() => localDateTimeFromMs(ceilToMinute(Date.now() + 3_600_000)));
  const [targetMax] = useState(() => localDateTimeFromMs(Date.now() + 30 * 24 * 3_600_000));
  const [targetTime, setTargetTime] = useState(() => localDateTimeFromMs(ceilToMinute(Date.now() + 2 * 3_600_000)));
  const [targetAbove, setTargetAbove] = useState(true);
  const [spreadFixture, setSpreadFixture] = useState("0");
  const [spreadPoints, setSpreadPoints] = useState("5");
  const [fixtures, setFixtures] = useState<ApiFixture[]>([]);
  const [createdTerms, setCreatedTerms] = useState<Set<string>>(new Set());
  const [termsLoading, setTermsLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Eligibility engine: fixtures from the API + every market ever created
  // from the factory. `createdTerms` holds "md:N" (top-gainer), "fixture:N"
  // (spread) and "champion" for terms that can never be reused.
  useEffect(() => {
    if (!MARKET_FACTORY_ADDRESS) {
      setTermsLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const fixtureList = await api.fixtures();
        const count = (await publicClient.readContract({ address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "marketCount" })) as bigint;
        const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
        const infos = ids.length === 0 ? [] : await publicClient.multicall({
          contracts: ids.map((id) => ({ address: MARKET_FACTORY_ADDRESS, abi: MARKET_FACTORY_ABI, functionName: "marketInfo", args: [id] })) as any,
          allowFailure: true,
        }) as any[];
        const terms = new Set<string>();
        for (const result of infos) {
          if (result?.status !== "success") continue;
          const info = result.result as any;
          const id = Number(info.templateId ?? info[0]);
          const params = (info.params ?? info[7]) as `0x${string}`;
          if (id === TEMPLATES.TOP_GAINER) {
            const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), params);
            terms.add(`md:${Number(md)}`);
          } else if (id === TEMPLATES.SPREAD) {
            // Track the full (fixture, spreadPoints) pair — different spreads
            // on the same fixture are allowed; only exact duplicates are blocked.
            const [, fixture, spread] = decodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), params);
            terms.add(`fixture:${fixture.toString()}:${spread}`);
          } else if (id === TEMPLATES.CHAMPION) terms.add("champion");
        }
        if (alive) {
          setFixtures(fixtureList);
          setCreatedTerms(terms);
        }
      } catch {
        // The contract remains the authoritative validator; the UI just
        // degrades to stricter client-side checks below.
      } finally {
        if (alive) setTermsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [publicClient]);

  // Matchday cards for the top-gainer picker: every matchday with fixtures,
  // each flagged with exactly why it is or isn't selectable.
  const matchdayCards = useMemo<MatchdayCard[]>(() => {
    const byMd = new Map<number, ApiFixture[]>();
    for (const f of fixtures) {
      const group = byMd.get(f.matchdayIndex) ?? [];
      group.push(f);
      byMd.set(f.matchdayIndex, group);
    }
    return Array.from(byMd.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, group]) => {
        const startsAt = Math.min(...group.map((f) => Date.parse(f.windowStart)));
        const endsAt = Math.max(...group.map((f) => Date.parse(f.windowEnd)));
        const created = createdTerms.has(`md:${index}`);
        // The contract requires creation strictly before the window opens.
        const started = startsAt <= now;
        return { index, startsAt, endsAt, created, started, eligible: !created && !started };
      });
  }, [fixtures, createdTerms, now]);

  // Fixture options for the spread picker, each with its ineligibility reason.
  // A fixture is only blocked if a spread with the SAME points already exists —
  // different spreads (e.g. +10 vs +1) on the same fixture are allowed.
  const fixtureOptions = useMemo<FixtureOption[]>(() => {
    const points = spreadPoints.trim() === "" ? null : Number(spreadPoints);
    return [...fixtures]
      .sort((a, b) => a.matchdayIndex - b.matchdayIndex || Number(a.fixtureId) - Number(b.fixtureId))
      .map((fixture) => {
        let eligible = true;
        let reason = "";
        if (fixture.settled) {
          eligible = false;
          reason = "settled";
        } else if (fixture.kickoff !== null && Date.parse(fixture.kickoff) <= now) {
          // The contract rejects spread creation once kickoff has arrived,
          // even if the result hasn't been submitted yet.
          eligible = false;
          reason = "already started";
        } else if (
          points !== null &&
          Number.isFinite(points) &&
          createdTerms.has(`fixture:${fixture.fixtureId}:${points}`)
        ) {
          eligible = false;
          reason = `spread of ${points} already exists`;
        }
        return { fixture, eligible, reason };
      });
  }, [fixtures, createdTerms, now, spreadPoints]);

  const championAlreadyCreated = !termsLoading && createdTerms.has("champion");

  // Never leave the user parked on an ineligible default: when the term data
  // arrives (or time passes and a term lapses), move the selection to the
  // first eligible option.
  useEffect(() => {
    if (termsLoading) return;
    const md = matchdayCards.find((m) => m.index === Number(matchdayIndex));
    if (matchdayCards.length > 0 && !md?.eligible) {
      const first = matchdayCards.find((m) => m.eligible);
      if (first) setMatchdayIndex(String(first.index));
    }
    const opt = fixtureOptions.find((o) => String(o.fixture.fixtureId) === spreadFixture);
    if (fixtureOptions.length > 0 && !opt?.eligible) {
      const first = fixtureOptions.find((o) => o.eligible);
      if (first) setSpreadFixture(String(first.fixture.fixtureId));
    }
  }, [termsLoading, matchdayCards, fixtureOptions, matchdayIndex, spreadFixture]);

  const paramsError = useMemo(() => {
    if (termsLoading) return "Loading eligible terms…";
    if (templateId === null) return null;
    try {
      if (templateId === TEMPLATES.TOP_GAINER) {
        const md = matchdayCards.find((m) => m.index === Number(matchdayIndex));
        if (!md) throw new Error("Matchday data is still loading — wait a moment and try again");
        if (!md.eligible) {
          throw new Error(
            md.created
              ? `Matchday ${md.index + 1} already has a top-gainer market — pick another`
              : `Matchday ${md.index + 1} has already started — pick a future matchday`
          );
        }
      }
      if (templateId === TEMPLATES.CHAMPION && championAlreadyCreated) {
        throw new Error("The season champion market has already been created");
      }
      if (templateId === TEMPLATES.SPREAD) {
        const opt = fixtureOptions.find((o) => String(o.fixture.fixtureId) === spreadFixture);
        if (!opt) throw new Error("Select a fixture from the list");
        if (!opt.eligible) throw new Error(`Fixture #${opt.fixture.fixtureId} is not eligible (${opt.reason}) — pick another`);
      }
      encodeParams(templateId, {
        matchdayIndex,
        teamA,
        teamB,
        windowStart,
        windowEnd,
        targetTeam,
        targetPrice,
        targetTime,
        targetAbove,
        spreadFixture,
        spreadPoints,
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid parameters";
    }
  }, [
    termsLoading,
    templateId,
    matchdayIndex,
    teamA,
    teamB,
    windowStart,
    windowEnd,
    targetTeam,
    targetPrice,
    targetTime,
    targetAbove,
    spreadFixture,
    spreadPoints,
    matchdayCards,
    fixtureOptions,
    championAlreadyCreated,
  ]);

  if (!MARKET_FACTORY_ADDRESS) {
    return (
      <div className="py-10">
        <ErrorState
          message="The MarketFactory contract hasn't been deployed on this network yet."
          onRetry={() => router.back()}
        />
      </div>
    );
  }

  const busy = approveStatus === "pending" || createStatus === "pending";

  async function handleCreate() {
    if (templateId === null || !address || !publicClient || paramsError) return;
    const params = encodeParams(templateId, {
      matchdayIndex,
      teamA,
      teamB,
      windowStart,
      windowEnd,
      targetTeam,
      targetPrice,
      targetTime,
      targetAbove,
      spreadFixture,
      spreadPoints,
    });

    const activeRaw = (await publicClient.readContract({
      address: MARKET_FACTORY_ADDRESS,
      abi: MARKET_FACTORY_ABI,
      functionName: "activeMarket",
      args: [templateId, params],
    })) as any;
    const activeExists = Boolean(activeRaw.exists ?? activeRaw[0]);
    const activeId = (activeRaw.marketId ?? activeRaw[1]) as bigint;
    if (activeExists) {
      setDuplicateMarketId(activeId);
      return;
    }
    setDuplicateMarketId(null);

    // Immutable-term guard: a market with these exact terms was created
    // before (it has since resolved or been voided), so the terms can never
    // be reused. Catch the friendly case up front instead of letting the
    // transaction revert on-chain. The try/catch keeps this page working
    // against a factory deployed before the createdMarket getter existed.
    try {
      const createdRaw = (await publicClient.readContract({
        address: MARKET_FACTORY_ADDRESS,
        abi: MARKET_FACTORY_ABI,
        functionName: "createdMarket",
        args: [templateId, params],
      })) as any;
      const wasCreated = Boolean(createdRaw.created ?? createdRaw[0]);
      const createdId = (createdRaw.marketId ?? createdRaw[1]) as bigint;
      if (wasCreated) {
        setReusedMarketId(createdId);
        return;
      }
    } catch {
      // Getter unavailable on this factory deployment — the on-chain
      // immutable-term guard isn't live there either, so proceed.
    }
    setReusedMarketId(null);

    // 1. Approve the 250 TICK seed.
    const seedWei = BigInt(CREATION_SEED_TICK) * 10n ** 18n;
    const allowance = (await publicClient.readContract({
      address: CONTRACTS.tickToken as `0x${string}`,
      abi: TICK_TOKEN_ABI,
      functionName: "allowance",
      args: [address, MARKET_FACTORY_ADDRESS],
    })) as bigint;
    if (allowance < seedWei) {
      await writeApprove({
        address: CONTRACTS.tickToken as `0x${string}`,
        abi: TICK_TOKEN_ABI,
        functionName: "approve",
        args: [MARKET_FACTORY_ADDRESS, seedWei],
      });
    }

    // 2. Create the market.
    await writeCreate({
      address: MARKET_FACTORY_ADDRESS,
      abi: MARKET_FACTORY_ABI,
      functionName: "createMarket",
      args: [templateId, params, (myProfile?.username || creatorName).slice(0, 32)],
    });

    // 3. Go to the markets list.
    router.push("/markets");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <button
        onClick={() => (step > 1 ? setStep(step - 1) : router.back())}
        className="mb-4 flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-[#2E7CF6]"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <SectionTitle title="Create a prediction market" />
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">
        Pick a template, set the terms, pay the {CREATION_SEED_TICK} TICK seed —
        your market is live and anyone can stake on it. Resolution is automatic
        and fully on-chain.
      </p>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                step >= s
                  ? "bg-[#2E7CF6] text-white"
                  : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
              )}
            >
              {step > s ? <Check className="h-4 w-4" /> : s}
            </div>
            {s < 3 && <div className="h-0.5 w-12 bg-zinc-200 dark:bg-zinc-800" />}
          </div>
        ))}
        <div className="ml-2 text-sm text-zinc-500">
          {step === 1 ? "Choose template" : step === 2 ? "Set terms" : "Launch"}
        </div>
      </div>

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {TEMPLATE_IDS.map((id, index) => {
            const Icon = TEMPLATE_ICONS[index];
            const unavailable = id === TEMPLATES.H2H || (id === TEMPLATES.CHAMPION && championAlreadyCreated);
            return (
            <button
              key={id}
              disabled={unavailable}
              onClick={() => {
                if (unavailable) return;
                setTemplateId(id);
                setStep(2);
              }}
              className={cn(
                "glass group rounded-2xl border border-transparent p-5 text-left transition-all hover:-translate-y-0.5 hover:border-[#2E7CF6]/50 hover:shadow-[0_0_30px_rgba(46,124,246,0.15)]",
                templateId === id && "border-[#2E7CF6]/60",
                unavailable && "cursor-not-allowed opacity-50 grayscale"
              )}
            >
              <div className="mb-4 flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2E7CF6]/10 text-[#2E7CF6] transition-colors group-hover:bg-[#2E7CF6] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-black/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-white/5">Template {index + 1}</span>
              </div>
              <div className="mb-2 font-display text-base font-bold">{TEMPLATE_NAMES[id]}</div>
              {id === TEMPLATES.H2H && <span className="mb-2 inline-block text-xs font-semibold uppercase tracking-wide text-zinc-500">Coming soon</span>}
              {id === TEMPLATES.CHAMPION && championAlreadyCreated && <span className="mb-2 inline-block text-xs font-semibold uppercase tracking-wide text-zinc-500">Already created</span>}
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {TEMPLATE_DESCRIPTIONS[id]}
              </p>
            </button>
            );
          })}
        </div>
      )}

      {step === 2 && templateId !== null && (
        <div className="glass rounded-2xl p-6">
          <h3 className="mb-1 font-semibold">{TEMPLATE_NAMES[templateId]}</h3>
          <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            {TEMPLATE_DESCRIPTIONS[templateId]}
          </p>
          <TemplateParamsForm
            templateId={templateId}
            teams={teams ?? []}
            matchdayCards={matchdayCards}
            fixtureOptions={fixtureOptions}
            termsLoading={termsLoading}
            targetMin={targetMin}
            targetMax={targetMax}
            currentTargetPrice={prices[teams.find((team) => team.teamId === Number(targetTeam))?.symbol ?? ""] ?? null}
            priceFeedStatus={priceFeedStatus}
            values={{
              matchdayIndex,
              setMatchdayIndex,
              teamA,
              setTeamA,
              teamB,
              setTeamB,
              windowStart,
              setWindowStart,
              windowEnd,
              setWindowEnd,
              targetTeam,
              setTargetTeam,
              targetPrice,
              setTargetPrice,
              targetTime,
              setTargetTime,
              targetAbove,
              setTargetAbove,
              spreadFixture,
              setSpreadFixture,
              spreadPoints,
              setSpreadPoints,
            }}
          />
          {paramsError && (
            <p className="mt-4 text-sm text-red-500">{paramsError}</p>
          )}
          <button
            onClick={() => setStep(3)}
            disabled={!!paramsError}
            className="gradient-cta mt-6 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === 3 && templateId !== null && (
        <div className="glass rounded-2xl p-6">
          <h3 className="mb-4 font-semibold">Launch your market</h3>

          <label className="mb-1 block text-sm font-medium">
            Display name <span className="text-zinc-400">(shown as “created by”, max 32 chars)</span>
          </label>
          {myProfile?.username ? (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-[#2E7CF6]/30 bg-[#2E7CF6]/[0.08] px-4 py-2.5 text-sm dark:bg-[#2E7CF6]/10">
              <Check className="h-4 w-4 text-[#2E7CF6]" />
              <span className="text-zinc-500 dark:text-zinc-400">Posting as</span>
              <span className="font-bold text-zinc-900 dark:text-white">@{myProfile.username}</span>
            </div>
          ) : (
            <input
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value.slice(0, 32))}
              placeholder="e.g. diego"
              className="mb-6 w-full rounded-xl border border-black/10 bg-white/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[#2E7CF6]/60 dark:border-white/10 dark:bg-black/30"
            />
          )}

          <div className="mb-6 rounded-xl bg-blue-500/5 p-4 text-sm">
            <div className="mb-2 flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2E7CF6]" />
              <div className="text-zinc-600 dark:text-zinc-300">
                <strong>How the {CREATION_SEED_TICK} TICK seed works:</strong> it goes
                into your market's pool as <em>unallocated</em> liquidity — not a bet
                on any outcome. At settlement it's added whole to the winners'
                payout pool, subsidizing payouts and attracting stakers. If your
                market resolves with zero stakes, the seed goes to the treasury.
                If it's voided (oracle failure), you get it back.
              </div>
            </div>
            <div className="text-zinc-600 dark:text-zinc-300">
              <strong>Creator reward:</strong> 2% of all staked volume (not the seed)
              goes to you automatically at settlement. Treasury takes 3%, and the
              resolver (whoever calls resolve()) earns 1%.
            </div>
          </div>

          {!authenticated ? (
            <p className="text-sm text-amber-600">Sign in to create a market.</p>
          ) : !walletsReady || !walletReady ? (
            <p className="text-sm text-amber-600">Your wallet is still initializing. Please wait a moment.</p>
          ) : (
            <button
              onClick={handleCreate}
            disabled={busy || (!creatorName.trim() && !myProfile?.username)}
              className="gradient-cta flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(46,124,246,0.4)] disabled:opacity-40"
            >
              {busy ? "Confirm in wallet…" : `Pay ${CREATION_SEED_TICK} TICK & launch`}
            </button>
          )}
          {(approveStatus === "error" || createStatus === "error") && (
            <p className="mt-3 text-sm text-red-500">
              Transaction failed or was rejected. Check your wallet and try again.
            </p>
          )}
          {duplicateMarketId !== null && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              An unresolved market with these exact terms already exists. You can join it instead: {" "}
              <button className="underline" onClick={() => router.push(`/markets/${duplicateMarketId}`)}>
                view market #{duplicateMarketId.toString()}
              </button>
            </p>
          )}
          {reusedMarketId !== null && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
              A market with these exact terms was already created (market #{reusedMarketId.toString()},
              now settled or voided). Terms can&apos;t be reused — pick a different matchday, fixture, or spread.{" "}
              <button className="underline" onClick={() => router.push(`/markets/${reusedMarketId}`)}>
                view market #{reusedMarketId.toString()}
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── param encoding (mirrors the contract's abi.decode expectations) ──

interface ParamValues {
  matchdayIndex: string;
  teamA: string;
  teamB: string;
  windowStart: string;
  windowEnd: string;
  targetTeam: string;
  targetPrice: string;
  targetTime: string;
  targetAbove: boolean;
  spreadFixture: string;
  spreadPoints: string;
}

function encodeParams(templateId: number, v: ParamValues): `0x${string}` {
  // Season ID from env (baked at build time) — never hardcode; the contract
  // validates params against the season's own registries.
  const seasonId = BigInt(process.env.NEXT_PUBLIC_SEASON_ID?.trim() || "2");
  if (templateId === TEMPLATES.TOP_GAINER) {
    const md = Number(v.matchdayIndex);
    if (!Number.isInteger(md) || md < 0 || md > 37) throw new Error("Matchday must be 0–37");
    return encodeAbiParameters(parseAbiParameters("uint256, uint8"), [seasonId, md]);
  }
  if (templateId === TEMPLATES.CHAMPION) {
    return encodeAbiParameters(parseAbiParameters("uint256"), [seasonId]);
  }
  if (templateId === TEMPLATES.H2H) {
    const a = Number(v.teamA);
    const b = Number(v.teamB);
    if (a === b) throw new Error("Pick two different teams");
    const start = Math.floor(new Date(v.windowStart).getTime() / 1000);
    const end = Math.floor(new Date(v.windowEnd).getTime() / 1000);
    if (!start || !end || start >= end) throw new Error("Window end must be after window start");
    if (end - start > 30 * 24 * 3600) throw new Error("Window can't exceed 30 days");
    // Mirrors the contract's MIN_MARKET_LEAD guard on endTime.
    if (end <= Date.now() / 1000 + 3600) throw new Error("Window end must be at least 1 hour out");
    return encodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), [a, b, BigInt(start), BigInt(end)]);
  }
  if (templateId === TEMPLATES.TARGET) {
    const price = Number(v.targetPrice);
    if (!price || price <= 0) throw new Error("Enter a target price above 0");
    const at = Math.floor(new Date(v.targetTime).getTime() / 1000);
    // Mirrors the contract: atTime must be in (now + 1h, now + 30d].
    if (!at || at <= Date.now() / 1000 + 3600) throw new Error("Target time must be at least 1 hour out");
    if (at > Date.now() / 1000 + 30 * 24 * 3600) throw new Error("Target time can't be more than 30 days out");
    // Price scaled by 1e8 (PRICE_DECIMALS).
    const scaled = BigInt(Math.round(price * 1e8));
    return encodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), [
      Number(v.targetTeam),
      scaled,
      BigInt(at),
      v.targetAbove,
    ]);
  }
  // SPREAD
  const fixture = Number(v.spreadFixture);
  const spread = Number(v.spreadPoints);
  if (!Number.isInteger(fixture) || fixture < 0) throw new Error("Enter a valid fixture id");
  if (!Number.isInteger(spread)) throw new Error("Spread must be a whole number of points");
  return encodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), [seasonId, BigInt(fixture), spread]);
}

// ── step-2 param forms ──

function TemplateParamsForm({
  templateId,
  teams,
  matchdayCards,
  fixtureOptions,
  termsLoading,
  targetMin,
  targetMax,
  currentTargetPrice,
  priceFeedStatus,
  values: v,
}: {
  templateId: number;
  teams: { teamId: number; symbol: string; name: string }[];
  matchdayCards: MatchdayCard[];
  fixtureOptions: FixtureOption[];
  termsLoading: boolean;
  targetMin: string;
  targetMax: string;
  currentTargetPrice: number | null;
  priceFeedStatus: "live" | "polling" | "stale";
  values: any;
}) {
  const inputCls =
    "w-full rounded-xl border border-black/10 bg-white/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[#2E7CF6]/60 dark:border-white/10 dark:bg-black/30";
  const labelCls = "mb-1 block text-sm font-medium";

  if (templateId === TEMPLATES.TOP_GAINER) {
    return (
      <div>
        <label className={labelCls}>Matchday</label>
        {termsLoading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[86px] animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />
            ))}
          </div>
        ) : matchdayCards.length === 0 ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
            Couldn&apos;t load matchdays. Check your connection and reload the page.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {matchdayCards.map((md) => {
              const selected = v.matchdayIndex === String(md.index);
              const disabled = !md.eligible;
              return (
                <button
                  key={md.index}
                  type="button"
                  disabled={disabled}
                  onClick={() => v.setMatchdayIndex(String(md.index))}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    selected
                      ? "border-[#2E7CF6] bg-[#2E7CF6]/10 shadow-[0_0_18px_rgba(46,124,246,0.25)]"
                      : "border-black/10 bg-white/40 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:bg-black/20",
                    disabled && "cursor-not-allowed opacity-45 grayscale hover:border-black/10 dark:hover:border-white/10"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Matchday {md.index + 1}</span>
                    {selected && <Check className="h-4 w-4 text-[#2E7CF6]" />}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{formatRange(md.startsAt, md.endsAt)}</div>
                  <div className="mt-2">
                    {md.eligible ? (
                      <span className="inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        Available
                      </span>
                    ) : md.created ? (
                      <span className="inline-block rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                        Already created
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Started
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          One market per matchday, created before its window opens. Betting closes 5 minutes before the
          window ends; resolves from the oracle checkpoints at the window edges.
        </p>
      </div>
    );
  }

  if (templateId === TEMPLATES.CHAMPION) {
    return (
      <p className="text-sm text-zinc-500">
        No parameters needed — this market covers {SEASON_DISPLAY_NAME} and resolves when every
        fixture has settled. Betting closes 5 minutes before the season ends.
        It can only ever be created once.
      </p>
    );
  }

  if (templateId === TEMPLATES.H2H) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Team A</label>
          <TeamSelect value={v.teamA} onChange={v.setTeamA} teams={teams} inputCls={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Team B</label>
          <TeamSelect value={v.teamB} onChange={v.setTeamB} teams={teams} inputCls={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Window start</label>
          <input
            type="datetime-local"
            value={v.windowStart}
            onChange={(e) => v.setWindowStart(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Window end (max 30 days after start, ≥ 1 hour out)</label>
          <input
            type="datetime-local"
            value={v.windowEnd}
            onChange={(e) => v.setWindowEnd(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
    );
  }

  if (templateId === TEMPLATES.TARGET) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Team</label>
          <TeamSelect value={v.targetTeam} onChange={v.setTargetTeam} teams={teams} inputCls={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <select
            value={v.targetAbove ? "above" : "below"}
            onChange={(e) => v.setTargetAbove(e.target.value === "above")}
            className={inputCls}
          >
            <option value="above">Price ends ABOVE target (Yes wins)</option>
            <option value="below">Price ends BELOW target (Yes wins)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Target price (USD)</label>
          <p className="mb-2 text-xs text-zinc-500" aria-live="polite">
            {currentTargetPrice !== null
              ? <>Current {teams.find((team) => team.teamId === Number(v.targetTeam))?.symbol ?? "coin"} price: <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">${currentTargetPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span> <span className="text-zinc-400">({priceFeedStatus === "live" ? "live" : priceFeedStatus === "polling" ? "updating" : "stale"} guide)</span></>
              : "Current coin price is loading; it will appear here as a guide."}
          </p>
          <input
            type="number"
            step="any"
            min={0}
            value={v.targetPrice}
            onChange={(e) => v.setTargetPrice(e.target.value)}
            placeholder="e.g. 100000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>At time <span className="font-normal text-zinc-400">(earliest {formatDateTimeLocal(targetMin)})</span></label>
          <input
            type="datetime-local"
            value={v.targetTime}
            min={targetMin}
            max={targetMax}
            onChange={(e) => v.setTargetTime(e.target.value)}
            className={inputCls}
          />
          <p className="mt-2 text-xs text-zinc-500">
            Defaults to 2 hours from now. You can choose a time at least 1 hour out and no more than 30 days out.
          </p>
        </div>
      </div>
    );
  }

  // SPREAD — fixtures grouped by matchday; only unplayed fixtures without a
  // spread market yet are selectable.
  const groups = new Map<number, FixtureOption[]>();
  for (const opt of fixtureOptions) {
    const g = groups.get(opt.fixture.matchdayIndex) ?? [];
    g.push(opt);
    groups.set(opt.fixture.matchdayIndex, g);
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className={labelCls}>Fixture</label>
        <select
          value={v.spreadFixture}
          onChange={(e) => v.setSpreadFixture(e.target.value)}
          className={inputCls}
          disabled={termsLoading}
        >
          <option value="" disabled>{termsLoading ? "Loading fixtures…" : "Select an eligible fixture"}</option>
          {sortedGroups.map(([mdIndex, opts]) => (
            <optgroup key={mdIndex} label={`Matchday ${mdIndex + 1}`}>
              {opts.map(({ fixture, eligible, reason }) => (
                <option key={fixture.fixtureId} value={fixture.fixtureId} disabled={!eligible}>
                  #{fixture.fixtureId} · {fixture.home?.symbol ?? "TBA"} v {fixture.away?.symbol ?? "TBA"}
                  {!eligible ? ` — ${reason}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-2 text-xs text-zinc-500">
          Only fixtures yet to be played, without a spread market yet. Betting follows the
          fixture&apos;s own in-play window (open until 5 min before the match ends).
        </p>
      </div>
      <div>
        <label className={labelCls}>Spread (goals, home team)</label>
        <input
          type="number"
          step={1}
          value={v.spreadPoints}
          onChange={(e) => v.setSpreadPoints(e.target.value)}
          className={inputCls}
        />
        <p className="mt-2 text-xs text-zinc-500">
          1 goal = 0.5% price move. Home covers if (home goals − away goals) is strictly greater than the spread.
        </p>
      </div>
    </div>
  );
}

function TeamSelect({
  value,
  onChange,
  teams,
  inputCls,
}: {
  value: string;
  onChange: (v: string) => void;
  teams: { teamId: number; symbol: string; name: string; imageUrl?: string | null }[];
  inputCls: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {teams.map((t) => (
        <button key={t.teamId} type="button" onClick={() => onChange(String(t.teamId))}
          className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-all", value === String(t.teamId) ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#1D4ED8] dark:text-[#7db3ff]" : "border-black/10 bg-white/40 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:bg-black/20")}
        >
          <TeamBadge teamId={t.teamId} size={24} showName={false} />
          <span className="min-w-0"><span className="block font-bold">{t.symbol}</span><span className="block truncate text-zinc-500">{t.name}</span></span>
        </button>
      ))}
    </div>
  );
}
