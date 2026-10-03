/**
 * Server-only Privy auth helper for the social-layer Route Handlers.
 * Verifies the caller's Privy access token and confirms the wallet address
 * they claim is actually linked to their Privy user. Never import from
 * client components.
 */

import "server-only";
import { PrivyClient } from "@privy-io/server-auth";

let privy: PrivyClient | null = null;
let warned = false;

function getPrivy(): PrivyClient | null {
  // PRIVY_APP_ID may be set explicitly; otherwise reuse the public app id.
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    if (!warned) {
      warned = true;
      console.warn(
        "[social] PRIVY_APP_ID / PRIVY_APP_SECRET not set — authed social endpoints disabled."
      );
    }
    return null;
  }
  if (!privy) privy = new PrivyClient(appId, appSecret);
  return privy;
}

export type LinkedWalletCheck =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

/**
 * Verify `Authorization: Bearer <Privy access token>` and check that
 * `walletAddress` is one of the token owner's linked wallets (case-insensitive).
 */
export async function requireLinkedWallet(
  req: Request,
  walletAddress: string
): Promise<LinkedWalletCheck> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "missing_token" };

  const client = getPrivy();
  if (!client) return { ok: false, status: 503, error: "auth_not_configured" };

  let userId: string;
  try {
    const claims = await client.verifyAuthToken(token);
    userId = claims.userId;
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  let user;
  try {
    user = await client.getUser(userId);
  } catch {
    return { ok: false, status: 401, error: "user_not_found" };
  }

  const wanted = walletAddress.toLowerCase();
  const linked = (user.linkedAccounts ?? [])
    .filter((a) => a.type === "wallet")
    .map((a) => ((a as { address?: string }).address ?? "").toLowerCase())
    .filter(Boolean);

  if (!linked.includes(wanted)) {
    return { ok: false, status: 403, error: "wallet_not_linked" };
  }
  return { ok: true, userId };
}
