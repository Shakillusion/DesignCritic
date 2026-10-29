import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { cached, providerFetch } from "../http";
import { AiError, type AiProvider, type ModelInfo } from "../types";
import { chatCompletion, withFormatFallback } from "./openai-compatible";

/**
 * Groq (OpenAI-compatible, very fast, free tier). Groq's model list doesn't
 * flag vision support, so known vision models (from Groq's vision docs) are
 * preferred and any other model can still be chosen for text-only work.
 */

const BASE = "https://api.groq.com/openai/v1";
/** From https://console.groq.com/docs/vision — checked 2026-10-29. Extend as Groq adds models. */
const KNOWN_VISION = ["qwen/qwen3.8-27b", "meta-models/muse-spark-open"];
const KNOWN_STRUCTURED = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open"]);

const ModelList = z.object({ data: z.array(z.object({ id: z.string(), active: z.boolean().optional() })).default([]) });
const headers = () => ({ Authorization: `Bearer ${env.groqKey ?? ""}` });

export const groqProvider: AiProvider = {
  id: "groq",
  label: "Groq",
  free: true,
  keyEnv: "GROQ_API_KEY",
  signupUrl: "https://console.groq.com/keys",
  maxImages: 3,
  supportsPdf: false,
  isConfigured: () => Boolean(env.groqKey),

  async listModels(): Promise<ModelInfo[]> {
    if (!env.groqKey) return [];
    return cached("groq:models", 60 * 60 * 1000, async () => {
      const raw = await providerFetch("groq", `${BASE}/models`, { method: "GET", headers: headers(), signal: AbortSignal.timeout(20000) });
      return ModelList.parse(raw)
        .data.filter((m) => m.active !== false && !/whisper|tts|guard|safeguard|playai|orpheus|distil/i.test(m.id))
        .map((m) => ({ id: m.id, label: m.id, vision: KNOWN_VISION.includes(m.id), free: true, structured: KNOWN_STRUCTURED.has(m.id) }))
        .sort((a, b) => Number(b.vision) - Number(a.vision) || KNOWN_VISION.indexOf(a.id) - KNOWN_VISION.indexOf(b.id));
    });
  },

  async resolveModel(preferred) {
    const models = await this.listModels();
    if (preferred && preferred !== "auto" && models.some((m) => m.id === preferred)) return preferred;
    const vision = models.find((m) => m.vision);
    if (!vision) throw new AiError("unsupported", "None of Groq's known vision models are available to this key. Pick a model in Settings.", "groq");
    return vision.id;
  },

  generate(req) {
    const modes = KNOWN_STRUCTURED.has(req.model) ? (["json_schema", "json_object", "none"] as const) : (["json_object", "none"] as const);
    return withFormatFallback([...modes], (m) => chatCompletion("groq", `${BASE}/chat/completions`, headers(), req, m, "max_completion_tokens"));
  },

  pricing: () => ({ input: 0, output: 0 }),
};
