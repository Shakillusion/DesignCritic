import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractJson, structuredCall, toProviderSchema } from "@/lib/ai/client";
import { getPreferences, setPreferences, usageSummary } from "@/lib/database/repo";
import { CritiqueResult } from "@/agents/design-critic/schema";
import { DesignDocument } from "@/lib/design-engine/schema";
import { useTestDb } from "./fixtures";

const U = "local-user";
const Schema = z.object({ verdict: z.string(), score: z.number() });
const call = () => structuredCall({ operation: "test.op", userId: U, system: "s", content: [{ type: "text", text: "hi" }], schema: Schema });

/** Route fetch calls by URL to canned responses. */
type Handler = (url: string, body: Record<string, unknown> | null) => { status?: number; json: unknown; headers?: Record<string, string> };
let handler: Handler;
const calls: { url: string; body: Record<string, unknown> | null }[] = [];

const geminiModels = { models: [{ name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash-image", supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] }] };
const geminiAnswer = (text: string, finishReason = "STOP") => ({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text }] }, finishReason }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 120 }, modelVersion: "gemini-3.8-flash" });
const groqModels = { data: [{ id: "qwen/qwen3.8-27b", active: true }, { id: "whisper-large-v9", active: true }] };
const chatAnswer = (text: string) => ({ model: "qwen/qwen3.8-27b", choices: [{ finish_reason: "stop", message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 20 } });

beforeEach(async () => {
  await useTestDb();
  calls.length = 0;
  process.env.GEMINI_API_KEY = "g-test";
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("structuredCall (free providers)", () => {
  it("uses Gemini by default, resolves the best model, sends the JSON schema and records $0 usage", async () => {
    handler = (url) => (url.includes("/models?") ? { json: geminiModels } : { json: geminiAnswer('{"verdict":"solid","score":81}') });
    let meta: unknown;
    const out = await structuredCall({ operation: "test.op", userId: U, system: "sys", content: [{ type: "image", base64: "AAAA", mediaType: "image/png" }, { type: "text", text: "go" }], schema: Schema, onMeta: (m) => (meta = m) });
    expect(out).toEqual({ verdict: "solid", score: 81 });
    expect(meta).toEqual({ provider: "gemini", model: "gemini-3.8-flash" });
    const gen = calls.find((c) => c.url.includes(":generateContent"))!;
    expect(gen.url).toContain("/models/gemini-3.8-flash:generateContent");
    const cfg = gen.body!.generationConfig as Record<string, unknown>;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseJsonSchema).toMatchObject({ type: "object", required: ["verdict", "score"] });
    const parts = (gen.body!.contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts[0]).toEqual({ inline_data: { mime_type: "image/png", data: "AAAA" } });
    const u = await usageSummary(U);
    expect(u.calls).toBe(1);
    expect(u.costUsd).toBe(0);
    expect(u.recent[0].model).toBe("gemini/gemini-3.8-flash");
  });

  it("retries once with the validation errors when the answer doesn't match the schema", async () => {
    let n = 0;
    handler = (url) => (url.includes("/models?") ? { json: geminiModels } : { json: geminiAnswer(++n === 1 ? '{"verdict":"x"}' : '```json\n{"verdict":"x","score":3}\n```') });
    await expect(call()).resolves.toEqual({ verdict: "x", score: 3 });
    const second = calls.filter((c) => c.url.includes(":generateContent"))[1];
    const lastPart = (second.body!.contents as { parts: { text?: string }[] }[])[0].parts.at(-1)!;
    expect(lastPart.text).toMatch(/score/);
  });

  it("falls back to another configured free provider when rate-limited", async () => {
    process.env.GROQ_API_KEY = "q-test";
    handler = (url) => {
      if (url.includes("generativelanguage") && url.includes("/models?")) return { json: geminiModels };
      if (url.includes("generativelanguage")) return { status: 429, json: { error: { message: "quota" } }, headers: { "retry-after": "0" } };
      if (url.endsWith("/models")) return { json: groqModels };
      return { json: chatAnswer('{"verdict":"from groq","score":70}') };
    };
    await expect(call()).resolves.toEqual({ verdict: "from groq", score: 70 });
    const groqCall = calls.find((c) => c.url.includes("api.groq.com") && c.url.endsWith("/chat/completions"))!;
    expect(groqCall.body!.model).toBe("qwen/qwen3.8-27b");
    expect(groqCall.body!.max_completion_tokens).toBe(16000);
  });

  it("does not fall back when the user turned fallback off, and never falls back to paid Claude", async () => {
    process.env.ANTHROPIC_API_KEY = "paid";
    await setPreferences(U, { aiFallback: false });
    handler = (url) => (url.includes("/models?") ? { json: geminiModels } : { status: 429, json: { error: { message: "quota" } }, headers: { "retry-after": "0" } });
    await expect(call()).rejects.toMatchObject({ code: "rate-limit", provider: "gemini" });
    await setPreferences(U, { aiFallback: true });
    await expect(call()).rejects.toMatchObject({ code: "rate-limit" });
    expect(calls.some((c) => c.url.includes("anthropic"))).toBe(false);
  });

  it("maps truncation and safety blocks, and explains missing keys", async () => {
    handler = (url) => (url.includes("/models?") ? { json: geminiModels } : { json: geminiAnswer("{", "MAX_TOKENS") });
    await expect(call()).rejects.toMatchObject({ code: "truncated" });
    handler = (url) => (url.includes("/models?") ? { json: geminiModels } : { json: geminiAnswer("", "SAFETY") });
    await expect(call()).rejects.toMatchObject({ code: "refusal" });
    delete process.env.GEMINI_API_KEY;
    await expect(call()).rejects.toMatchObject({ code: "not-configured", message: expect.stringMatching(/GEMINI_API_KEY/) });
  });

  it("OpenRouter only offers free vision models and refuses a paid one even if selected", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.OPENROUTER_API_KEY = "or-test";
    const m = (id: string, price: string, inputs: string[], params: string[] = []) => ({ id, pricing: { prompt: price, completion: price }, architecture: { input_modalities: inputs, output_modalities: ["text"] }, supported_parameters: params });
    handler = (url) =>
      url.endsWith("/api/v1/models")
        ? { json: { data: [m("paid/vision-pro", "0.000002", ["text", "image"], ["structured_outputs"]), m("free/text-only:free", "0", ["text"]), m("nvidia/safety-vl:free", "0", ["text", "image"]), m("free/vision-plain:free", "0", ["text", "image"]), m("free/vision-structured:free", "0", ["text", "image"], ["response_format", "structured_outputs"])] } }
        : { json: { ...chatAnswer('{"verdict":"or","score":60}'), model: "free/vision-structured:free" } };
    await setPreferences(U, { aiProvider: "openrouter", aiModels: { ...(await getPreferences(U)).aiModels, openrouter: "auto" } });
    await expect(call()).resolves.toEqual({ verdict: "or", score: 60 });
    const sent = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(sent.body!.model).toBe("free/vision-structured:free");
    expect((sent.body!.response_format as { type: string }).type).toBe("json_schema");
    // A paid model id that somehow got into preferences is resolved away, never called.
    await setPreferences(U, { aiModels: { ...(await getPreferences(U)).aiModels, openrouter: "paid/vision-pro" } });
    calls.length = 0;
    await call();
    expect(calls.filter((c) => c.url.endsWith("/chat/completions")).every((c) => c.body!.model !== "paid/vision-pro")).toBe(true);
  });

  it("keeps the default provider free", async () => {
    expect(await getPreferences(U)).toMatchObject({ aiProvider: "gemini", aiFallback: true, aiModels: { gemini: "auto", groq: "auto", openrouter: "auto" } });
  });
});

describe("JSON helpers", () => {
  it("extracts JSON from fences, think blocks and prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('<think>hmm {"no":1}</think>\nHere you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} Hope that helps.')).toEqual({ a: 3 });
    expect(extractJson("nope")).toBeUndefined();
  });

  it("produces provider-friendly JSON Schema for the real agent schemas", () => {
    for (const s of [CritiqueResult, DesignDocument]) {
      const js = JSON.stringify(toProviderSchema(s));
      expect(js).not.toContain('"oneOf"');
      expect(js).not.toContain('"const"');
      expect(js).not.toContain('"$schema"');
    }
    expect(JSON.stringify(toProviderSchema(DesignDocument))).toContain('"anyOf"');
  });
});
