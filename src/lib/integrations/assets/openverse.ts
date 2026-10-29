import { z } from "zod";
import { safeFetchJson } from "@/lib/net/safe-fetch";
import { buildAttribution, normalizeCcLicense } from "./license";
import type { AssetCandidate, AssetProvider, SearchOptions } from "./types";

const API = "https://api.openverse.org/v1/images/";

const ResultSchema = z.object({
  id: z.string(),
  title: z.string().nullish(),
  creator: z.string().nullish(),
  creator_url: z.string().nullish(),
  url: z.string().nullish(),
  thumbnail: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  license: z.string(),
  license_version: z.string().nullish(),
  license_url: z.string().nullish(),
  foreign_landing_url: z.string().nullish(),
  filetype: z.string().nullish(),
  category: z.string().nullish(),
  provider: z.string().nullish(),
  source: z.string().nullish(),
});
const ResponseSchema = z.object({ results: z.array(ResultSchema) });

const ASPECT = { landscape: "wide", portrait: "tall", square: "square" } as const;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

export function mapOpenverseResult(r: z.infer<typeof ResultSchema>): AssetCandidate | null {
  if (!r.url) return null;
  const license = normalizeCcLicense(r.license, r.license_version, r.license_url);
  const title = r.title?.trim() || "Untitled";
  const ext = (r.filetype ?? /\.([a-z0-9]+)(?:$|\?)/i.exec(r.url)?.[1] ?? "").toLowerCase();
  return {
    provider: "openverse",
    providerId: r.id,
    type: r.category === "illustration" || r.category === "digitized_artwork" ? "illustration" : "photo",
    title,
    creator: r.creator?.trim() || null,
    creatorUrl: r.creator_url || null,
    sourcePageUrl: r.foreign_landing_url || `https://openverse.org/image/${r.id}`,
    downloadUrl: r.url,
    thumbnailUrl: r.thumbnail || r.url,
    width: r.width ?? null,
    height: r.height ?? null,
    mime: MIME[ext] ?? null,
    license,
    attribution: buildAttribution(title, r.creator ?? null, r.source ? `${r.source} (Openverse)` : "Openverse", license),
  };
}

export const openverseProvider: AssetProvider = {
  id: "openverse",
  label: "Openverse",
  kinds: ["photo", "illustration"],
  isConfigured: () => true,
  setupHint: null,
  async search(query: string, opts: SearchOptions) {
    const params = new URLSearchParams({ q: query, page_size: String(Math.min(Math.max(opts.perPage ?? 12, 1), 20)) });
    if (opts.commercialOnly) params.set("license_type", "commercial,modification");
    if (opts.orientation) params.set("aspect_ratio", ASPECT[opts.orientation]);
    const json = await safeFetchJson(`${API}?${params}`, { accept: ["application/json"] });
    const data = ResponseSchema.parse(json);
    return data.results.map(mapOpenverseResult).filter((c): c is AssetCandidate => c !== null);
  },
};
