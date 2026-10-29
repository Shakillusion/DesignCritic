import sharp from "sharp";
import { z } from "zod";
import { AiError, isProviderId, PROVIDERS, toProviderSchema } from "@/lib/ai/client";
import { FALLBACK_CODES } from "@/lib/ai/types";
import { getPreferences } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";

const Body = z.object({ provider: z.string() });
const Answer = z.object({ dominantColor: z.string(), shape: z.string() });

/**
 * Sends one tiny real request (a 64×64 red square + a two-field schema) to the
 * chosen provider, so the user can confirm their free key, model and vision
 * input actually work. Uses a few hundred tokens.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { provider: id } = await parseBody(req, Body);
  if (!isProviderId(id)) return json({ ok: false, error: "Unknown provider." }, { status: 400 });
  const p = PROVIDERS[id];
  if (!p.isConfigured()) return json({ ok: false, error: `${p.keyEnv} isn't set in .env.local.` });
  const started = Date.now();
  const preferred = getPreferences(user.id).aiModels[id] ?? "auto";
  const models = p.candidateModels ? await p.candidateModels(preferred).catch(() => [] as string[]) : [];
  if (!models.length) models.push(await p.resolveModel(preferred).catch(() => "auto"));
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#E0201B" } }).png().toBuffer();
  const skipped: string[] = [];
  for (const model of models) {
    const result = await tryModel(model);
    if (result.ok || !result.retryable) return json({ ...result, skipped, ms: Date.now() - started });
    skipped.push(`${model}: ${result.error}`);
  }
  return json({ ok: false, error: `Every candidate model failed. ${skipped.join(" ")}`, ms: Date.now() - started });

  async function tryModel(model: string) {
    try {
      const res = await p.generate({
        model,
        system: "You answer with JSON only.",
        content: [
          { type: "image", base64: png.toString("base64"), mediaType: "image/png" },
          { type: "text", text: "What is the dominant colour of this image (one word) and what shape is it (one word)?" },
        ],
        jsonSchema: toProviderSchema(Answer),
        zod: Answer,
        schemaName: "connection_test",
        maxTokens: 2000,
        effort: "low",
        signal: AbortSignal.timeout(60_000),
      });
      return { ok: true as const, model: res.model, reply: res.text.slice(0, 200), retryable: false };
    } catch (err) {
      const retryable = err instanceof AiError && FALLBACK_CODES.includes(err.code);
      return { ok: false as const, error: err instanceof AiError ? err.message : String(err), retryable };
    }
  }
});
