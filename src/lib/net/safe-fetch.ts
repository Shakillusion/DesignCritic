import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import "server-only";
import { userAgent } from "@/lib/env";

export type SafeFetchErrorCode = "blocked-url" | "too-large" | "timeout" | "bad-status" | "bad-type" | "network";

export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /** Allowed content-type prefixes, e.g. ["image/", "application/json"]. */
  accept?: string[];
  headers?: Record<string, string>;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 4;

// ---------------------------------------------------------------- address checks

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPrivateV4(ip: string): boolean {
  const o = parseV4(ip);
  if (!o) return true; // unparsable → treat as unsafe
  const [a, b, c] = o;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
  );
}

/** Expand an IPv6 address into 8 16-bit groups (handles `::` and embedded v4). */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  // Embedded dotted v4 tail (e.g. ::ffff:10.0.0.1)
  const v4Match = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4Match) {
    const o = parseV4(v4Match[1]);
    if (!o) return null;
    addr = addr.slice(0, -v4Match[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(v4From(g[6], g[7]));
  // 64:ff9b::/96 NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4From(g[6], g[7]));
  return false;
}

/** True when `ip` is loopback/private/link-local/reserved (or not a valid IP at all). */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip.replace(/^\[|\]$/g, ""));
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

/** Validate a URL for outbound fetching; throws `SafeFetchError('blocked-url')`. */
export function assertPublicUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SafeFetchError("blocked-url", "Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("blocked-url", `Protocol ${u.protocol} not allowed`);
  if (u.username || u.password) throw new SafeFetchError("blocked-url", "Credentials in URL not allowed");
  if (u.port) {
    const port = Number(u.port);
    if (!(port === 80 || port === 443 || port > 1024)) throw new SafeFetchError("blocked-url", `Port ${port} not allowed`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new SafeFetchError("blocked-url", "Missing host");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SafeFetchError("blocked-url", `Host ${host} not allowed`);
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new SafeFetchError("blocked-url", `Address ${host} not allowed`);
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * `lookup` replacement for http(s).request: resolves all addresses and refuses if any is private.
 * Validating here (not before the request) guards against DNS rebinding.
 */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCb): void {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, "");
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (!addresses.length || bad) {
      const e: NodeJS.ErrnoException = new SafeFetchError("blocked-url", `Host ${hostname} resolves to a non-public address`);
      return callback(e, "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

// ---------------------------------------------------------------- fetching

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Readable;
  req: http.ClientRequest;
}

function requestOnce(u: URL, headers: Record<string, string>, signal: AbortSignal): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", headers, lookup: safeLookup as unknown as net.LookupFunction, signal }, (res) =>
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res, req }),
    );
    req.on("error", reject);
    req.end();
  });
}

function decoded(body: Readable, encoding: string | undefined): Readable {
  const enc = (encoding ?? "").trim().toLowerCase();
  const inflater =
    enc === "gzip" || enc === "x-gzip"
      ? zlib.createGunzip()
      : enc === "br"
        ? zlib.createBrotliDecompress()
        : enc === "deflate"
          ? zlib.createInflate()
          : null;
  if (!inflater) return body;
  body.on("error", (e) => inflater.destroy(e)); // .pipe() does not forward source errors
  return body.pipe(inflater);
}

function toSafeError(err: unknown, signal: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  if (signal.aborted) return new SafeFetchError("timeout", "Request timed out");
  // Errors from safeLookup are re-wrapped by net; recover the original code.
  const msg = err instanceof Error ? err.message : String(err);
  if (/non-public address/.test(msg)) return new SafeFetchError("blocked-url", msg);
  return new SafeFetchError("network", msg);
}

/** SSRF-safe GET with redirect re-validation, timeout, size cap and content-type allow-list. */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "User-Agent": userAgent(),
    "Accept-Encoding": "gzip, br, deflate",
    ...(opts.accept?.length ? { Accept: opts.accept.map((a) => (a.endsWith("/") ? `${a}*` : a)).join(", ") } : {}),
    ...opts.headers,
  };

  try {
    let current = assertPublicUrl(url);
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(current, headers, controller.signal);

      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        res.body.resume();
        if (hop >= maxRedirects) throw new SafeFetchError("network", `Too many redirects (>${maxRedirects})`);
        const next = assertPublicUrl(new URL(res.headers.location, current).toString());
        // Never leak auth headers to a different origin.
        if (next.origin !== current.origin) delete headers.Authorization;
        current = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.body.resume();
        throw new SafeFetchError("bad-status", `HTTP ${res.status} from ${current.host}`, res.status);
      }

      const contentType = (res.headers["content-type"] ?? "").toLowerCase();
      if (opts.accept?.length && !opts.accept.some((p) => contentType.startsWith(p.toLowerCase()))) {
        res.body.resume();
        throw new SafeFetchError("bad-type", `Unexpected content-type "${contentType || "none"}"`);
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.req.destroy();
        throw new SafeFetchError("too-large", `Response exceeds ${maxBytes} bytes`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      const stream = decoded(res.body, res.headers["content-encoding"]);
      for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buf.length;
        if (total > maxBytes) {
          res.req.destroy();
          throw new SafeFetchError("too-large", `Response exceeds ${maxBytes} bytes`);
        }
        chunks.push(buf);
      }
      return { buffer: Buffer.concat(chunks), contentType, finalUrl: current.toString(), status: res.status };
    }
  } catch (err) {
    throw toSafeError(err, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** `safeFetch` + JSON.parse. Defaults `accept` to JSON and maxBytes to 5 MB. */
export async function safeFetchJson<T = unknown>(url: string, opts: SafeFetchOptions = {}): Promise<T> {
  const res = await safeFetch(url, { maxBytes: 5 * 1024 * 1024, accept: ["application/json"], ...opts });
  try {
    return JSON.parse(res.buffer.toString("utf8")) as T;
  } catch {
    throw new SafeFetchError("bad-type", `Invalid JSON from ${new URL(res.finalUrl).host}`);
  }
}
