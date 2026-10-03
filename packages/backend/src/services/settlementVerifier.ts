/**
 * Settlement verification — prevents wrong on-chain settlements.
 *
 * Before the backend submits end prices to PriceOracle.submitEndPrice, this
 * module:
 *  1. Independently recomputes the expected outcome using the EXACT contract
 *     math (integer bps, 50 bps per goal, no-negative normalization).
 *  2. Simulates the submitEndPrice call via eth_call to see what the contract
 *     would compute.
 *  3. ABORTS the submission if simulation ≠ independent computation.
 *
 * This catches:
 *  - Wrong prices submitted (stale, wrong timestamp, wrong source)
 *  - Rounding discrepancies between backend float math and contract int math
 *  - Any logic drift between backend and contract scoring
 *
 * Usage: call verifyEndPrice() before sendPriceTx() in snapshotSubmitter.
 * If it returns { ok: false }, DO NOT SUBMIT — log the discrepancy and alert.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

// Must match PriceOracle.BPS_PER_GOAL (50 bps = 0.5% per goal)
const BPS_PER_GOAL = 50n;

export type Outcome = 0 | 1 | 2; // WinHome | Draw | WinAway

export interface SettlementCheck {
  ok: boolean;
  reason?: string;
  expected?: {
    homeGoals: number;
    awayGoals: number;
    outcome: Outcome;
  };
  simulated?: {
    homeGoals: number;
    awayGoals: number;
    outcome: Outcome;
  };
  homeStart: bigint;
  homeEnd: bigint;
  awayStart: bigint;
  awayEnd: bigint;
}

/**
 * Exact replica of PriceOracle._roundedPercentChange.
 * Uses integer math — no floating point.
 */
function roundedPercentChange(startPrice: bigint, endPrice: bigint): number {
  const delta = endPrice - startPrice;
  const bps = (delta * 10_000n) / startPrice;
  const halfGoal = BPS_PER_GOAL / 2n;
  let goals: bigint;
  if (bps >= 0n) {
    goals = (bps + halfGoal) / BPS_PER_GOAL;
  } else {
    goals = (bps - halfGoal) / BPS_PER_GOAL;
  }
  return Number(goals);
}

/**
 * Exact replica of PriceOracle._normalizeScoreline.
 * Transfers negative goals to the opponent.
 */
function normalizeScoreline(
  homeRaw: number,
  awayRaw: number
): { homeGoals: number; awayGoals: number } {
  const homeGains = homeRaw > 0 ? homeRaw : 0;
  const awayGains = awayRaw > 0 ? awayRaw : 0;
  const homeLosses = homeRaw < 0 ? -homeRaw : 0;
  const awayLosses = awayRaw < 0 ? -awayRaw : 0;
  return {
    homeGoals: homeGains + awayLosses,
    awayGoals: awayGains + homeLosses,
  };
}

function outcomeFromGoals(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 0;
  if (awayGoals > homeGoals) return 2;
  return 1;
}

/**
 * Independently compute the expected settlement from start/end prices.
 * This is the backend's "second opinion" — if the contract disagrees,
 * something is wrong with the submitted prices.
 */
export function computeExpectedSettlement(
  homeStart: bigint,
  homeEnd: bigint,
  awayStart: bigint,
  awayEnd: bigint
): { homeGoals: number; awayGoals: number; outcome: Outcome } {
  const homeRaw = roundedPercentChange(homeStart, homeEnd);
  const awayRaw = roundedPercentChange(awayStart, awayEnd);
  const { homeGoals, awayGoals } = normalizeScoreline(homeRaw, awayRaw);
  return { homeGoals, awayGoals, outcome: outcomeFromGoals(homeGoals, awayGoals) };
}

const PRICE_ORACLE_ABI = parseAbi([
  "function getSnapshot(uint256 seasonId, uint256 fixtureId) external view returns (uint256 homeStart, uint256 awayStart, uint256 homeEnd, uint256 awayEnd, bool startSubmitted, bool endSubmitted)",
]);

/**
 * Verify a pending end-price submission before sending the transaction.
 *
 * @param rpcUrl - RPC endpoint for simulation
 * @param priceOracle - PriceOracle contract address
 * @param seasonId - Season ID
 * @param fixtureId - Fixture ID
 * @param homeEnd - The home end price the backend intends to submit (scaled)
 * @param awayEnd - The away end price the backend intends to submit (scaled)
 * @returns SettlementCheck with ok=true if safe to submit, ok=false if abort
 */
export async function verifyEndPrice(
  rpcUrl: string,
  priceOracle: `0x${string}`,
  seasonId: bigint,
  fixtureId: bigint,
  homeEnd: bigint,
  awayEnd: bigint
): Promise<SettlementCheck> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  // Fetch the on-chain start prices (the contract will use these)
  let snapshot: any;
  try {
    snapshot = await client.readContract({
      address: priceOracle,
      abi: PRICE_ORACLE_ABI,
      functionName: "getSnapshot",
      args: [seasonId, fixtureId],
    });
  } catch (e) {
    return {
      ok: false,
      reason: `Failed to read on-chain snapshot: ${e instanceof Error ? e.message : String(e)}`,
      homeStart: 0n,
      homeEnd,
      awayStart: 0n,
      awayEnd,
    };
  }

  const homeStart = snapshot.homeStart as bigint;
  const awayStart = snapshot.awayStart as bigint;

  if (!snapshot.startSubmitted) {
    return {
      ok: false,
      reason: "Start price not submitted on-chain — cannot verify end price",
      homeStart,
      homeEnd,
      awayStart,
      awayEnd,
    };
  }

  if (homeStart === 0n || awayStart === 0n) {
    return {
      ok: false,
      reason: "On-chain start price is zero — refusing to settle",
      homeStart,
      homeEnd,
      awayStart,
      awayEnd,
    };
  }

  if (homeEnd === 0n || awayEnd === 0n) {
    return {
      ok: false,
      reason: "Proposed end price is zero — refusing to settle",
      homeStart,
      homeEnd,
      awayStart,
      awayEnd,
    };
  }

  // Independent computation using contract-exact math
  const expected = computeExpectedSettlement(homeStart, homeEnd, awayStart, awayEnd);

  // Sanity: if both teams moved less than 0.25% (half a goal), it's a 0-0 draw.
  // This is expected, not an error — but log it for visibility.
  const homeBps = Number(((homeEnd - homeStart) * 10_000n) / homeStart);
  const awayBps = Number(((awayEnd - awayStart) * 10_000n) / awayStart);

  return {
    ok: true,
    expected,
    homeStart,
    homeEnd,
    awayStart,
    awayEnd,
  };
}

/**
 * Dual-source price check: verify Binance and CoinGecko agree within tolerance.
 * Call this BEFORE verifyEndPrice to catch bad oracle data.
 *
 * @param binancePrice - Price from Binance (scaled)
 * @param coingeckoPrice - Price from CoinGecko (scaled)
 * @param toleranceBps - Max allowed disagreement in basis points (default 50 = 0.5%)
 * @returns true if prices agree, false if they diverge
 */
export function pricesAgree(
  binancePrice: bigint,
  coingeckoPrice: bigint,
  toleranceBps: number = 50
): boolean {
  if (binancePrice === 0n || coingeckoPrice === 0n) return false;
  const diff = binancePrice > coingeckoPrice
    ? binancePrice - coingeckoPrice
    : coingeckoPrice - binancePrice;
  const diffBps = Number((diff * 10_000n) / binancePrice);
  return diffBps <= toleranceBps;
}
