import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { wikimediaProvider } from "@/lib/integrations/assets/wikimedia";
import { safeFetch, safeFetchJson } from "@/lib/net/safe-fetch";
import { decodeEntities } from "./feeds";
import type { ResearchItem } from "./types";

/** The Met Collection API (open, no key). v1 search was retired 2026-10-01; v1.1 is current. */
const MetSearch = z.object({ total: z.number(), objectIDs: z.array(z.number()).nullable() });
const MetObject = z.object({
  objectID: z.number(),
  title: z.string().default(""),
  objectDate: z.string().default(""),
  artistDisplayName: z.string().default(""),
  primaryImageSmall: z.string().default(""),
  objectURL: z.string().default(""),
  isPublicDomain: z.boolean().default(false),
  department: z.string().default(""),
  classification: z.string().default(""),
  medium: z.string().default(""),
});

export async function searchMet(query: string, limit = 8): Promise<Omit<ResearchItem, "id">[]> {
  const s = MetSearch.parse(await safeFetchJson(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&q=${encodeURIComponent(query)}`, { timeoutMs: 15000 }));
  const ids = (s.objectIDs ?? []).slice(0, limit * 3);
  const objects = await Promise.allSettled(ids.map((id) => safeFetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { timeoutMs: 15000 }).then((j) => MetObject.parse(j))));
  // Keep graphic/visual-communication objects; the Met's text search also matches vases, textiles, etc.
  const graphic = /print|poster|photograph|drawing|graphic|book|ephemera|advertis|design|illustrat/i;
  return objects
    .flatMap((o) => (o.status === "fulfilled" && o.value.primaryImageSmall && graphic.test(`${o.value.classification} ${o.value.medium} ${o.value.department}`) ? [o.value] : []))
    .slice(0, limit)
    .map((o) => ({
      kind: "visual" as const,
      source: "The Met",
      title: o.title || "Untitled",
      url: o.objectURL,
      publishedAt: null,
      creator: o.artistDisplayName || null,
      summary: [o.objectDate, o.classification || o.department, o.medium].filter(Boolean).join(" · ").slice(0, 300),
      imageUrl: o.primaryImageSmall,
      rights: o.isPublicDomain ? "Public domain (The Met Open Access)" : "© rights reserved — reference only",
    }));
}

/** Wikimedia Commons visual references (any licence: references are never placed in artwork). */
export async function searchCommons(query: string, limit = 8): Promise<Omit<ResearchItem, "id">[]> {
  const found = await wikimediaProvider.search(query, { perPage: limit, commercialOnly: false });
  return found.slice(0, limit).map((c) => ({
    kind: "visual" as const,
    source: "Wikimedia Commons",
    title: c.title,
    url: c.sourcePageUrl,
    publishedAt: null,
    creator: c.creator,
    summary: `${c.width ?? "?"}×${c.height ?? "?"}`,
    imageUrl: c.thumbnailUrl,
    rights: c.license.name,
  }));
}

/** Optional open-web search with a free Tavily key (1 credit per basic search). */
export async function searchTavily(query: string, limit = 8): Promise<Omit<ResearchItem, "id">[]> {
  if (!env.tavilyKey) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.tavilyKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: limit, include_published_date: true }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const j = z.object({ results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string().default(""), published_date: z.string().nullable().optional() })) }).parse(await res.json());
  return j.results.map((r) => ({
    kind: "web" as const,
    source: new URL(r.url).hostname.replace(/^www\./, ""),
    title: r.title,
    url: r.url,
    publishedAt: r.published_date ? new Date(r.published_date).toISOString() : null,
    creator: null,
    summary: r.content.slice(0, 400),
    imageUrl: null,
    rights: "Web page — reference only",
  }));
}

/** Link preview for a URL the user pasted (Behance, Dribbble, Pinterest…): reads only that page's meta tags. */
export async function previewLink(url: string): Promise<Omit<ResearchItem, "id">> {
  const res = await safeFetch(url, { accept: ["text/html", "application/xhtml"], maxBytes: 3 * 1024 * 1024, timeoutMs: 15000 });
  const html = res.buffer.toString("utf8").slice(0, 400_000);
  const meta = (names: string[]) => {
    for (const n of names) {
      const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i")) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i"));
      if (m?.[1]) return decodeEntities(m[1]).trim();
    }
    return null;
  };
  const host = new URL(res.finalUrl).hostname.replace(/^www\./, "");
  const title = meta(["og:title", "twitter:title"]) ?? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() ?? host;
  let image = meta(["og:image", "og:image:url", "twitter:image"]);
  if (image && !/^https?:\/\//.test(image)) image = new URL(image, res.finalUrl).toString();
  const published = meta(["article:published_time", "og:updated_time", "date"]);
  const parsed = published ? new Date(published) : null;
  return {
    kind: "link",
    source: meta(["og:site_name"]) ?? host,
    title: title || host,
    url: res.finalUrl,
    publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    creator: meta(["author", "article:author"]),
    summary: (meta(["og:description", "description", "twitter:description"]) ?? "").slice(0, 400),
    imageUrl: image,
    rights: `© ${host} / creator — reference only`,
  };
}
