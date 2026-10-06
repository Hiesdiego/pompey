import { cookies } from "next/headers";
import { LEGAL_COOKIE, LEGAL_VERSION } from "@/lib/legal";
import { createLegalCookie, validLegalCookie, LEGAL_MAX_AGE } from "@/lib/legalAcceptance";
import { requirePrivyUser } from "@/lib/privyServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authenticate(req: Request) {
  const auth = await requirePrivyUser(req);
  if (!auth.ok) return { response: Response.json({ error: auth.error }, { status: auth.status }) };
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) return { response: Response.json({ error: "auth_not_configured" }, { status: 503 }) };
  return { userId: auth.userId, secret };
}

export async function GET(req: Request) {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const value = (await cookies()).get(LEGAL_COOKIE)?.value;
  return Response.json({ accepted: validLegalCookie(value, auth.userId, auth.secret), version: LEGAL_VERSION },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  let body: { terms?: boolean; privacy?: boolean; adult?: boolean; eligibleLocation?: boolean; version?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  if (body.terms !== true || body.privacy !== true || body.adult !== true || body.eligibleLocation !== true || body.version !== LEGAL_VERSION) {
    return Response.json({ error: "acceptance_required" }, { status: 400 });
  }
  (await cookies()).set(LEGAL_COOKIE, createLegalCookie(auth.userId, auth.secret), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: LEGAL_MAX_AGE,
  });
  return Response.json({ accepted: true, version: LEGAL_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
