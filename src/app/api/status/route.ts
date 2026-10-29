import { engineChain, isAiConfigured, PROVIDERS } from "@/lib/ai/client";
import { getPreferences } from "@/lib/database/repo";
import { handle, json, requireUser } from "@/lib/http";
import { providerStatus } from "@/lib/integrations/assets";
import { findBrowserExecutable } from "@/lib/design-engine/renderer";
import { env } from "@/lib/env";
import { DEFAULT_FEEDS } from "@/lib/integrations/research/feeds";

/** Integration status for the UI. Reports presence of configuration only — never key values. */
export const GET = handle(async () => {
  const user = await requireUser();
  const prefs = getPreferences(user.id);
  let renderer: { available: boolean; detail: string };
  try {
    const exe = findBrowserExecutable();
    renderer = exe ? { available: true, detail: exe.split(/[\\/]/).pop() ?? exe } : { available: false, detail: "No Edge or Chrome found. Set DESIGNCRITIC_BROWSER_PATH." };
  } catch (err) {
    renderer = { available: false, detail: err instanceof Error ? err.message : String(err) };
  }
  const selected = PROVIDERS[prefs.aiProvider] ?? PROVIDERS.gemini;
  const active = engineChain(user.id).find((p) => p.isConfigured()) ?? null;
  return json({
    ai: {
      /** True when the selected provider, or an allowed free fallback, can answer. */
      configured: Boolean(active),
      anyKey: isAiConfigured(),
      activeLabel: active?.label ?? null,
      activeFree: active?.free ?? true,
      selectedConfigured: selected.isConfigured(),
      provider: selected.id,
      providerLabel: selected.label,
      free: selected.free,
      fallback: prefs.aiFallback,
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, free: p.free, configured: p.isConfigured(), keyEnv: p.keyEnv, signupUrl: p.signupUrl, maxImages: p.maxImages, supportsPdf: p.supportsPdf })),
    },
    renderer,
    assetProviders: providerStatus(),
    researchSources: [
      { id: "feeds", label: "Design publication feeds", configured: true, detail: `${(prefs.researchFeeds.length || DEFAULT_FEEDS.length)} feeds (free, no key)` },
      { id: "collections", label: "The Met + Wikimedia Commons", configured: true, detail: "Open collections (free, no key)" },
      { id: "tavily", label: "Open-web search (Tavily)", configured: Boolean(env.tavilyKey), detail: env.tavilyKey ? "Free tier key set" : "Optional: add a free TAVILY_API_KEY" },
    ],
    planned: [
      { id: "figma", label: "Figma import/export", detail: "Phase 5 — not connected yet." },
      { id: "image-generation", label: "Image generation", detail: "Phase 5 — no provider configured." },
      { id: "supabase", label: "Supabase (hosted database + auth)", detail: "Used when deploying; local SQLite is active." },
    ],
  });
});
