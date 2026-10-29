/** Normalised licence information for an external asset. */
export interface AssetLicense {
  /** Short code: cc0, pdm, cc-by, cc-by-sa, cc-by-nc, cc-by-nd, unsplash, pexels, pixabay, mit, apache-2.0, ofl, user-owned, unknown… */
  code: string;
  name: string;
  url: string | null;
  /** null = the provider did not document it. */
  commercialUse: boolean | null;
  modificationAllowed: boolean | null;
  attributionRequired: boolean;
  shareAlike: boolean;
  notes: string | null;
}

export type ProviderId = "openverse" | "wikimedia" | "unsplash" | "pexels" | "iconify";

export interface AssetCandidate {
  provider: ProviderId;
  providerId: string;
  type: "photo" | "illustration" | "vector" | "icon";
  title: string;
  creator: string | null;
  creatorUrl: string | null;
  /** Human-facing page for the asset (for attribution and verification). */
  sourcePageUrl: string;
  /** Direct file URL used for downloading. */
  downloadUrl: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  mime: string | null;
  license: AssetLicense;
  /** Ready-to-print attribution line, when one is required or recommended. */
  attribution: string | null;
  /** Provider-specific follow-up, e.g. Unsplash's download tracking endpoint. */
  trackDownloadUrl?: string | null;
}

export interface SearchOptions {
  orientation?: "landscape" | "portrait" | "square";
  perPage?: number;
  /** Only return assets whose licence allows commercial use + modification. */
  commercialOnly?: boolean;
}

export interface AssetProvider {
  id: ProviderId;
  label: string;
  kinds: AssetCandidate["type"][];
  /** Whether the provider is usable right now (e.g. API key present). */
  isConfigured(): boolean;
  setupHint: string | null;
  search(query: string, opts: SearchOptions): Promise<AssetCandidate[]>;
}

/** Usage decision for automatic integration. */
export type LicenseVerdict = "auto-ok" | "needs-review" | "blocked";
