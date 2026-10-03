/**
 * First-login profile store (spec P3.2).
 *
 * Profiles live in localStorage, keyed by Privy user id. On-chain/DB
 * uniqueness is backend-deferred (see spec note) — here we enforce
 * client-side rules: non-empty, 3–20 chars, [a-zA-Z0-9_], and uniqueness
 * against the device-local username directory.
 *
 * The directory maps lowercase address -> { username, favouriteTeamId } so
 * the leaderboard and profile pages can resolve identities for addresses
 * this device has seen.
 */

export interface TickrProfile {
  username: string;
  favouriteTeamId: number;
  address: string; // smart-wallet (player) address, lowercase
  privyUserId: string;
  createdAt: number;
}

const profileKey = (privyUserId: string) => `tickr:profile:${privyUserId}`;
const DIRECTORY_KEY = "tickr:directory";

export function getProfile(privyUserId: string | null | undefined): TickrProfile | null {
  if (!privyUserId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(profileKey(privyUserId));
    return raw ? (JSON.parse(raw) as TickrProfile) : null;
  } catch {
    return null;
  }
}

/** True once the user has completed onboarding — fires once ever, not per login. */
export function hasOnboarded(privyUserId: string | null | undefined): boolean {
  return getProfile(privyUserId) !== null;
}

export function saveProfile(profile: TickrProfile): void {
  window.localStorage.setItem(profileKey(profile.privyUserId), JSON.stringify(profile));
  const dir = getDirectory();
  dir[profile.address.toLowerCase()] = {
    username: profile.username,
    favouriteTeamId: profile.favouriteTeamId,
  };
  window.localStorage.setItem(DIRECTORY_KEY, JSON.stringify(dir));
}

export function getDirectory(): Record<string, { username: string; favouriteTeamId: number }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(DIRECTORY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function resolveIdentity(address: string): {
  username: string | null;
  favouriteTeamId: number | null;
} {
  const hit = getDirectory()[address.toLowerCase()];
  return hit
    ? { username: hit.username, favouriteTeamId: hit.favouriteTeamId }
    : { username: null, favouriteTeamId: null };
}

export function findAddressByUsername(username: string): string | null {
  const dir = getDirectory();
  const want = username.toLowerCase();
  for (const [addr, v] of Object.entries(dir)) {
    if (v.username.toLowerCase() === want) return addr;
  }
  return null;
}

/** Returns an error message, or null when the username is acceptable. */
export function validateUsername(
  raw: string,
  ownAddress?: string | null
): string | null {
  const name = raw.trim();
  if (name.length < 3) return "Username must be at least 3 characters.";
  if (name.length > 20) return "Username must be at most 20 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(name))
    return "Only letters, numbers and underscores allowed.";
  const dir = getDirectory();
  const clash = Object.entries(dir).find(
    ([addr, v]) =>
      v.username.toLowerCase() === name.toLowerCase() &&
      addr.toLowerCase() !== (ownAddress ?? "").toLowerCase()
  );
  if (clash) return "That username is taken on this device — try another.";
  return null;
}
