import type { z } from "zod";

/**
 * Provider-neutral AI types. Agents build `ContentPart[]`; each provider
 * module translates them into its own wire format.
 */

export type ProviderId = "gemini" | "groq" | "openrouter" | "anthropic";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }
  | { type: "pdf"; base64: string; title?: string };

export type AiErrorCode =
  | "not-configured"
  | "auth"
  | "rate-limit"
  | "overloaded"
  | "timeout"
  | "refusal"
  | "truncated"
  | "invalid-output"
  | "unsupported"
  | "bad-request"
  | "network"
  | "unknown";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public provider?: ProviderId,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Errors worth retrying on another provider (the request itself was fine). */
export const FALLBACK_CODES: AiErrorCode[] = ["rate-limit", "overloaded", "timeout", "network", "not-configured", "unsupported", "auth"];

export interface ProviderRequest {
  model: string;
  system: string;
  content: ContentPart[];
  /** JSON Schema derived from the Zod schema. */
  jsonSchema: Record<string, unknown>;
  /** The Zod schema itself, for providers with a native Zod helper (Claude). */
  zod: z.ZodType;
  schemaName: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  signal: AbortSignal;
}

export interface ProviderResponse {
  text: string;
  model: string;
  usage: { input: number; output: number; cacheRead: number };
}

export interface ModelInfo {
  id: string;
  label: string;
  vision: boolean;
  free: boolean;
  structured: boolean;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  free: boolean;
  keyEnv: string;
  signupUrl: string;
  /** Max images in one request (Groq allows few). */
  maxImages: number;
  supportsPdf: boolean;
  isConfigured(): boolean;
  /** Resolve "auto" (or a stale id) to a concrete model. */
  resolveModel(preferred: string | null): Promise<string>;
  /** With "auto": models to try, best first, when one is overloaded. Defaults to [resolveModel()]. */
  candidateModels?(preferred: string | null): Promise<string[]>;
  listModels(): Promise<ModelInfo[]>;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
  /** USD per million tokens, for the usage log. Free tiers are 0. */
  pricing(model: string): { input: number; output: number };
}
