/**
 * Create market page (v0.2): permissionless market creation flow.
 *
 * Step 1: pick a template (5 cards with descriptions).
 * Step 2: fill template params (validated client-side, re-validated on-chain).
 * Step 3: enter a display name, approve 250 TICK, create.
 *
 * The 250 TICK is NOT a bet — it's seed liquidity that goes into the
 * market's pool unallocated and subsidizes winner payouts at settlement.
 * The creator can still stake on their own market afterwards like anyone.
 */

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { useAccount } from "wagmi";
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
import { CONTRACTS, TICK_TOKEN_ABI } from "../../../lib/contracts";
import { SectionTitle, ErrorState } from "../../../components/States";
import { cn } from "../../../lib/cn";

const TEMPLATE_IDS = [
  TEMPLATES.TOP_GAINER,
  TEMPLATES.CHAMPION,
  TEMPLATES.H2H,
  TEMPLATES.TARGET,
  TEMPLATES.SPREAD,
];

export default function CreateMarketPage() {
  const router = useRouter();
  const { address } = useAccount();
  const publicClient = getPublicClient();
  const { teams } = useTeams();
  const { write: writeApprove, status: approveStatus } = useContractWrite();
  const { write: writeCreate, status: createStatus } = useContractWrite();

  const [step, setStep] = useState(1);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [creatorName, setCreatorName] = useState("");
  // Template params (as strings from inputs).
  const [matchdayIndex, setMatchdayIndex] = useState("0");
  const [teamA, setTeamA] = useState("0");
  const [teamB, setTeamB] = useState("1");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [targetTeam, setTargetTeam] = useState("0");
  const [targetPrice, setTargetPrice] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [targetAbove, setTargetAbove] = useState(true);
  const [spreadFixture, setSpreadFixture] = useState("0");
  const [spreadPoints, setSpreadPoints] = useState("5");

  const paramsError = useMemo(() => {
    if (templateId === null) return null;
    try {
      encodeParams(templateId, {
        matchdayIndex,
        teamA,
        teamB,
        windowStart,
        windowEnd,
        targetTeam,
        targetPrice,
        targetTime,
        spreadFixture,
        spreadPoints,
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid parameters";
    }
  }, [
    templateId,
    matchdayIndex,
    teamA,
    teamB,
    windowStart,
    windowEnd,
    targetTeam,
    targetPrice,
    targetTime,
    spreadFixture,
    spreadPoints,
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
      spreadFixture,
      spreadPoints,
    });

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
    const receipt = (await writeCreate({
      address: MARKET_FACTORY_ADDRESS,
      abi: MARKET_FACTORY_ABI,
      functionName: "createMarket",
      args: [templateId, params, creatorName.slice(0, 32)],
    })) as any;

    // 3. Go to the new market. (MarketCreated event carries the id; fall
    // back to the markets list if decoding fails.)
    try {
      const logs = receipt?.logs ?? [];
      router.push("/markets");
    } catch {
      router.push("/markets");
    }
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
          {TEMPLATE_IDS.map((id) => (
            <button
              key={id}
              onClick={() => {
                setTemplateId(id);
                setStep(2);
              }}
              className={cn(
                "glass rounded-2xl p-5 text-left transition-all hover:border-[#2E7CF6]/40 hover:shadow-[0_0_30px_rgba(46,124,246,0.15)]",
                templateId === id && "border-[#2E7CF6]/60"
              )}
            >
              <div className="mb-2 font-semibold">{TEMPLATE_NAMES[id]}</div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {TEMPLATE_DESCRIPTIONS[id]}
              </p>
            </button>
          ))}
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
          <input
            value={creatorName}
            onChange={(e) => setCreatorName(e.target.value.slice(0, 32))}
            placeholder="e.g. diego"
            className="mb-6 w-full rounded-xl border border-black/10 bg-white/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[#2E7CF6]/60 dark:border-white/10 dark:bg-black/30"
          />

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

          {!address ? (
            <p className="text-sm text-amber-600">Connect your wallet to create a market.</p>
          ) : (
            <button
              onClick={handleCreate}
              disabled={busy || !creatorName.trim()}
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
  spreadFixture: string;
  spreadPoints: string;
}

function encodeParams(templateId: number, v: ParamValues): `0x${string}` {
  if (templateId === TEMPLATES.TOP_GAINER) {
    const md = Number(v.matchdayIndex);
    if (!Number.isInteger(md) || md < 0 || md > 37) throw new Error("Matchday must be 0–37");
    return encodeAbiParameters(parseAbiParameters("uint256, uint8"), [1n, md]);
  }
  if (templateId === TEMPLATES.CHAMPION) {
    return encodeAbiParameters(parseAbiParameters("uint256"), [1n]);
  }
  if (templateId === TEMPLATES.H2H) {
    const a = Number(v.teamA);
    const b = Number(v.teamB);
    if (a === b) throw new Error("Pick two different teams");
    const start = Math.floor(new Date(v.windowStart).getTime() / 1000);
    const end = Math.floor(new Date(v.windowEnd).getTime() / 1000);
    if (!start || !end || start >= end) throw new Error("Window end must be after window start");
    if (end - start > 30 * 24 * 3600) throw new Error("Window can't exceed 30 days");
    return encodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), [a, b, BigInt(start), BigInt(end)]);
  }
  if (templateId === TEMPLATES.TARGET) {
    const price = Number(v.targetPrice);
    if (!price || price <= 0) throw new Error("Enter a target price above 0");
    const at = Math.floor(new Date(v.targetTime).getTime() / 1000);
    if (!at || at <= Date.now() / 1000 + 3600) throw new Error("Target time must be at least 1 hour out");
    // Price scaled by 1e8 (PRICE_DECIMALS).
    const scaled = BigInt(Math.round(price * 1e8));
    return encodeAbiParameters(parseAbiParameters("uint16, uint256, uint64, bool"), [
      Number(v.targetTeam),
      scaled,
      BigInt(at),
      (v as any).targetAbove ?? true,
    ]);
  }
  // SPREAD
  const fixture = Number(v.spreadFixture);
  const spread = Number(v.spreadPoints);
  if (!Number.isInteger(fixture) || fixture < 0) throw new Error("Enter a valid fixture id");
  if (!Number.isInteger(spread)) throw new Error("Spread must be a whole number of points");
  return encodeAbiParameters(parseAbiParameters("uint256, uint256, int16"), [1n, BigInt(fixture), spread]);
}

function TemplateParamsForm({
  templateId,
  teams,
  values: v,
}: {
  templateId: number;
  teams: { teamId: number; symbol: string; name: string }[];
  values: any;
}) {
  const inputCls =
    "w-full rounded-xl border border-black/10 bg-white/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-[#2E7CF6]/60 dark:border-white/10 dark:bg-black/30";
  const labelCls = "mb-1 block text-sm font-medium";

  if (templateId === TEMPLATES.TOP_GAINER) {
    return (
      <div>
        <label className={labelCls}>Matchday (0–37)</label>
        <input
          type="number"
          min={0}
          max={37}
          value={v.matchdayIndex}
          onChange={(e) => v.setMatchdayIndex(e.target.value)}
          className={inputCls}
        />
        <p className="mt-2 text-xs text-zinc-500">
          Betting closes 5 minutes before the matchday window ends. Resolves from
          the oracle checkpoints at the window edges.
        </p>
      </div>
    );
  }

  if (templateId === TEMPLATES.CHAMPION) {
    return (
      <p className="text-sm text-zinc-500">
        No parameters needed — this market covers Season 1 and resolves when every
        fixture has settled. Betting closes 5 minutes before the season ends.
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
          <label className={labelCls}>Window end (max 30 days after start)</label>
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
          <label className={labelCls}>At time (≥ 1 hour out)</label>
          <input
            type="datetime-local"
            value={v.targetTime}
            onChange={(e) => v.setTargetTime(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className={labelCls}>Fixture id</label>
        <input
          type="number"
          min={0}
          value={v.spreadFixture}
          onChange={(e) => v.setSpreadFixture(e.target.value)}
          className={inputCls}
        />
        <p className="mt-2 text-xs text-zinc-500">
          Find fixture ids on the Fixtures page. Betting follows the fixture's
          own in-play window (open until 5 min before the match ends).
        </p>
      </div>
      <div>
        <label className={labelCls}>Spread (rounded % points, home team)</label>
        <input
          type="number"
          step={1}
          value={v.spreadPoints}
          onChange={(e) => v.setSpreadPoints(e.target.value)}
          className={inputCls}
        />
        <p className="mt-2 text-xs text-zinc-500">
          Home covers if (home % − away %) is strictly greater than the spread.
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
  teams: { teamId: number; symbol: string; name: string }[];
  inputCls: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {teams.map((t) => (
        <option key={t.teamId} value={String(t.teamId)}>
          {t.symbol} — {t.name}
        </option>
      ))}
    </select>
  );
}
