import { logger } from "./logger.js";
import { meter } from "./net.js";

type Usage = { bytes: number; calls: number; failures: number };

const hourly = new Map<string, Usage>();
let installed = false;

function requestBodyBytes(body: RequestInit["body"]): number {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof Blob) return body.size;
  return 0;
}

function groupFor(url: URL, body: RequestInit["body"]): string {
  if (typeof body === "string" && body.includes('"jsonrpc"')) {
    try {
      const parsed: unknown = JSON.parse(body);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const methods = [...new Set(entries.map((entry) =>
        typeof entry === "object" && entry !== null && "method" in entry
          ? String(entry.method)
          : "unknown"
      ))];
      return `rpc:${methods.length === 1 ? methods[0] : "mixed"}`;
    } catch {
      return "rpc:unknown";
    }
  }
  if (url.hostname.includes("supabase")) {
    const parts = url.pathname.split("/").filter(Boolean);
    return `supabase:${parts.slice(0, 3).join(":") || "other"}`;
  }
  if (url.hostname.includes("binance")) return "binance";
  if (url.hostname.includes("coingecko")) return "coingecko";
  return `other:${url.hostname}`;
}

function record(group: string, bytes: number, failed: boolean): void {
  const current = hourly.get(group) ?? { bytes: 0, calls: 0, failures: 0 };
  current.bytes += bytes;
  current.calls++;
  if (failed) current.failures++;
  hourly.set(group, current);
  meter.count(`outbound_bytes:${group}`, bytes);
  meter.count(`outbound_calls:${group}`);
  if (failed) meter.count(`outbound_failures:${group}`);
}

export function installOutboundMeter(): void {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const body = init?.body ?? null;
    const headers = new Headers(init?.headers ?? request?.headers);
    let headerBytes = 0;
    headers.forEach((value, name) => {
      headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    });
    const method = init?.method ?? request?.method ?? "GET";
    const bytes = Buffer.byteLength(method) + Buffer.byteLength(url.pathname + url.search) +
      Buffer.byteLength(url.host) + headerBytes + requestBodyBytes(body) + 18;
    const group = groupFor(url, body);
    try {
      const response = await originalFetch(input, init);
      record(group, bytes, !response.ok);
      return response;
    } catch (error) {
      record(group, bytes, true);
      throw error;
    }
  };
  const timer = setInterval(() => {
    const groups = [...hourly.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([group, usage]) => ({ group, ...usage }));
    logger.info("[net] outbound request bytes by source", { groups });
    hourly.clear();
  }, 60 * 60_000);
  timer.unref?.();
}
