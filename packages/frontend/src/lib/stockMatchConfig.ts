/**
 * Stock League match config.
 *
 * Target location in the repo:
 *   packages/frontend/src/lib/stockMatchConfig.ts
 *
 * FIX NOTE, read this before touching the crypto side.
 * There is no lib/matchConfig.ts in the repo at origin/main bad5ca6, and
 * there is no lib/utcTime.ts either. The task description assumed both
 * exist. What actually exists is worse, and it is the bug this file
 * avoids repeating:
 *
 *   1. packages/frontend/src/components/FixtureCard.tsx reads the match
 *      length from the shared constant TICKR_V01_CONFIG
 *      .MATCH_DURATION_SECONDS, which is 45 * 60 in
 *      packages/shared/src/constants.ts. That 45-minute value is stale.
 *      The live league plays 1-hour matches.
 *   2. packages/frontend/src/app/match/[id]/page.tsx hardcodes the
 *      correct value instead: const MATCH_MS = 60 * 60 * 1000.
 *   3. So FixtureCard and the match page disagree by 15 minutes. A
 *      fixture shows as "live" in one place and "awaiting" in the other
 *      during minutes 45 to 60, and the live window countdown is wrong
 *      on cards.
 *   4. contracts.ts reads NEXT_PUBLIC_MATCH_REGISTRY_S1_ADDRESS, and
 *      .env.example does define that var. The task description said the
 *      frontend reads NEXT_PUBLIC_MATCH_REGISTRY_ADDRESS, which is not
 *      in the repo. The real bug is the 45-minute constant, not the env
 *      name. Do not "fix" the env name on the crypto side without
 *      checking the deployed registry address first.
 *
 * Crypto fix (do separately, with the engineering team, not in this
 * stock file): delete the shared-constant read in FixtureCard.tsx and
 * the hardcode in match/[id]/page.tsx, and have both import one
 * MATCH_MS from a single matchConfig module that reads
 * NEXT_PUBLIC_MATCH_DURATION_MINUTES with a 60-minute fallback. The
 * stock code below already does exactly that, for the stock registry.
 *
 * Stock rule in this file:
 *   - Registry address comes from NEXT_PUBLIC_STOCK_MATCH_REGISTRY_ADDRESS.
 *   - Duration comes from NEXT_PUBLIC_STOCK_MATCH_DURATION_MINUTES.
 *   - Fallback is 60 minutes, NOT the stale 45-minute shared constant.
 *   - Never import MATCH_DURATION_SECONDS from @tickr/shared/constants.
 */

export const STOCK_MATCH_DURATION_MINUTES = (() => {
  const raw = process.env.NEXT_PUBLIC_STOCK_MATCH_DURATION_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 60;
})();

export const STOCK_MATCH_MS = STOCK_MATCH_DURATION_MINUTES * 60 * 1000;
export const STOCK_MATCH_SECONDS = STOCK_MATCH_DURATION_MINUTES * 60;

/** In-play betting closes 5 minutes before full time, same as crypto. */
export const STOCK_INPLAY_CLOSE_BUFFER_MS = 5 * 60 * 1000;

/** Stock registry address, "" when not configured yet. */
export function stockMatchRegistryAddress(): string {
  return (process.env.NEXT_PUBLIC_STOCK_MATCH_REGISTRY_ADDRESS ?? "").trim();
}

/**
 * Effective match end for a kickoff timestamp (ms). Prefers the on-chain
 * matchEndTimestamp when the caller has it, otherwise kickoff + 60 min.
 * The on-chain value wins because the registry is the source of truth
 * once a fixture is scheduled. The 60-minute fallback only covers
 * fixtures whose on-chain end has not been read yet.
 */
export function stockMatchEndMs(
  kickoffMs: number | null,
  onChainMatchEndMs?: number | null
): number | null {
  if (onChainMatchEndMs && onChainMatchEndMs > 0) return onChainMatchEndMs;
  if (kickoffMs === null || kickoffMs <= 0) return null;
  return kickoffMs + STOCK_MATCH_MS;
}

/** Betting close for a match end (ms): 5 minutes before full time. */
export function stockBettingCloseMs(matchEndMs: number | null): number | null {
  if (matchEndMs === null) return null;
  return matchEndMs - STOCK_INPLAY_CLOSE_BUFFER_MS;
}
