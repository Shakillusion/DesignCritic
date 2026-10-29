import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { cached, providerFetch } from "../http";
import { AiError, type AiProvider, type ModelInfo, type ProviderRequest, type ProviderResponse } from "../types";

/**
 * Google Gemini via the Generative Language API (`models.generateContent`).
 * Free tier through a Google AI Studio key. Models are discovered from
 * `GET /v1beta/models`, so new releases appear without code changes.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

const ModelList = z.object({
  models: z.array(z.object({ name: z.string(), displayName: z.string().optional(), supportedGenerationMethods: z.array(z.string()).optional() })).default([]),
  nextPageToken: z.string().optional(),
});

const GenerateResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).default([]) }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional(), thoughtsTokenCount: z.number().optional(), cachedContentTokenCount: z.number().optional() }).optional(),
  modelVersion: z.string().optional(),
});

const headers = () => ({ "x-goog-api-key": env.geminiKey ?? "" });

/** In-memory model health: free-tier models are often overloaded at peak times. */
const SLOW_MS = 75_000;
const g = globalThis as unknown as { __dcGeminiHealth?: Map<string, number> };
const degradedUntil = (g.__dcGeminiHealth ??= new Map<string, number>());
const isDegraded = (id: string) => (degradedUntil.get(id) ?? 0) > Date.now();
function markDegraded(id: string, ms: number) {
  degradedUntil.set(id, Date.now() + ms);
}

/** Rank models: newest version first, "flash" (generous free limits) before "pro", skip lite/preview-only variants last. */
function rank(id: string): number {
  const v = Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  let s = v * 100;
  if (/flash/.test(id)) s += 30;
  if (/pro/.test(id)) s += 10;
  if (/lite/.test(id)) s -= 15;
  if (/preview|exp/.test(id)) s -= 5;
  return s;
}

const usable = (id: string) => /^gemini-/.test(id) && !/(image|tts|audio|live|embedding|vision-only|thinking-exp|computer|robotics|native|transcribe|customtools)/.test(id);

export const geminiProvider: AiProvider = {
  id: "gemini",
  label: "Google Gemini",
  free: true,
  keyEnv: "GEMINI_API_KEY",
  signupUrl: "https://aistudio.google.com/apikey",
  maxImages: 16,
  supportsPdf: true,
  isConfigured: () => Boolean(env.geminiKey),

  async listModels(): Promise<ModelInfo[]> {
    if (!env.geminiKey) return [];
    return cached("gemini:models", 60 * 60 * 1000, async () => {
      const out: ModelInfo[] = [];
      let page: string | undefined;
      for (let i = 0; i < 5; i++) {
        const raw = await providerFetch("gemini", `${BASE}/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, { method: "GET", headers: headers(), signal: AbortSignal.timeout(20000) });
        const list = ModelList.parse(raw);
        for (const m of list.models) {
          const id = m.name.replace(/^models\//, "");
          if (!usable(id) || !m.supportedGenerationMethods?.includes("generateContent")) continue;
          out.push({ id, label: m.displayName ?? id, vision: true, free: true, structured: true });
        }
        if (!list.nextPageToken) break;
        page = list.nextPageToken;
      }
      return out.sort((a, b) => rank(b.id) - rank(a.id));
    });
  },

  async resolveModel(preferred) {
    const models = await this.listModels();
    if (preferred && preferred !== "auto" && models.some((m) => m.id === preferred)) return preferred;
    const best = models[0]?.id;
    if (!best) throw new AiError("unsupported", "No Gemini model with generateContent is available for this key.", "gemini");
    return best;
  },

  /** Newest free models are often overloaded at peak times; step down through the next best ones. */
  async candidateModels(preferred) {
    if (preferred && preferred !== "auto") return [await this.resolveModel(preferred)];
    const ids = (await this.listModels()).map((m) => m.id);
    const nonLite = ids.filter((id) => !/lite/.test(id));
    const picks = [...new Set([...nonLite.slice(0, 4), ...ids.filter((id) => /lite/.test(id)).slice(0, 1)])];
    // Healthy models first; recently overloaded/slow/no-quota ones go last.
    return [...picks.filter((id) => !isDegraded(id)), ...picks.filter(isDegraded)];
  },

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const parts = req.content.map((p) =>
      p.type === "text" ? { text: p.text } : p.type === "image" ? { inline_data: { mime_type: p.mediaType, data: p.base64 } } : { inline_data: { mime_type: "application/pdf", data: p.base64 } },
    );
    // Less thinking = much faster on the free tier; only the heaviest steps (critique, layout) keep "medium".
    const thinkingLevel = req.effort === "high" ? "medium" : "low";
    const body = (o: { schema: boolean; thinking: boolean }) => ({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        ...(o.schema ? { responseJsonSchema: req.jsonSchema } : {}),
        ...(o.thinking && /^gemini-[3-9]/.test(req.model) ? { thinkingConfig: { thinkingLevel } } : {}),
        maxOutputTokens: req.maxTokens,
      },
    });
    const url = `${BASE}/models/${encodeURIComponent(req.model)}:generateContent`;
    const opts = { schema: true, thinking: true };
    let raw: unknown;
    const started = Date.now();
    for (let i = 0; ; i++) {
      try {
        // One quick retry only: an overloaded model is better skipped than waited on.
        raw = await providerFetch("gemini", url, { headers: headers(), body: body(opts), signal: req.signal }, 1);
        if (Date.now() - started > SLOW_MS) markDegraded(req.model, 10 * 60_000);
        break;
      } catch (err) {
        if (err instanceof AiError && (err.code === "overloaded" || err.code === "timeout")) markDegraded(req.model, 15 * 60_000);
        if (err instanceof AiError && err.code === "rate-limit") markDegraded(req.model, /quota/i.test(err.message) ? 6 * 3600_000 : 5 * 60_000);
        // Drop optional features the model rejects: the thinking setting, or a schema too complex for constrained decoding.
        if (!(err instanceof AiError && err.code === "bad-request") || i >= 2) throw err;
        if (opts.thinking && /thinking/i.test(err.message)) opts.thinking = false;
        else if (opts.schema && /schema/i.test(err.message)) opts.schema = false;
        else throw err;
      }
    }
    const r = GenerateResponse.parse(raw);
    if (r.promptFeedback?.blockReason) throw new AiError("refusal", `Gemini blocked the request (${r.promptFeedback.blockReason}).`, "gemini");
    const c = r.candidates[0];
    if (!c) throw new AiError("invalid-output", "Gemini returned no answer.", "gemini");
    if (c.finishReason === "MAX_TOKENS") throw new AiError("truncated", "Gemini's answer was cut off before it finished.", "gemini");
    if (c.finishReason && /SAFETY|BLOCKLIST|PROHIBITED|RECITATION|SPII/.test(c.finishReason)) throw new AiError("refusal", `Gemini declined to answer (${c.finishReason}).`, "gemini");
    const text = (c.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    const u = r.usageMetadata ?? {};
    return {
      text,
      model: r.modelVersion ?? req.model,
      usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: u.cachedContentTokenCount ?? 0 },
    };
  },

  pricing: () => ({ input: 0, output: 0 }),
};
