import { z } from "zod";
import { safeFetchJson } from "@/lib/net/safe-fetch";
import { buildAttribution, normalizeSpdxLicense, UNKNOWN_LICENSE } from "./license";
import type { AssetCandidate, AssetProvider, SearchOptions } from "./types";

const API = "https://api.iconify.design";

const CollectionSchema = z.object({
  name: z.string().nullish(),
  author: z.object({ name: z.string().nullish(), url: z.string().nullish() }).nullish(),
  license: z.object({ title: z.string().nullish(), spdx: z.string().nullish(), url: z.string().nullish() }).nullish(),
});
const ResponseSchema = z.object({
  icons: z.array(z.string()),
  collections: z.record(z.string(), CollectionSchema).optional(),
});
type Collection = z.infer<typeof CollectionSchema>;

const ICON_ID = /^([a-z0-9-]+):([a-z0-9-]+)$/;

export function mapIconifyIcon(id: string, collection: Collection | undefined): AssetCandidate | null {
  const m = ICON_ID.exec(id);
  if (!m) return null;
  const [, prefix, name] = m;
  const license = collection?.license
    ? normalizeSpdxLicense(collection.license.spdx, collection.license.title, collection.license.url)
    : { ...UNKNOWN_LICENSE };
  const creator = collection?.author?.name?.trim() || null;
  const title = name.replace(/-/g, " ");
  const svgUrl = `${API}/${prefix}/${name}.svg`;
  return {
    provider: "iconify",
    providerId: id,
    type: "icon",
    title,
    creator,
    creatorUrl: collection?.author?.url || null,
    sourcePageUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`,
    downloadUrl: svgUrl,
    thumbnailUrl: svgUrl,
    width: null,
    height: null,
    mime: "image/svg+xml",
    license,
    attribution: license.attributionRequired
      ? buildAttribution(title, creator, collection?.name ? `${collection.name} (Iconify)` : "Iconify", license)
      : null,
  };
}

export const iconifyProvider: AssetProvider = {
  id: "iconify",
  label: "Iconify",
  kinds: ["icon"],
  isConfigured: () => true,
  setupHint: null,
  async search(query: string, opts: SearchOptions) {
    const perPage = Math.min(Math.max(opts.perPage ?? 12, 1), 100);
    // The API enforces a minimum limit of 32; slice afterwards.
    const params = new URLSearchParams({ query, limit: String(Math.max(perPage * 2, 32)) });
    const json = await safeFetchJson(`${API}/search?${params}`, { accept: ["application/json"] });
    const data = ResponseSchema.parse(json);
    return data.icons
      .map((id) => mapIconifyIcon(id, data.collections?.[id.split(":")[0]]))
      .filter((c): c is AssetCandidate => c !== null)
      .filter((c) => !opts.commercialOnly || (c.license.commercialUse === true && c.license.modificationAllowed === true))
      .slice(0, perPage);
  },
};
