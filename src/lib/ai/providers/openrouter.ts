import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { cached, providerFetch } from "../http";
import { AiError, type AiProvider, type ModelInfo } from "../types";
import { chatCompletion, withFormatFallback, type ResponseFormatMode } from "./openai-compatible";

/**
 * OpenRouter: one key, many models. Only free (zero-price) models that accept
 * images are offered; the list is read live from /api/v1/models.
 * Free-model limits (OpenRouter docs): 20 requests/min, 50/day (1,000/day after buying ≥10 credits).
 */

const BASE = "https://openrouter.ai/api/v1";

const ModelList = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        context_length: z.number().nullable().optional(),
        pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).partial().optional(),
        architecture: z.object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() }).partial().optional(),
        supported_parameters: z.array(z.string()).nullable().optional(),
      }),
    )
    .default([]),
});

const headers = () => ({
  Authorization: `Bearer ${env.openrouterKey ?? ""}`,
  "HTTP-Referer": "http://localhost:3000",
  "X-OpenRouter-Title": "DesignCritic AI",
});

type Meta = ModelInfo & { formats: ResponseFormatMode[] };

async function freeVisionModels(): Promise<Meta[]> {
  return cached("openrouter:models", 60 * 60 * 1000, async () => {
    const raw = await providerFetch("openrouter", `${BASE}/models`, { method: "GET", headers: {}, signal: AbortSignal.timeout(20000) });
    return ModelList.parse(raw)
      .data.filter((m) => {
        const free = Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0;
        const vision = m.architecture?.input_modalities?.includes("image");
        const textOut = (m.architecture?.output_modalities ?? ["text"]).every((o) => o === "text");
        return free && vision && textOut && !/safety|guard|moderation|lyria|audio|music/i.test(m.id);
      })
      .map((m): Meta => {
        const params = m.supported_parameters ?? [];
        const formats: ResponseFormatMode[] = params.includes("structured_outputs") ? ["json_schema", "json_object", "none"] : params.includes("response_format") ? ["json_object", "none"] : ["none"];
        return { id: m.id, label: m.name ?? m.id, vision: true, free: true, structured: formats[0] === "json_schema", formats };
      })
      // Prefer schema-constrained models; the generic router goes last.
      .sort((a, b) => Number(a.id === "openrouter/free") - Number(b.id === "openrouter/free") || Number(b.structured) - Number(a.structured));
  });
}

export const openrouterProvider: AiProvider = {
  id: "openrouter",
  label: "OpenRouter (free models)",
  free: true,
  keyEnv: "OPENROUTER_API_KEY",
  signupUrl: "https://openrouter.ai/settings/keys",
  maxImages: 4,
  supportsPdf: false,
  isConfigured: () => Boolean(env.openrouterKey),

  listModels: () => freeVisionModels(),

  async resolveModel(preferred) {
    const models = await freeVisionModels();
    if (preferred && preferred !== "auto" && models.some((m) => m.id === preferred)) return preferred;
    if (!models[0]) throw new AiError("unsupported", "OpenRouter currently lists no free models that accept images.", "openrouter");
    return models[0].id;
  },

  async generate(req) {
    const meta = (await freeVisionModels()).find((m) => m.id === req.model);
    // Never send traffic to a paid model by accident.
    if (!meta) throw new AiError("unsupported", `“${req.model}” isn't a free vision model on OpenRouter.`, "openrouter");
    return withFormatFallback(meta.formats, (m) => chatCompletion("openrouter", `${BASE}/chat/completions`, headers(), req, m, "max_tokens"));
  },

  pricing: () => ({ input: 0, output: 0 }),
};
