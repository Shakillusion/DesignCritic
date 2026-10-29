import "server-only";
import { z } from "zod";
import { providerFetch } from "../http";
import { AiError, type ProviderId, type ProviderRequest, type ProviderResponse } from "../types";

/** Shared chat-completions call for OpenAI-compatible providers (Groq, OpenRouter). */

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).optional(),
      }),
    )
    .default([]),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullable().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

export type ResponseFormatMode = "json_schema" | "json_object" | "none";

export async function chatCompletion(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  req: ProviderRequest,
  mode: ResponseFormatMode,
  tokenParam: "max_tokens" | "max_completion_tokens",
): Promise<ProviderResponse> {
  if (req.content.some((p) => p.type === "pdf")) {
    throw new AiError("unsupported", "This provider can't read PDF files. Use Gemini, upload the guideline pages as images, or paste the text.", provider);
  }
  const content = req.content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.type === "image" ? p.mediaType : "image/png"};base64,${p.base64}` } },
  );
  // Without constrained decoding the model needs to see the schema itself.
  const system = mode === "json_schema" ? req.system : `${req.system}\n\nRespond with a single JSON object only — no prose, no code fences — that conforms to this JSON Schema:\n${JSON.stringify(req.jsonSchema)}`;
  const response_format =
    mode === "json_schema" ? { type: "json_schema", json_schema: { name: req.schemaName, strict: false, schema: req.jsonSchema } } : mode === "json_object" ? { type: "json_object" } : undefined;

  const body = {
    model: req.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    [tokenParam]: req.maxTokens,
    ...(response_format ? { response_format } : {}),
  };
  const raw = await providerFetch(provider, url, { headers, body, signal: req.signal });
  const r = ChatResponse.parse(raw);
  if (r.error?.message) throw new AiError("bad-request", r.error.message, provider);
  const c = r.choices[0];
  if (!c?.message) throw new AiError("invalid-output", "The model returned no answer.", provider);
  if (c.message.refusal) throw new AiError("refusal", `The model declined: ${c.message.refusal}`, provider);
  if (c.finish_reason === "length") throw new AiError("truncated", "The model's answer was cut off before it finished.", provider);
  if (c.finish_reason === "content_filter") throw new AiError("refusal", "The provider's content filter blocked the answer.", provider);
  return {
    text: c.message.content ?? "",
    model: r.model ?? req.model,
    usage: { input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0, cacheRead: 0 },
  };
}

/** Retry once with a weaker response format when a model rejects the stronger one. */
export async function withFormatFallback(modes: ResponseFormatMode[], call: (m: ResponseFormatMode) => Promise<ProviderResponse>): Promise<ProviderResponse> {
  let last: unknown;
  for (const m of modes) {
    try {
      return await call(m);
    } catch (err) {
      last = err;
      if (!(err instanceof AiError && err.code === "bad-request" && /response_format|json_schema|json mode|structured|schema/i.test(err.message))) throw err;
    }
  }
  throw last;
}
