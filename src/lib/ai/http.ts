import "server-only";
import { AiError, type ProviderId } from "./types";

/**
 * JSON POST/GET to a provider's fixed API host. Retries 429/5xx briefly
 * (honouring Retry-After up to 20 s), then surfaces a typed AiError so the
 * client can fall back to another provider.
 */
export async function providerFetch<T>(
  provider: ProviderId,
  url: string,
  init: { method?: "GET" | "POST"; headers: Record<string, string>; body?: unknown; signal: AbortSignal },
  retries = 2,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? "POST",
        headers: { "Content-Type": "application/json", ...init.headers },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
    } catch (err) {
      if (init.signal.aborted) throw new AiError("timeout", `${label(provider)} took too long to respond.`, provider);
      throw new AiError("network", `Couldn't reach ${label(provider)}: ${err instanceof Error ? err.message : String(err)}`, provider);
    }
    if (res.ok) return (await res.json()) as T;

    const text = await res.text().catch(() => "");
    const detail = extractMessage(text);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const after = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20000) : 1500 * (attempt + 1) ** 2;
      await sleep(wait, init.signal);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new AiError("auth", `${label(provider)} rejected the API key${detail ? `: ${detail}` : ""}.`, provider);
    if (res.status === 429) throw new AiError("rate-limit", `${label(provider)}'s free-tier limit was reached${detail ? ` (${detail})` : ""}.`, provider);
    if (res.status >= 500) throw new AiError("overloaded", `${label(provider)} is temporarily unavailable (${res.status}).`, provider);
    if (res.status === 404) throw new AiError("unsupported", `${label(provider)} doesn't offer that model${detail ? `: ${detail}` : ""}.`, provider);
    throw new AiError("bad-request", `${label(provider)} rejected the request (${res.status})${detail ? `: ${detail}` : ""}.`, provider);
  }
}

function extractMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
    return m ? m.slice(0, 300) : "";
  } catch {
    return body.slice(0, 200);
  }
}

const label = (p: ProviderId) => ({ gemini: "Google Gemini", groq: "Groq", openrouter: "OpenRouter", anthropic: "Claude" })[p];

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new AiError("timeout", "Request timed out."))), { once: true });
  });
}

/** Small in-memory cache for model lists (they change rarely). */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
