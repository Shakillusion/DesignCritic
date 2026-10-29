import type { NextRequest } from "next/server";
import { z } from "zod";
import { isProviderId, PROVIDERS } from "@/lib/ai/client";
import { handle, HttpError, json, requireUser } from "@/lib/http";

/** Models a provider offers this key (free vision models for OpenRouter), for the Settings dropdown. */
export const GET = handle(async (req: NextRequest) => {
  await requireUser();
  const id = z.string().parse(req.nextUrl.searchParams.get("provider"));
  if (!isProviderId(id)) throw new HttpError(400, "Unknown provider.");
  const p = PROVIDERS[id];
  if (!p.isConfigured() && id !== "openrouter") return json({ models: [], configured: false });
  const models = await p.listModels();
  const auto = p.isConfigured() ? await p.resolveModel("auto").catch(() => null) : models[0]?.id ?? null;
  return json({ models, auto, configured: p.isConfigured() });
});
