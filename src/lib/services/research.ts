import "server-only";
import { brandRulesText } from "@/agents/brand-guardian";
import { analyzeResearch, proposeDirections } from "@/agents/research";
import { engineLimits } from "@/lib/ai/client";
import { getBrand, getPreferences, getProject } from "@/lib/database/repo";
import { getMoodboard, getResearchRun, insertReference, saveDirections, saveResearchRun, type ResearchQuery } from "@/lib/database/research-repo";
import { HttpError } from "@/lib/http";
import { colorProfile, prepareForVision, thumbnail, validateUpload } from "@/lib/image-processing/image";
import { searchCommons, searchMet, searchTavily, previewLink } from "@/lib/integrations/research/collections";
import { DEFAULT_FEEDS, fetchFeeds } from "@/lib/integrations/research/feeds";
import type { ResearchItem, SourceError } from "@/lib/integrations/research/types";
import { startJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { safeFetch } from "@/lib/net/safe-fetch";
import { readFile, saveFile } from "@/lib/storage/storage";

/** Rank feed articles by keyword overlap with the request so relevant coverage reaches the model first. */
export function rankArticles<T extends { title: string; summary: string; publishedAt: string | null }>(items: T[], query: ResearchQuery, limit: number): T[] {
  const words = `${query.topic} ${query.industry} ${query.direction}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  const score = (i: T) => {
    const text = `${i.title} ${i.summary}`.toLowerCase();
    const hits = words.filter((w) => text.includes(w)).length;
    const ageDays = i.publishedAt ? (Date.now() - new Date(i.publishedAt).getTime()) / 86_400_000 : 365;
    return hits * 10 - Math.min(ageDays, 120) / 30;
  };
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

async function fetchThumb(url: string) {
  const res = await safeFetch(url, { accept: ["image/"], maxBytes: 12 * 1024 * 1024, timeoutMs: 15000 });
  return res.buffer;
}

export async function startResearch(userId: string, input: { projectId: string } & ResearchQuery) {
  const project = await getProject(userId, input.projectId);
  const query: ResearchQuery = { topic: input.topic, industry: input.industry, direction: input.direction };
  return await startJob(
    userId,
    {
      type: "research",
      projectId: project.id,
      steps: [
        { key: "gather", label: "Gathering design coverage and visual references" },
        { key: "analyze", label: "Research Agent reading the evidence" },
      ],
    },
    async (ctx) => {
      const prefs = await getPreferences(userId);
      const feeds = prefs.researchFeeds.length ? prefs.researchFeeds.map((url) => ({ url, name: DEFAULT_FEEDS.find((f) => f.url === url)?.name ?? new URL(url).hostname.replace(/^www\./, "") })) : DEFAULT_FEEDS;
      const { items, errors } = await ctx.step("gather", async (detail) => {
        const visualQuery = [query.topic, query.direction].filter(Boolean).join(" ").slice(0, 120);
        const errors: SourceError[] = [];
        const settle = async (source: string, p: Promise<Omit<ResearchItem, "id">[]>) => p.catch((e) => (errors.push({ source, message: e instanceof Error ? e.message : String(e) }), []));
        const [feedRes, met, commons, web] = await Promise.all([
          fetchFeeds(feeds),
          settle("The Met", searchMet(query.topic, 6)),
          settle("Wikimedia Commons", searchCommons(`${query.topic} poster`, 6).then(async (r) => (r.length ? r : searchCommons(query.topic, 6)))),
          settle("Web search (Tavily)", searchTavily(`${visualQuery} graphic design trends ${new Date().getFullYear()}`, 8)),
        ]);
        errors.push(...feedRes.errors);
        const articles = rankArticles(feedRes.items, query, 24);
        const all = [...articles, ...web, ...met, ...commons];
        const counter = { article: 0, visual: 0, web: 0, link: 0 };
        const prefix = { article: "a", visual: "v", web: "w", link: "l" } as const;
        const numbered: ResearchItem[] = all.map((i) => ({ ...i, id: `${prefix[i.kind]}${++counter[i.kind]}` }));
        detail(`${articles.length} articles from ${feeds.length} publications · ${met.length + commons.length} visual references${web.length ? ` · ${web.length} web results` : ""}${errors.length ? ` · ${errors.length} source(s) unavailable` : ""}`);
        return { items: numbered, errors };
      });
      if (!items.length) throw new Error(`No sources returned anything. ${errors.map((e) => `${e.source}: ${e.message}`).join("; ")}`);

      const brief = await ctx.step("analyze", async (detail) => {
        // Show the model a few images (within the provider's per-request limit) so visual claims are grounded.
        const visuals = items.filter((i) => i.imageUrl && i.kind === "visual").slice(0, Math.max(0, Math.min(6, (await engineLimits(userId)).maxImages)));
        const thumbs = (
          await Promise.all(
            visuals.map(async (v) => {
              try {
                const p = await prepareForVision(await fetchThumb(v.imageUrl!), 512);
                return { id: v.id, base64: p.base64, mediaType: p.mediaType };
              } catch {
                return null;
              }
            }),
          )
        ).filter((x): x is NonNullable<typeof x> => Boolean(x));
        const b = await analyzeResearch({ userId, query, items, thumbnails: thumbs });
        detail(`${b.insights.length} cited insight(s)${b.uncited?.length ? ` · ${b.uncited.length} uncited note(s) labelled` : ""}`);
        return b;
      });
      const run = await saveResearchRun(userId, { projectId: project.id, query, items, brief, sourceErrors: errors });
      return { runId: run.id };
    },
  );
}

/** Save a retrieved item (or a pasted link) to the project's references, with a local preview and palette. */
export async function saveReference(userId: string, input: { projectId: string; runId?: string; itemId?: string; url?: string }) {
  await getProject(userId, input.projectId);
  let item: Omit<ResearchItem, "id">;
  if (input.runId && input.itemId) {
    const run = await getResearchRun(userId, input.runId);
    if (run.projectId !== input.projectId) throw new HttpError(400, "That research belongs to another project.");
    const found = run.items.find((i) => i.id === input.itemId);
    if (!found) throw new HttpError(404, "That item isn't in this research run.");
    item = found;
  } else if (input.url) {
    try {
      item = await previewLink(input.url);
    } catch (err) {
      // Some sites block automated previews; keep the link anyway rather than losing it.
      const u = new URL(input.url);
      item = {
        kind: "link",
        source: u.hostname.replace(/^www\./, ""),
        title: decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? u.hostname).replace(/[-_]+/g, " ").slice(0, 120) || u.hostname,
        url: input.url,
        publishedAt: null,
        creator: null,
        summary: `Preview unavailable (${err instanceof Error ? err.message : String(err)}). Open the link to view it.`,
        imageUrl: null,
        rights: `© ${u.hostname} / creator — reference only`,
      };
    }
  } else throw new HttpError(400, "Give a research item or a URL.");

  let fileId: string | null = null;
  let palette: string[] = [];
  if (item.imageUrl) {
    try {
      const raw = await fetchThumb(item.imageUrl);
      const valid = await validateUpload(raw, { allow: ["raster"], maxBytes: 12 * 1024 * 1024 });
      const small = await thumbnail(valid.buffer, 900);
      const meta = await (await import("sharp")).default(small).metadata();
      const saved = await saveFile(userId, small, { projectId: input.projectId, kind: "reference", originalName: `${item.title.replace(/[^\w-]+/g, "-").slice(0, 60)}.webp`, mime: "image/webp", width: meta.width ?? null, height: meta.height ?? null, meta: { referenceFrom: item.url, imageUrl: item.imageUrl, note: "Reference preview only — not licensed for use in artwork" } });
      fileId = saved.id;
      palette = (await colorProfile(small)).dominantColors;
    } catch (err) {
      logger.warn("reference.preview_failed", { url: item.imageUrl, error: String(err) });
    }
  }
  return await insertReference(userId, { projectId: input.projectId, kind: item.kind, source: item.source, title: item.title, url: item.url, publishedAt: item.publishedAt, creator: item.creator, summary: item.summary, rights: item.rights, fileId, palette, researchRunId: input.runId ?? null });
}

export async function startDirections(userId: string, input: { moodboardId: string; brief: string; count: number }) {
  const board = await getMoodboard(userId, input.moodboardId);
  if (board.items.length < 2) throw new HttpError(400, "Add at least two references to the moodboard first.");
  const project = await getProject(userId, board.projectId);
  return await startJob(userId, { type: "directions", projectId: project.id, steps: [{ key: "directions", label: "Creative Director proposing original directions" }] }, async (ctx) => {
    const records = await ctx.step("directions", async (detail) => {
      const maxImages = Math.min(8, (await engineLimits(userId)).maxImages);
      const refs = await Promise.all(
        board.items.map(async (it, idx) => {
          let image = null;
          if (it.ref.fileId && idx < maxImages) {
            try {
              const { buffer } = await readFile(userId, it.ref.fileId);
              const p = await prepareForVision(buffer, 512);
              image = { base64: p.base64, mediaType: p.mediaType };
            } catch {
              /* reference without preview */
            }
          }
          return { id: it.ref.id, title: it.ref.title, source: it.ref.source, note: it.note || it.ref.notes, palette: it.ref.palette, image };
        }),
      );
      const dirs = await proposeDirections({ userId, brief: input.brief || project.description, boardNotes: board.notes, refs, brandRules: brandRulesText(project.brandId ? await getBrand(userId, project.brandId) : null), count: input.count });
      detail(dirs.map((d) => d.name).join(" · "));
      return saveDirections(userId, { projectId: project.id, moodboardId: board.id, directions: dirs });
    });
    return { directionIds: records.map((r) => r.id) };
  });
}
