/**
 * React Query key factory for TICKR.
 *
 * One canonical key per data domain. Invalidation is hierarchical:
 * - qks.markets ......... the whole board (["tickr","markets"])
 * - qks.market(id) ....... one market     (["tickr","market",id])
 * - qks.oddsHistory(id) .. sparkline data (["tickr","oddsHistory",id])
 * - qks.balance(addr) .... TICK balance   (["tickr","balance",addr])
 * - qks.fixtures ......... fixture dir    (["tickr","fixtures"])
 * - qks.leaderboard(..) .. leaderboard    (["tickr","leaderboard",scope])
 * - qks.profile(name) .... social profile (["tickr","profile",name])
 *
 * The factory event subscriber (lib/query/useFactoryEvents.ts) invalidates
 * exactly these keys, so every consumer stays in sync with one subscription.
 */

export const qks = {
  markets: ["tickr", "markets"] as const,
  market: (id: number | string | bigint) =>
    ["tickr", "market", id.toString()] as const,
  oddsHistory: (id: number | string | bigint) =>
    ["tickr", "oddsHistory", id.toString()] as const,
  balance: (address: string) =>
    ["tickr", "balance", address.toLowerCase()] as const,
  fixtures: ["tickr", "fixtures"] as const,
  leaderboard: (scope: string = "all") =>
    ["tickr", "leaderboard", scope] as const,
  profile: (username: string) =>
    ["tickr", "profile", username.toLowerCase()] as const,
} as const;

export type QueryKeys = typeof qks;
