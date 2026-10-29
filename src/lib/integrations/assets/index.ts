import { errorFields, logger } from "@/lib/logger";
import { iconifyProvider } from "./iconify";
import { openverseProvider } from "./openverse";
import { pexelsProvider } from "./pexels";
import { unsplashProvider } from "./unsplash";
import { wikimediaProvider } from "./wikimedia";
import type { AssetCandidate, AssetProvider, ProviderId, SearchOptions } from "./types";

export const providers: AssetProvider[] = [unsplashProvider, pexelsProvider, openverseProvider, wikimediaProvider, iconifyProvider];

export function getProvider(id: ProviderId): AssetProvider | undefined {
  return providers.find((p) => p.id === id);
}

export function providerStatus() {
  return providers.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured(), setupHint: p.setupHint, kinds: p.kinds }));
}

export interface SearchAssetsOptions extends SearchOptions {
  kinds?: AssetCandidate["type"][];
  providers?: ProviderId[];
}

export interface SearchAssetsResult {
  candidates: AssetCandidate[];
  errors: { provider: ProviderId; message: string }[];
}

/** Query all configured, relevant providers in parallel. One provider failing never fails the search. */
export async function searchAssets(query: string, opts: SearchAssetsOptions = {}): Promise<SearchAssetsResult> {
  const { kinds, providers: only, ...searchOpts } = opts;
  const selected = providers.filter(
    (p) => p.isConfigured() && (!only || only.includes(p.id)) && (!kinds || p.kinds.some((k) => kinds.includes(k))),
  );
  const settled = await Promise.allSettled(selected.map((p) => p.search(query, searchOpts)));

  const candidates: AssetCandidate[] = [];
  const errors: SearchAssetsResult["errors"] = [];
  const seen = new Set<string>();
  settled.forEach((r, i) => {
    const provider = selected[i].id;
    if (r.status === "rejected") {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.warn("asset provider search failed", { provider, ...errorFields(r.reason) });
      errors.push({ provider, message });
      return;
    }
    for (const c of r.value) {
      if ((kinds && !kinds.includes(c.type)) || seen.has(c.downloadUrl)) continue;
      seen.add(c.downloadUrl);
      candidates.push(c);
    }
  });
  return { candidates, errors };
}
