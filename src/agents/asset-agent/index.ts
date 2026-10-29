import "server-only";
import { z } from "zod";
import { engineLimits, imageBlock, structuredCall, UNTRUSTED_CONTENT_RULE, type UserContent } from "@/lib/ai/client";
import { findAssetByProviderId, insertAsset, updateAsset } from "@/lib/database/repo";
import { colorProfile, preparePhoto, prepareForVision, validateUpload } from "@/lib/image-processing/image";
import { providerStatus, searchAssets } from "@/lib/integrations/assets";
import { licenseVerdict } from "@/lib/integrations/assets/license";
import { trackUnsplashDownload } from "@/lib/integrations/assets/unsplash";
import type { AssetCandidate } from "@/lib/integrations/assets/types";
import { safeFetch, SafeFetchError } from "@/lib/net/safe-fetch";
import { saveFile } from "@/lib/storage/storage";
import { logger } from "@/lib/logger";
import type { Asset } from "@/types/domain";

/**
 * Visual Asset Agent: finds real, legally reusable imagery, judges it for the
 * layout it must serve, downloads it server-side (SSRF-safe), prepares a
 * working copy and records licence + attribution. Inspiration/research is a
 * different agent; this one only handles assets that end up in the artwork.
 */

export interface AssetNeed {
  query: string;
  purpose: string;
  orientation: "landscape" | "portrait" | "square";
  /** Where the layout needs calm space for type. */
  textZone: "top" | "bottom" | "left" | "right" | "center" | "none";
}

export class AssetSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetSearchError";
  }
}

const Ranking = z.object({
  evaluations: z.array(
    z.object({
      index: z.number(),
      relevance: z.number().describe("0–10"),
      composition: z.number().describe("0–10: focal point, balance, cropping potential for the target aspect ratio"),
      textSpaceFit: z.number().describe("0–10: how much calm, low-detail space exists where the layout needs type"),
      quality: z.number().describe("0–10: sharpness, lighting, professional finish, no watermarks/text/logos"),
      negativeSpace: z.enum(["left", "right", "top", "bottom", "center", "none"]),
      focalX: z.number().describe("0–1 horizontal position of the main subject"),
      focalY: z.number().describe("0–1 vertical position of the main subject"),
      issues: z.string().describe("Watermarks, visible text, people's faces needing releases, clichés, artefacts — or 'none'"),
      description: z.string(),
    }),
  ),
  bestIndex: z.number(),
  reason: z.string().describe("Why the chosen image best supports this layout"),
});

const MIN_EDGE_RATIO = 0.75; // the downloaded file's long edge must reach 75% of the artboard's long edge

function aspectFit(c: AssetCandidate, target: number) {
  if (!c.width || !c.height) return 0.5;
  const r = c.width / c.height;
  return Math.min(r, target) / Math.max(r, target); // 1 = same shape
}

/** Mood/season words rarely appear in photo titles; dropping them broadens keyword search. */
const NON_VISUAL = /^(summer|winter|spring|autumn|fall|majestic|calm|serene|beautiful|stunning|premium|luxury|luxurious|cinematic|dramatic|peaceful|quiet|epic|golden|hour|morning|evening|reflection|reflections|scenic|view|photo|photography|landscape)$/i;

export function queryVariants(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const visual = words.filter((w) => !NON_VISUAL.test(w));
  const out = [words.join(" "), visual.join(" "), visual.slice(0, 3).join(" "), visual.slice(0, 2).join(" "), `${visual[0] ?? words[0]} landscape`];
  return [...new Set(out.map((q) => q.trim()).filter((q) => q.length > 1))];
}

