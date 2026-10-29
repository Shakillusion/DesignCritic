import { z } from "zod";
import { env } from "@/lib/env";
import { safeFetchJson } from "@/lib/net/safe-fetch";
import { PEXELS_LICENSE } from "./license";
import type { AssetCandidate, AssetProvider, SearchOptions } from "./types";

const API = "https://api.pexels.com/v1/search";

const PhotoSchema = z.object({
  id: z.number(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  url: z.string(),
  photographer: z.string().nullish(),
  photographer_url: z.string().nullish(),
  alt: z.string().nullish(),
  src: z.object({ original: z.string().nullish(), large2x: z.string().nullish(), medium: z.string() }),
});
const ResponseSchema = z.object({ photos: z.array(PhotoSchema) });

export function mapPexelsPhoto(p: z.infer<typeof PhotoSchema>): AssetCandidate | null {
  const downloadUrl = p.src.original || p.src.large2x;
  if (!downloadUrl) return null;
  const creator = p.photographer?.trim() || null;
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(downloadUrl)?.[1]?.toLowerCase();
  return {
    provider: "pexels",
    providerId: String(p.id),
    type: "photo",
    title: p.alt?.trim() || "Untitled",
    creator,
    creatorUrl: p.photographer_url || null,
    sourcePageUrl: p.url,
    downloadUrl,
    thumbnailUrl: p.src.medium,
    width: p.width ?? null,
    height: p.height ?? null,
    mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
    license: { ...PEXELS_LICENSE },
    attribution: creator ? `Photo by ${creator} on Pexels` : "Photo from Pexels",
  };
}

export const pexelsProvider: AssetProvider = {
  id: "pexels",
  label: "Pexels",
  kinds: ["photo"],
  isConfigured: () => Boolean(env.pexelsKey),
  setupHint: "Set PEXELS_API_KEY in .env.local (request a free key at https://www.pexels.com/api/).",
  async search(query: string, opts: SearchOptions) {
    const key = env.pexelsKey;
    if (!key) throw new Error("Pexels is not configured (PEXELS_API_KEY missing)");
    const params = new URLSearchParams({ query, per_page: String(Math.min(Math.max(opts.perPage ?? 12, 1), 80)) });
    if (opts.orientation) params.set("orientation", opts.orientation);
    const json = await safeFetchJson(`${API}?${params}`, { accept: ["application/json"], headers: { Authorization: key } });
    return ResponseSchema.parse(json).photos.map(mapPexelsPhoto).filter((c): c is AssetCandidate => c !== null);
  },
};
