import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "@/lib/env";
import { AiError, type AiProvider, type ModelInfo, type ProviderRequest, type ProviderResponse } from "../types";

/** Optional, paid. Only used when the user picks Claude in Settings and adds a key. */

export const CLAUDE_MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", input: 4, output: 20, fallback: true },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", input: 2, output: 10, fallback: true },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", input: 0.1, output: 0.5, fallback: false },
} as const;
type ClaudeModel = keyof typeof CLAUDE_MODELS;
const isClaudeModel = (m: string): m is ClaudeModel => m in CLAUDE_MODELS;

let client: Anthropic | null = null;
let clientKey: string | null = null;
function getClient(): Anthropic {
  const key = env.anthropicKey!;
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, timeout: 8 * 60 * 1000, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

function mapError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new AiError("auth", "The Anthropic API key was rejected.", "anthropic");
  if (err instanceof Anthropic.RateLimitError) return new AiError("rate-limit", "Claude's rate limit was reached.", "anthropic");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AiError("timeout", "Claude took too long to respond.", "anthropic");
  if (err instanceof Anthropic.APIConnectionError) return new AiError("network", "Couldn't reach the Anthropic API.", "anthropic");
  if (err instanceof Anthropic.BadRequestError) return new AiError("bad-request", `Claude rejected the request: ${err.message}`, "anthropic");
  if (err instanceof Anthropic.InternalServerError) return new AiError("overloaded", "Claude is temporarily unavailable.", "anthropic");
  if (err instanceof Anthropic.APIError) return new AiError("unknown", `Claude API error (${err.status ?? "?"}): ${err.message}`, "anthropic");
  return new AiError("unknown", err instanceof Error ? err.message : String(err), "anthropic");
}

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  label: "Claude (paid, optional)",
  free: false,
  keyEnv: "ANTHROPIC_API_KEY",
  signupUrl: "https://platform.claude.com/settings/keys",
  maxImages: 20,
  supportsPdf: true,
  isConfigured: () => Boolean(env.anthropicKey),

  async listModels(): Promise<ModelInfo[]> {
    return Object.entries(CLAUDE_MODELS).map(([id, m]) => ({ id, label: m.label, vision: true, free: false, structured: true }));
  },

  async resolveModel(preferred) {
    return preferred && isClaudeModel(preferred) ? preferred : "claude-opus-5-5";
  },

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const model = isClaudeModel(req.model) ? req.model : "claude-opus-5-5";
    const content: Block[] = req.content.map((p): Block =>
      p.type === "text"
        ? { type: "text", text: p.text }
        : p.type === "image"
          ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } }
          : { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.base64 }, title: p.title },
    );
    try {
      const stream = getClient().beta.messages.stream(
        {
          model,
          max_tokens: Math.max(req.maxTokens, 32000),
          system: req.system,
          messages: [{ role: "user", content }],
          output_config: { format: betaZodOutputFormat(req.zod), effort: req.effort },
          ...(CLAUDE_MODELS[model].fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal },
      );
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new AiError("refusal", "Claude declined to process this request.", "anthropic");
      if (message.stop_reason === "max_tokens") throw new AiError("truncated", "Claude's response was cut off.", "anthropic");
      return {
        text: message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
        model,
        usage: { input: message.usage.input_tokens, output: message.usage.output_tokens, cacheRead: message.usage.cache_read_input_tokens ?? 0 },
      };
    } catch (err) {
      throw mapError(err);
    }
  },

  pricing(model) {
    const m = isClaudeModel(model) ? CLAUDE_MODELS[model] : CLAUDE_MODELS["claude-opus-5-5"];
    return { input: m.input, output: m.output };
  },
};