/** Search, rank and import the best licensed photo for one layout need. */
export async function sourceAsset(opts: {
  userId: string;
  projectId: string;
  need: AssetNeed;
  artboard: { width: number; height: number };
  brandImagery?: string;
  log?: (msg: string) => void;
}): Promise<{ asset: Asset; considered: number; reason: string; providerErrors: string[] }> {
  const { need, artboard } = opts;
  const log = opts.log ?? (() => {});
  const targetRatio = artboard.width / artboard.height;
  const longEdge = Math.max(artboard.width, artboard.height);

  // Keyword search (Wikimedia especially) needs every word to match, so broaden the query until enough licensed results appear.
  const candidates: AssetCandidate[] = [];
  const providerErrors: string[] = [];
  let active = providerStatus()
    .filter((p) => p.configured && p.kinds.includes("photo"))
    .map((p) => p.id);
  // A photo is usable if, after cropping to the artboard's shape, it still covers it at ≥ MIN_EDGE_RATIO resolution.
  const coverage = (c: AssetCandidate) => (c.width && c.height ? Math.min(c.width / artboard.width, c.height / artboard.height) : 1);
  const isUsable = (c: AssetCandidate) => licenseVerdict(c.license) === "auto-ok" && coverage(c) >= MIN_EDGE_RATIO;
  for (const query of queryVariants(need.query)) {
    if (!active.length) break;
    log(`Searching for “${query}”`);
    // No orientation filter: a large landscape photo crops well into a portrait poster (coverage is checked above).
    const res = await searchAssets(query, { kinds: ["photo"], providers: active, perPage: 30, commercialOnly: true });
    for (const e of res.errors) {
      providerErrors.push(`${e.provider}: ${e.message}`);
      active = active.filter((p) => p !== e.provider); // don't wait on a failing provider again
    }
    for (const c of res.candidates) if (!candidates.some((x) => x.downloadUrl === c.downloadUrl)) candidates.push(c);
    if (candidates.filter(isUsable).length >= 3) break;
  }

  // Licence gate first: automatic mode only uses assets whose licence clearly allows commercial use and modification.
  const licensed = candidates.filter((c) => licenseVerdict(c.license) === "auto-ok");
  const sized = candidates.filter(isUsable);
  if (!sized.length) {
    const why = !candidates.length
      ? `No results for “${need.query}”.`
      : !licensed.length
        ? `Found ${candidates.length} results, but none had a licence that clearly allows commercial use and modification (share-alike, non-commercial and unknown licences are skipped).`
        : `Licensed results were too small for a ${artboard.width}×${artboard.height} artboard.`;
    throw new AssetSearchError(`${why}${providerErrors.length ? ` Provider issues: ${providerErrors.join("; ")}.` : ""}`);
  }

  // Compare as many candidates as the AI provider accepts in one request (Groq: 3).
  const fitScore = (c: AssetCandidate) => Math.min(coverage(c), 2) * (0.6 + 0.4 * aspectFit(c, targetRatio));
  const shortlist = [...sized].sort((a, b) => fitScore(b) - fitScore(a)).slice(0, Math.min(6, (await engineLimits(opts.userId)).maxImages));
  log(`Comparing ${shortlist.length} licensed candidates`);

  // Thumbnails for visual judgement (fetched server-side through the SSRF-safe client).
  const thumbs = await Promise.all(
    shortlist.map(async (c) => {
      try {
        const res = await safeFetch(c.thumbnailUrl, { accept: ["image/"], maxBytes: 8 * 1024 * 1024, timeoutMs: 15000 });
        return await prepareForVision(res.buffer, 512);
      } catch (err) {
        logger.warn("asset.thumb_failed", { provider: c.provider, error: String(err) });
        return null;
      }
    }),
  );
  const viewable = shortlist.map((c, i) => ({ c, t: thumbs[i] })).filter((x): x is { c: AssetCandidate; t: NonNullable<typeof x.t> } => Boolean(x.t));
  if (!viewable.length) throw new AssetSearchError("Couldn't load previews of the candidate images.");

  const content: UserContent = [];
  viewable.forEach(({ c, t }, i) => {
    content.push({ type: "text", text: `Candidate ${i}: “${c.title}” (${c.width ?? "?"}×${c.height ?? "?"}, ${c.provider})` });
    content.push(imageBlock(t.base64, t.mediaType));
  });
  content.push({
    type: "text",
    text: `Layout need: ${need.purpose}
Artboard: ${artboard.width}×${artboard.height}px (aspect ${targetRatio.toFixed(2)}). The photo will be cropped to fill it.
Typography will sit in the ${need.textZone} area, so that area of the photo needs calm, low-detail space.
${opts.brandImagery ? `Brand photography direction: ${opts.brandImagery}` : ""}
Evaluate every candidate and pick the one that best serves this layout — not merely the prettiest. Reject images with watermarks, burned-in text or logos.`,
  });

  const ranking = await structuredCall({
    operation: "asset.rank",
    userId: opts.userId,
    effort: "medium",
    maxTokens: 12000,
    system: `You are a photo editor and art director selecting stock photography for a layout. Judge composition, focal point, light, authenticity, colour, and especially whether the image leaves clean space where the type must go. ${UNTRUSTED_CONTENT_RULE}`,
    content,
    schema: Ranking,
  });

  const bestIdx = Math.min(viewable.length - 1, Math.max(0, Math.round(ranking.bestIndex)));
  const chosen = viewable[bestIdx].c;
  const evalOf = ranking.evaluations.find((e) => e.index === bestIdx);
  log(`Selected “${chosen.title}” from ${chosen.provider}`);

  const asset = await importCandidate({
    userId: opts.userId,
    projectId: opts.projectId,
    candidate: chosen,
    artboard,
    maxEdge: Math.min(4096, Math.round(longEdge * 1.5)),
    log,
    analysis: {
      focalX: evalOf?.focalX,
      focalY: evalOf?.focalY,
      negativeSpace: evalOf?.negativeSpace,
      description: evalOf?.description,
      selectionReason: ranking.reason,
      score: evalOf ? Math.round(((evalOf.relevance + evalOf.composition + evalOf.textSpaceFit + evalOf.quality) / 4) * 10) : undefined,
    },
  });
  return { asset, considered: viewable.length, reason: ranking.reason, providerErrors };
}

