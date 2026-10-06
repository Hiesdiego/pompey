import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { LEGAL_COOKIE, LEGAL_VERSION } from "./legal";

export const LEGAL_MAX_AGE = 365 * 24 * 60 * 60;

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createLegalCookie(userId: string, secret: string): string {
  const encoded = Buffer.from(JSON.stringify({ userId, version: LEGAL_VERSION, at: Date.now() })).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function validLegalCookie(value: string | undefined, userId: string, secret: string): boolean {
  if (!value) return false;
  const [encoded, received] = value.split(".");
  if (!encoded || !received || !/^[a-f0-9]{64}$/.test(received)) return false;
  const expected = signature(encoded, secret);
  if (!timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return false;
  try {
    const record = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return record.userId === userId && record.version === LEGAL_VERSION &&
      Number.isFinite(record.at) && Date.now() - record.at < LEGAL_MAX_AGE * 1000 && record.at <= Date.now();
  } catch { return false; }
}

export function acceptedFromRequest(req: Request, userId: string, secret: string): boolean {
  const raw = req.headers.get("cookie") ?? "";
  const cookie = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${LEGAL_COOKIE}=`));
  try { return validLegalCookie(cookie ? decodeURIComponent(cookie.slice(LEGAL_COOKIE.length + 1)) : undefined, userId, secret); }
  catch { return false; }
}
