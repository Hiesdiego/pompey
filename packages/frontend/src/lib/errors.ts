/**
 * TICKR frontend error taxonomy.
 *
 * Every failure the user can hit is mapped to an ErrorCode, and every code
 * has exactly one calm, human sentence in ERROR_COPY. Rules:
 *  - The user NEVER sees infrastructure words (backend, RPC, server, logs),
 *    URLs, RPC hosts, or raw revert data.
 *  - `detail` is optional, sanitized context (never a URL or revert blob).
 *  - CodedError is a real Error so existing `catch (e) { e.message }`
 *    consumers keep working — the message IS the human copy.
 */

import { ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

export type ErrorCode =
  | "NETWORK"
  | "RPC_UNAVAILABLE"
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "MARKET_CLOSED"
  | "INSUFFICIENT_BALANCE"
  | "USER_REJECTED"
  | "TX_FAILED"
  | "STALE_PRICES"
  | "CHALLENGE_PENDING"
  | "VOID_ALREADY_INITIATED"
  | "UNKNOWN";

export interface AppError {
  code: ErrorCode;
  detail?: string;
}

const VALID_CODES: ReadonlySet<string> = new Set([
  "NETWORK",
  "RPC_UNAVAILABLE",
  "BACKEND_UNAVAILABLE",
  "TIMEOUT",
  "NOT_FOUND",
  "MARKET_CLOSED",
  "INSUFFICIENT_BALANCE",
  "USER_REJECTED",
  "TX_FAILED",
  "STALE_PRICES",
  "CHALLENGE_PENDING",
  "VOID_ALREADY_INITIATED",
  "UNKNOWN",
]);

export const ERROR_COPY: Record<ErrorCode, string> = {
  NETWORK: "You're offline or the connection dropped — check your connection and try again.",
  RPC_UNAVAILABLE: "The network is busy right now — give it a moment and try again.",
  BACKEND_UNAVAILABLE: "We're having trouble reaching our services — please try again in a moment.",
  TIMEOUT: "That took too long — please try again.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  MARKET_CLOSED: "This market is no longer open.",
  INSUFFICIENT_BALANCE: "You don't have enough TICK for this.",
  USER_REJECTED: "You cancelled the transaction in your wallet.",
  TX_FAILED: "The transaction didn't go through — please try again.",
  STALE_PRICES: "Prices are refreshing — odds will be back in a moment.",
  CHALLENGE_PENDING: "This market's void is being challenged — finalizing opens after the challenge window.",
  VOID_ALREADY_INITIATED: "A void is already underway for this market.",
  UNKNOWN: "Something hiccuped on our side — please try again.",
};

/** An Error carrying a machine-readable code. message is always the human copy. */
export class CodedError extends Error implements AppError {
  code: ErrorCode;
  detail?: string;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? ERROR_COPY[code]);
    this.name = "CodedError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Strip URLs, hex blobs and infra words — detail must stay user-safe. */
function sanitizeDetail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/0x[0-9a-fA-F]{8,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return undefined;
  if (/backend|rpc|server|logs?|endpoint|host|url|trace|stack/i.test(s)) return undefined;
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

/** MarketFactory custom-error name → ErrorCode (mirrors lib/marketFactory.ts ABI). */
const REVERT_TO_CODE: Record<string, ErrorCode> = {
  ChallengePending: "CHALLENGE_PENDING",
  VoidAlreadyInitiated: "VOID_ALREADY_INITIATED",
  BettingClosed: "MARKET_CLOSED",
  AlreadySettled: "MARKET_CLOSED",
  NotVoidable: "TX_FAILED",
  NotResolvableYet: "TX_FAILED",
  NothingToClaim: "TX_FAILED",
  DuplicateOpenMarket: "TX_FAILED",
  InvalidParams: "TX_FAILED",
  UnknownTemplate: "TX_FAILED",
};

/** Walk a viem-style cause chain looking for a decoded custom-error name. */
function findRevertName(e: unknown, depth = 0): string | null {
  if (!isRecord(e) || depth > 6) return null;
  if (e instanceof ContractFunctionRevertedError) {
    const data = e.data as { errorName?: unknown } | undefined;
    if (data && typeof data.errorName === "string" && data.errorName) {
      return data.errorName;
    }
  }
  // Undecoded reverts sometimes surface the name in shortMessage/metaMessages.
  const shortMessage = (e as { shortMessage?: unknown }).shortMessage;
  if (typeof shortMessage === "string") {
    const m = shortMessage.match(/reverted with (?:custom error |the following reason: )?['"]?([A-Za-z_][A-Za-z0-9_]*)/);
    if (m && REVERT_TO_CODE[m[1]]) return m[1];
  }
  const cause = (e as { cause?: unknown }).cause;
  return cause === undefined ? null : findRevertName(cause, depth + 1);
}

/** Backend { ok:false, code } snake_case payload → ErrorCode. */
const BACKEND_CODE_MAP: Record<string, ErrorCode> = {
  not_found: "NOT_FOUND",
  query_failed: "UNKNOWN",
  wallet_required: "UNKNOWN",
  missing_token: "UNKNOWN",
  invalid_token: "UNKNOWN",
  user_not_found: "UNKNOWN",
  wallet_not_linked: "UNKNOWN",
  auth_not_configured: "UNKNOWN",
  invalid_metric: "UNKNOWN",
  invalid_body: "UNKNOWN",
  invalid_username: "UNKNOWN",
  username_taken: "UNKNOWN",
  locked_until_next_season: "UNKNOWN",
  invalid_team: "UNKNOWN",
  invalid_bio: "UNKNOWN",
  username_required: "UNKNOWN",
  team_required: "UNKNOWN",
  save_failed: "UNKNOWN",
};

function messageOf(e: unknown): string {
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return "";
}

/**
 * Normalize any thrown value into an AppError. Never leaks URLs, RPC hosts,
 * or raw revert data into `detail`.
 */
export function toAppError(e: unknown): AppError {
  if (e instanceof CodedError) return e;
  if (!e) return new CodedError("UNKNOWN");

  // Already a coded AppError-shaped object (e.g. rethrown across boundaries).
  if (isRecord(e) && typeof e.code === "string" && VALID_CODES.has(e.code)) {
    return new CodedError(e.code as ErrorCode, sanitizeDetail(e.detail));
  }

  // Backend { ok:false, code } payloads pass through by code.
  if (isRecord(e) && e.ok === false && typeof e.code === "string") {
    const mapped = BACKEND_CODE_MAP[e.code] ?? "UNKNOWN";
    return new CodedError(mapped);
  }

  // Abort/timeout from AbortSignal.timeout().
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new CodedError("TIMEOUT");
  }

  // Wallet rejections (viem UserRejectedRequestError or raw 4001).
  if (e instanceof UserRejectedRequestError) return new CodedError("USER_REJECTED");
  if (isRecord(e) && (e as { code?: unknown }).code === 4001) {
    return new CodedError("USER_REJECTED");
  }
  if (/user rejected|user denied/i.test(messageOf(e))) {
    return new CodedError("USER_REJECTED");
  }

  // On-chain custom errors (walk the viem cause chain).
  const revertName = findRevertName(e);
  if (revertName && REVERT_TO_CODE[revertName]) {
    return new CodedError(REVERT_TO_CODE[revertName]);
  }
  if (e instanceof ContractFunctionRevertedError) {
    return new CodedError("TX_FAILED");
  }

  const msg = messageOf(e);

  // Browser fetch failures.
  if (e instanceof TypeError && /failed to fetch|load failed|networkerror|network request failed/i.test(msg)) {
    return new CodedError("NETWORK");
  }

  // Balance problems.
  if (/insufficient (funds|balance)|exceeds balance|exceeds the balance/i.test(msg)) {
    return new CodedError("INSUFFICIENT_BALANCE");
  }

  // Timeouts phrased in prose.
  if (/timed out|timeout/i.test(msg)) return new CodedError("TIMEOUT");

  // Rate limiting / congested RPC.
  if (/rate limit|too many requests|\b429\b/i.test(msg)) {
    return new CodedError("RPC_UNAVAILABLE");
  }

  // Legacy status-bearing errors (ApiError shape: { status, message }).
  if (isRecord(e) && typeof (e as { status?: unknown }).status === "number") {
    const status = (e as { status: number }).status;
    if (status === 404) return new CodedError("NOT_FOUND");
    if (status === 0) return new CodedError("BACKEND_UNAVAILABLE");
    if (status === 408 || status === 504) return new CodedError("TIMEOUT");
    return new CodedError("UNKNOWN", sanitizeDetail(msg));
  }

  return new CodedError("UNKNOWN", sanitizeDetail(msg));
}

/** One calm human sentence for anything thrown. */
export function errorMessage(e: unknown): string {
  return ERROR_COPY[toAppError(e).code];
}