/** Download a candidate's original file, keep it immutable, and store a prepared working copy + licence record. */
/** Wikimedia's standard thumbnail widths (non-standard sizes are strictly rate-limited since early 2026). */
const WIKIMEDIA_STEPS = [960, 1280, 1920, 3840];

/** Smallest standard rendition that still covers the artboard at full resolution, or null to use the original. */
export function wikimediaRendition(c: AssetCandidate, artboard?: { width: number; height: number }): { url: string; width: number } | null {
  const m = c.thumbnailUrl.match(/^(https:\/\/[^/]+\/wikipedia\/commons\/thumb\/.+\/)(\d+)px-([^/?]+)/);
  if (!m || !c.width || !c.height) return null;
  const target = artboard ?? { width: 1920, height: 1920 };
  const neededWidth = Math.ceil(c.width * Math.max(target.width / c.width, target.height / c.height));
  const step = WIKIMEDIA_STEPS.find((s) => s >= neededWidth) ?? WIKIMEDIA_STEPS[WIKIMEDIA_STEPS.length - 1];
  if (step >= c.width) return null; // the original is already that small
  return { url: `${m[1]}${step}px-${m[3]}`, width: step };
}

export async function importCandidate(opts: { userId: string; projectId: string; candidate: AssetCandidate; artboard?: { width: number; height: number }; maxEdge?: number; analysis?: Asset["analysis"]; log?: (m: string) => void }): Promise<Asset> {
  const chosen = opts.candidate;
  const log = opts.log ?? (() => {});
  const existing = await findAssetByProviderId(opts.userId, opts.projectId, chosen.provider, chosen.providerId);
  if (existing) return existing;
  if (licenseVerdict(chosen.license) === "blocked") throw new AssetSearchError(`“${chosen.title}” is licensed ${chosen.license.name}, which doesn't allow this use.`);

  const isSvg = chosen.mime === "image/svg+xml";
  const fetchImage = (url: string) => withRateLimitRetry(() => safeFetch(url, { accept: isSvg ? ["image/svg+xml"] : ["image/"], maxBytes: 40 * 1024 * 1024, timeoutMs: 60000 }), log);
  // Wikimedia throttles original-file downloads; its cached standard-width renditions are the supported route.
  const rendition = chosen.provider === "wikimedia" ? wikimediaRendition(chosen, opts.artboard) : null;
  let dl: Awaited<ReturnType<typeof safeFetch>>;
  if (rendition) {
    log(`Downloading a ${rendition.width}px rendition`);
    dl = await fetchImage(rendition.url).catch(() => {
      log("Rendition unavailable; downloading the original file");
      return fetchImage(chosen.downloadUrl);
    });
  } else {
    log("Downloading the full-resolution file");
    dl = await fetchImage(chosen.downloadUrl);
  }
  const valid = await validateUpload(dl.buffer, { allow: isSvg ? ["svg"] : ["raster"], maxBytes: 40 * 1024 * 1024 });
  if (chosen.provider === "unsplash" && chosen.trackDownloadUrl) void trackUnsplashDownload(chosen.trackDownloadUrl).catch(() => {});

  const original = await saveFile(opts.userId, valid.buffer, {
    projectId: opts.projectId,
    kind: "asset-original",
    originalName: `${chosen.provider}-${chosen.providerId}`.replace(/[^\w.-]+/g, "_").slice(0, 120) + (valid.mime === "image/png" ? ".png" : ".jpg"),
    mime: valid.mime,
    width: valid.width,
    height: valid.height,
    meta: { sourceUrl: chosen.downloadUrl, finalUrl: dl.finalUrl, rendition: dl.finalUrl !== chosen.downloadUrl && rendition ? `${rendition.width}px standard rendition of the original` : undefined },
  });

  // Non-destructive working copy sized for the artboard (originals are never modified). Vectors stay as-is.
  let preparedFileId: string | null = null;
  let profile: { luminance?: number; dominantColors?: string[] } = {};
  if (!isSvg) {
    log("Preparing a working copy");
    const prepared = await preparePhoto(valid.buffer, opts.maxEdge ?? 3000);
    const preparedFile = await saveFile(opts.userId, prepared.buffer, {
      projectId: opts.projectId,
      kind: "asset-prepared",
      originalName: original.originalName.replace(/\.\w+$/, "-prepared.jpg"),
      mime: "image/jpeg",
      width: prepared.width,
      height: prepared.height,
      meta: { derivedFrom: original.id, operation: `resize-inside ${prepared.width}x${prepared.height}` },
    });
    preparedFileId = preparedFile.id;
    profile = await colorProfile(prepared.buffer);
  }

  return await insertAsset(opts.userId, {
    projectId: opts.projectId,
    fileId: original.id,
    preparedFileId,
    type: chosen.type === "icon" ? "icon" : chosen.type === "vector" ? "vector" : chosen.type === "illustration" ? "illustration" : "photo",
    source: "provider",
    provider: chosen.provider,
    providerId: chosen.providerId,
    title: chosen.title,
    creator: chosen.creator,
    creatorUrl: chosen.creatorUrl,
    sourceUrl: chosen.sourcePageUrl,
    license: chosen.license,
    attribution: chosen.attribution,
    locked: false,
    // Needs-review licences (share-alike, unclear terms) arrive pending until the user approves them.
    status: licenseVerdict(chosen.license) === "auto-ok" ? "approved" : "pending",
    analysis: { ...opts.analysis, ...profile },
    retrievedAt: new Date().toISOString(),
  });
}

