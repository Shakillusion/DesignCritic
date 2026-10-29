import { z } from "zod";
import { env } from "@/lib/env";
import { safeFetchJson } from "@/lib/net/safe-fetch";
import { UNSPLASH_LICENSE } from "./license";
import type { AssetCandidate, AssetProvider, SearchOptions } from "./types";

const API = "https://api.unsplash.com";
const ORIENTATION = { landscape: "landscape", portrait: "portrait", square: "squarish" } as const;

const PhotoSchema = z.object({
  id: z.string(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  description: z.string().nullish(),
  alt_description: z.string().nullish(),
  urls: z.object({ raw: z.string(), small: z.string() }),
  links: z.object({ html: z.string(), download_location: z.string().nullish() }),
  user: z.object({ name: z.string(), links: z.object({ html: z.string() }) }),
});
const ResponseSchema = z.object({ results: z.array(PhotoSchema) });

function withUtm(url: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "designcritic");
  u.searchParams.set("utm_medium", "referral");
  return u.toString();
}

function authHeaders(key: string) {
  return { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" };
}

export function mapUnsplashPhoto(p: z.infer<typeof PhotoSchema>): AssetCandidate {
  const download = new URL(p.urls.raw);
  download.searchParams.set("w", "3000");
  download.searchParams.set("q", "85");
  download.searchParams.set("fm", "jpg");
  const title = p.alt_description?.trim() || p.description?.trim() || "Untitled";
  return {
    provider: "unsplash",
    providerId: p.id,
    type: "photo",
    title,
    creator: p.user.name,
    creatorUrl: withUtm(p.user.links.html),
    sourcePageUrl: withUtm(p.links.html),
    downloadUrl: download.toString(),
    thumbnailUrl: p.urls.small,
    width: p.width ?? null,
    height: p.height ?? null,
    mime: "image/jpeg",
    license: { ...UNSPLASH_LICENSE },
    attribution: `Photo by ${p.user.name} on Unsplash`,
    trackDownloadUrl: p.links.download_location ?? null,
  };
}

/** Unsplash API guideline: ping `download_location` when a photo is actually used. */
export async function trackUnsplashDownload(url: string): Promise<void> {
  const key = env.unsplashKey;
  if (!key) throw new Error("UNSPLASH_ACCESS_KEY is not set");
  if (new URL(url).hostname !== "api.unsplash.com") throw new Error("Not an Unsplash API URL");
  await safeFetchJson(url, { accept: ["application/json"], headers: authHeaders(key) });
}

export const unsplashProvider: AssetProvider = {
  id: "unsplash",
  label: "Unsplash",
  kinds: ["photo"],
  isConfigured: () => Boolean(env.unsplashKey),
  setupHint: "Set UNSPLASH_ACCESS_KEY in .env.local (create an app at https://unsplash.com/oauth/applications and copy its Access Key).",
  async search(query: string, opts: SearchOptions) {
    const key = env.unsplashKey;
    if (!key) throw new Error("Unsplash is not configured (UNSPLASH_ACCESS_KEY missing)");
    const params = new URLSearchParams({ query, per_page: String(Math.min(Math.max(opts.perPage ?? 12, 1), 30)) });
    if (opts.orientation) params.set("orientation", ORIENTATION[opts.orientation]);
    const json = await safeFetchJson(`${API}/search/photos?${params}`, { accept: ["application/json"], headers: authHeaders(key) });
    // Unsplash License always permits commercial use + modification, so commercialOnly needs no filter.
    return ResponseSchema.parse(json).results.map(mapUnsplashPhoto);
  },
};
