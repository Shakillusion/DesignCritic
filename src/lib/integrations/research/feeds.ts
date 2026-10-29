import "server-only";
import { safeFetch } from "@/lib/net/safe-fetch";
import type { ResearchItem } from "./types";

/** Design publications with working public RSS feeds (checked 2026-10-29). */
export const DEFAULT_FEEDS: { url: string; name: string }[] = [
  { url: "https://www.creativereview.co.uk/feed/", name: "Creative Review" },
  { url: "https://www.dezeen.com/design/feed/", name: "Dezeen" },
  { url: "https://www.designboom.com/feed/", name: "Designboom" },
  { url: "https://www.creativeboom.com/feed/", name: "Creative Boom" },
  { url: "https://abduzeedo.com/rss.xml", name: "Abduzeedo" },
];

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#039": "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const stripCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripCdata(m[1]) : null;
};
const attr = (block: string, name: string, a: string) => block.match(new RegExp(`<${name}[^>]*\\s${a}=["']([^"']+)["']`, "i"))?.[1] ?? null;

/** Parse RSS 2.0 or Atom into items (no dependencies, tolerant of CDATA and entities). */
export function parseFeed(xml: string, sourceName: string): Omit<ResearchItem, "id">[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: Omit<ResearchItem, "id">[] = [];
  for (const b of blocks) {
    const title = decodeEntities(stripTags(stripCdata(tag(b, "title") ?? "")));
    const link = (tag(b, "link")?.trim() || attr(b, "link", "href") || "").trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const parsed = date ? new Date(date.trim()) : null;
    const rawDesc = tag(b, "description") ?? tag(b, "summary") ?? "";
    const content = decodeEntities(tag(b, "content:encoded") ?? tag(b, "content") ?? "");
    const desc = decodeEntities(stripTags(decodeEntities(rawDesc)));
    const image = attr(b, "enclosure", "url") ?? attr(b, "media:content", "url") ?? attr(b, "media:thumbnail", "url") ?? content.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? decodeEntities(rawDesc).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? null;
    out.push({
      kind: "article",
      source: sourceName,
      title,
      url: link,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      creator: (tag(b, "dc:creator") ?? tag(b, "author") ?? "").replace(/<[^>]+>/g, "").trim() || null,
      summary: desc.replace(/The post .* appeared first on .*$/i, "").trim().slice(0, 400),
      imageUrl: image && /^https?:\/\//.test(image) ? image : null,
      rights: `© ${sourceName} / respective creators — reference only`,
    });
  }
  return out;
}

const g = globalThis as unknown as { __dcFeedCache?: Map<string, { at: number; items: Omit<ResearchItem, "id">[] }> };
const cache = (g.__dcFeedCache ??= new Map());

/** Fetch feeds in parallel (cached 1 h). Failing feeds are reported, never fatal. */
export async function fetchFeeds(feeds: { url: string; name: string }[]): Promise<{ items: Omit<ResearchItem, "id">[]; errors: { source: string; message: string }[] }> {
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const hit = cache.get(f.url);
      if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.items;
      const res = await safeFetch(f.url, { accept: ["application/rss+xml", "application/atom+xml", "application/xml", "text/xml"], maxBytes: 6 * 1024 * 1024, timeoutMs: 15000 });
      const items = parseFeed(res.buffer.toString("utf8"), f.name);
      cache.set(f.url, { at: Date.now(), items });
      return items;
    }),
  );
  const items: Omit<ResearchItem, "id">[] = [];
  const errors: { source: string; message: string }[] = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? items.push(...r.value) : errors.push({ source: feeds[i].name, message: r.reason instanceof Error ? r.reason.message : String(r.reason) })));
  return { items, errors };
}