/** Media hosts (notably Wikimedia) rate-limit bursts; back off and retry a bounded number of times. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, log: (m: string) => void, delays = [3000, 8000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const limited = err instanceof SafeFetchError && err.code === "bad-status" && (err.status === 429 || err.status === 503);
      if (!limited || attempt >= delays.length) throw err;
      log(`Host is rate-limiting; retrying in ${delays[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

/** Analyse a user-uploaded photo so the builder can lay type around it. */
export async function analyzeOwnAsset(opts: { userId: string; asset: Asset; image: Buffer }): Promise<Asset> {
  if (opts.asset.analysis.focalX !== undefined) return opts.asset;
  const t = await prepareForVision(opts.image, 768);
  const r = await structuredCall({
    operation: "asset.analyze",
    userId: opts.userId,
    effort: "low",
    maxTokens: 4000,
    system: `You analyse photographs for layout. ${UNTRUSTED_CONTENT_RULE}`,
    content: [imageBlock(t.base64, t.mediaType), { type: "text", text: "Locate the main subject and the calmest area for typography." }],
    schema: z.object({
      focalX: z.number(),
      focalY: z.number(),
      negativeSpace: z.enum(["left", "right", "top", "bottom", "center", "none"]),
      description: z.string(),
    }),
  });
  return await updateAsset(opts.userId, opts.asset.id, { analysis: { ...opts.asset.analysis, ...r } });
}
