import { z } from "zod";
import { safeFetchJson } from "@/lib/net/safe-fetch";
import { buildAttribution, normalizeCcLicense } from "./license";
import type { AssetCandidate, AssetProvider, SearchOptions } from "./types";

const API = "https://commons.wikimedia.org/w/api.php";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const MetaValue = z.object({ value: z.union([z.string(), z.number()]).transform(String) }).nullish();
const ImageInfoSchema = z.object({
  url: z.string(),
  descriptionurl: z.string(),
  thumburl: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  mime: z.string().nullish(),
  extmetadata: z
    .object({
      LicenseShortName: MetaValue,
      LicenseUrl: MetaValue,
      Artist: MetaValue,
      ObjectName: MetaValue,
      AttributionRequired: MetaValue,
    })
    .nullish(),
});
const PageSchema = z.object({ pageid: z.number(), index: z.number().optional(), title: z.string(), imageinfo: z.array(ImageInfoSchema).nullish() });
const ResponseSchema = z.object({ query: z.object({ pages: z.record(z.string(), PageSchema) }).optional() });

/** Strip HTML tags/entities from extmetadata values (Artist is usually an <a> tag). */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapWikimediaPage(page: z.infer<typeof PageSchema>): AssetCandidate | null {
  const info = page.imageinfo?.[0];
  if (!info || !info.mime || !ALLOWED_MIME.has(info.mime)) return null;
  const meta = info.extmetadata ?? {};
  const license = normalizeCcLicense(meta.LicenseShortName?.value ?? "", null, meta.LicenseUrl?.value ?? null);
  if (meta.AttributionRequired?.value === "true") license.attributionRequired = true;
  const fileTitle = page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
  const title = stripHtml(meta.ObjectName?.value ?? "") || fileTitle;
  const creator = stripHtml(meta.Artist?.value ?? "") || null;
  return {
    provider: "wikimedia",
    providerId: String(page.pageid),
    type: "photo",
    title,
    creator,
    creatorUrl: null,
    sourcePageUrl: info.descriptionurl,
    downloadUrl: info.url,
    thumbnailUrl: info.thumburl || info.url,
    width: info.width ?? null,
    height: info.height ?? null,
    mime: info.mime,
    license,
    attribution: buildAttribution(title, creator, "Wikimedia Commons", license),
  };
}

function matchesOrientation(c: AssetCandidate, o: SearchOptions["orientation"]): boolean {
  if (!o || !c.width || !c.height) return true;
  const r = c.width / c.height;
  return o === "landscape" ? r > 1.1 : o === "portrait" ? r < 0.9 : r >= 0.9 && r <= 1.1;
}

export const wikimediaProvider: AssetProvider = {
  id: "wikimedia",
  label: "Wikimedia Commons",
  kinds: ["photo"],
  isConfigured: () => true,
  setupHint: null,
  async search(query: string, opts: SearchOptions) {
    const perPage = Math.min(Math.max(opts.perPage ?? 12, 1), 30);
    // Over-fetch: orientation, mime and licence filtering happen client-side.
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: `${query} filetype:bitmap`,
      // Orientation discards most results (Commons is mostly landscape), so fetch the max then.
      gsrlimit: String(opts.orientation ? 50 : Math.min(perPage * 4, 50)),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "640",
    });
    const json = await safeFetchJson(`${API}?${params}`, { accept: ["application/json"] });
    const pages = Object.values(ResponseSchema.parse(json).query?.pages ?? {});
    // generator=search returns pages keyed by id; restore relevance order via `index` when present.
    return pages
      .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
      .map(mapWikimediaPage)
      .filter((c): c is AssetCandidate => c !== null)
      .filter((c) => matchesOrientation(c, opts.orientation))
      .filter((c) => !opts.commercialOnly || (c.license.commercialUse === true && c.license.modificationAllowed === true))
      .slice(0, perPage);
  },
};
