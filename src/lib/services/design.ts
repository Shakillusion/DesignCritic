import { env } from "@/lib/env";
import "server-only";
import sharp from "sharp";
import { analyzeOwnAsset, sourceAsset } from "@/agents/asset-agent";
import { brandForQa, withBrandStrictness } from "@/agents/brand-guardian";
import { interpretBrief, type CreativeBrief } from "@/agents/creative-director";
import { critiqueImage } from "@/agents/design-critic";
import { buildDesign, reviseDesign, type BuildInput } from "@/agents/design-builder";
import { inspectDesign } from "@/agents/qa-inspector";
import type { QaReport } from "@/agents/qa-inspector/types";
import { engineLabel, engineLimits } from "@/lib/ai/client";
import {
  addDesignVersion,
  createCritique,
  createDesign,
  getAsset,
  getBrand,
  getDesign,
  getPreferences,
  getProject,
  getVersion,
  updateCritique,
  updateVersionMeta,
} from "@/lib/database/repo";
import { describeDocument } from "@/lib/design-engine/edit-ops";
import { renderDesignHtml, type ResolvedAsset } from "@/lib/design-engine/render-html";
import { renderToPdf, renderToPng } from "@/lib/design-engine/renderer";
import { assetIdsInDocument, DesignDocument, FORMAT_PRESETS, normalizeDocument, type DesignDocument as Doc } from "@/lib/design-engine/schema";
import { prepareForVision, technicalFacts } from "@/lib/image-processing/image";
import { HttpError } from "@/lib/http";
import { startJob } from "@/lib/jobs";
import { logger } from "@/lib/logger";
import { readFile, saveFile } from "@/lib/storage/storage";
import type { AppliedChange, Brand, DesignVersion } from "@/types/domain";
import type { z } from "zod";
import type { DesignGenerate } from "@/lib/validation/api";

/* ── Rendering helpers ─────────────────────────────────── */

/** Inline every referenced asset as a data URI so server renders never fetch over the network. */
export async function buildResolver(userId: string, doc: Doc): Promise<(id: string) => ResolvedAsset | null> {
  const map = new Map<string, ResolvedAsset>();
  for (const id of assetIdsInDocument(doc)) {
    try {
      const a = await getAsset(userId, id);
      const fileId = a.preparedFileId ?? a.fileId;
      const { file, buffer } = await readFile(userId, fileId);
      map.set(id, { src: `data:${file.mime};base64,${buffer.toString("base64")}`, width: file.width, height: file.height });
    } catch {
      /* missing asset: the renderer draws a placeholder and QA reports it */
    }
  }
  return (id) => map.get(id) ?? null;
}

export async function renderAndInspect(userId: string, doc: Doc, brand: Brand | null): Promise<{ png: Buffer; qa: QaReport }> {
  const resolveAsset = await buildResolver(userId, doc);
  const html = renderDesignHtml(doc, { resolveAsset, mode: "export" });
  const size = { width: doc.artboard.width, height: doc.artboard.height };
  const png = await renderToPng(html, size);
  const qa = await inspectDesign(doc, { resolveAsset, brand: brandForQa(brand), expected: size });
  return { png, qa };
}

export const errorCount = (qa: QaReport) => qa.issues.filter((i) => i.severity === "error").length;

/** Persist a new version with its render and QA. */
export async function commitVersion(
  userId: string,
  designId: string,
  projectId: string,
  doc: Doc,
  png: Buffer,
  qa: QaReport,
  summary: string,
  createdBy: "agent" | "user",
  parentVersionId?: string | null,
  extra: { changes?: AppliedChange[]; makeCurrent?: boolean } = {},
): Promise<DesignVersion> {
  const version = await addDesignVersion(userId, designId, { document: doc, changeSummary: summary, createdBy, parentVersionId, assetIds: assetIdsInDocument(doc), ...extra });
  const render = await saveFile(userId, png, { projectId, kind: "render", originalName: `${doc.name.replace(/[^\w-]+/g, "-").slice(0, 60)}-v${version.number}.png`, mime: "image/png", width: doc.artboard.width, height: doc.artboard.height, meta: { designId, versionId: version.id } });
  return await updateVersionMeta(userId, version.id, { renderFileId: render.id, qa });
}

/** Run the Design Critic on a rendered version and link the critique to it. */
export async function critiqueVersion(userId: string, version: DesignVersion, projectId: string, brand: Brand | null, brief: CreativeBrief | null) {
  const { buffer } = await readFile(userId, version.renderFileId!);
  const technical = await technicalFacts(buffer);
  const model = await engineLabel(userId);
  const context = brief ? { purpose: brief.objective, audience: brief.audience, medium: version.document.format.kind, creativeIntent: brief.concepts[0]?.idea } : {};
  const critique = await createCritique(userId, { projectId, fileId: version.renderFileId!, designVersionId: version.id, brandId: brand?.id ?? null, title: `${version.document.name} · v${version.number}`, model, context, technical });
  await updateCritique(userId, critique.id, { status: "running" });
  try {
    const { result, overall } = await critiqueImage({ userId, image: await prepareForVision(buffer), technical, context, brand, strictness: (await getPreferences(userId)).critiqueStrictness, qa: version.qa, documentFacts: describeDocument(version.document), onMeta: (m) => void updateCritique(userId, critique.id, { model: `${m.provider}/${m.model}` }) });
    await updateCritique(userId, critique.id, { status: "succeeded", result, overallScore: overall, decisions: Object.fromEntries(result.findings.map((f) => [f.id, "pending" as const])), completedAt: new Date().toISOString() });
    await updateVersionMeta(userId, version.id, { critiqueId: critique.id });
    return { critiqueId: critique.id, overall };
  } catch (err) {
    await updateCritique(userId, critique.id, { status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date().toISOString() });
    throw err;
  }
}

/* ── Create: brief → assets → build → render → QA loop → critique ── */

export async function startGenerateDesign(userId: string, input: z.infer<typeof DesignGenerate>) {
  const project = await getProject(userId, input.projectId);
  const brand = withBrandStrictness(project.brandId ? await getBrand(userId, project.brandId) : null, (await getPreferences(userId)).brandStrictness);
  const prefs = await getPreferences(userId);
  const preset = FORMAT_PRESETS[input.preset];
  const size = input.customSize ?? (preset ? { width: preset.width, height: preset.height } : null);
  if (!size) throw new HttpError(400, "Choose a format preset or enter a custom size.");
  const kind = preset?.kind ?? "other";
  // Print metadata: bleed and safe margin are stored in px at the output dpi (QA converts to artboard px).
  const print = preset?.print
    ? {
        dpi: preset.print.dpi,
        bleed: Math.round((preset.print.bleedMm / 25.4) * preset.print.dpi),
        safeMargin: Math.round((5 / 25.4) * preset.print.dpi),
        trimWidthMm: preset.print.trimWidthMm,
        trimHeightMm: preset.print.trimHeightMm,
      }
    : null;
  const ownAssets = input.assetMode === "uploaded" ? await Promise.all(input.uploadedAssetIds.map((id) => getAsset(userId, id))) : [];
  if (input.assetMode === "uploaded") {
    if (!ownAssets.length) throw new HttpError(400, "Choose at least one of your uploaded images, or switch to automatic sourcing.");
    if (ownAssets.some((a) => a.projectId !== project.id)) throw new HttpError(400, "An uploaded image belongs to a different project.");
  }

  const n = input.variations;
  // Hosted on Vercel, one correction round keeps generation inside the 300 s function limit.
  const qaRounds = env.onVercel ? Math.min(prefs.qaMaxIterations, 1) : prefs.qaMaxIterations;
  const steps = [
    { key: "brief", label: "Creative Director interpreting the brief" },
    ...Array.from({ length: n }, (_, i) => [
      { key: `asset-${i}`, label: n > 1 ? `Concept ${i + 1}: sourcing photography` : "Asset Agent sourcing licensed photography" },
      { key: `build-${i}`, label: n > 1 ? `Concept ${i + 1}: building the layout` : "Design Builder composing the layout" },
      { key: `qa-${i}`, label: n > 1 ? `Concept ${i + 1}: render + QA inspection` : "Rendering and running QA checks" },
      { key: `critique-${i}`, label: n > 1 ? `Concept ${i + 1}: design critique` : "Senior Design Critic reviewing the result" },
    ]).flat(),
  ];

  return await startJob(userId, { type: "create-design", projectId: project.id, steps }, async (ctx) => {
    const references: Awaited<ReturnType<typeof prepareForVision>>[] = [];
    // Style references count against the provider's per-request image limit.
    for (const fid of input.referenceFileIds.slice(0, (await engineLimits(userId)).maxImages)) {
      const { file, buffer } = await readFile(userId, fid);
      if (file.projectId !== project.id) continue;
      references.push(await prepareForVision(buffer, 1024));
    }
    const brief = await ctx.step("brief", async (detail) => {
      const b = await interpretBrief({
        userId,
        brand,
        references,
        preferredStyles: prefs.preferredStyles,
        input: {
          brief: input.brief,
          headline: input.headline,
          supportingCopy: input.supportingCopy,
          cta: input.cta,
          audience: input.audience,
          style: input.style,
          creativeFreedom: input.creativeFreedom ?? prefs.creativityLevel,
          variations: n,
          format: { label: preset?.label ?? `Custom ${size.width}×${size.height}`, width: size.width, height: size.height, kind },
          useImagery: input.assetMode === "automatic",
        },
      });
      detail(`${b.concepts.map((c) => c.name).join(" · ")}`);
      return b;
    });

    const designs: { designId: string; versionId: string; critiqueId?: string; score?: number; qaErrors: number }[] = [];
    for (let i = 0; i < brief.concepts.length; i++) {
      // Under a platform time limit, finish the concepts already made rather than lose them all.
      if (i > 0 && ctx.timeLeft() < 150_000) {
        for (let j = i; j < brief.concepts.length; j++) {
          for (const k of ["asset", "build", "qa", "critique"]) ctx.skip(`${k}-${j}`, "Skipped to stay within the server time limit. Ask the assistant for more variations.");
        }
        break;
      }
      const concept = brief.concepts[i];
      let asset = await ctx.step(`asset-${i}`, async (detail) => {
        if (input.assetMode === "uploaded") {
          const own = ownAssets[i % ownAssets.length];
          detail(`Using your image “${own.title}”`);
          const { buffer } = await readFile(userId, own.preparedFileId ?? own.fileId);
          return analyzeOwnAsset({ userId, asset: own, image: buffer });
        }
        const r = await sourceAsset({ userId, projectId: project.id, need: { query: concept.imageQuery, purpose: `${concept.imageDirection} (${concept.composition})`, orientation: concept.imageOrientation, textZone: concept.textZone }, artboard: size, brandImagery: brand?.photographyStyle, log: detail });
        detail(`“${r.asset.title}” · ${r.asset.provider} · ${r.asset.license.name} — ${r.reason}`);
        return r.asset;
      });
      asset = await getAsset(userId, asset.id);
      const { buffer: assetBuf } = await readFile(userId, asset.preparedFileId ?? asset.fileId);
      const buildInput: BuildInput = { brief, conceptIndex: i, artboard: { width: size.width, height: size.height, kind, preset: input.preset || "custom", print }, asset, assetPreview: await prepareForVision(assetBuf, 1024), brand };

      let doc = await ctx.step(`build-${i}`, async (detail) => {
        const d = await buildDesign({ userId, input: buildInput });
        detail(`${d.layers.length} editable layers · ${d.metadata.fontsUsed.join(", ")}`);
        return d;
      });

      // Bounded improvement loop: render → inspect → correct → render again.
      const { png, qa } = await ctx.step(`qa-${i}`, async (detail) => {
        let best = { doc, ...(await renderAndInspect(userId, doc, brand)) };
        for (let round = 1; round <= qaRounds && errorCount(best.qa) > 0 && ctx.timeLeft() > 90_000; round++) {
          detail(`Round ${round}: fixing ${errorCount(best.qa)} measured error(s)`);
          const render = await prepareForVision(best.png);
          try {
            const revised = await reviseDesign({ userId, doc: best.doc, qa: best.qa, render, input: buildInput });
            const next = { doc: revised, ...(await renderAndInspect(userId, revised, brand)) };
            if (errorCount(next.qa) <= errorCount(best.qa)) best = next; // never accept a regression
          } catch (err) {
            logger.warn("design.revise_failed", { error: String(err) });
            break;
          }
        }
        doc = best.doc;
        const e = errorCount(best.qa);
        const w = best.qa.issues.filter((x) => x.severity === "warning").length;
        detail(e ? `${e} error(s) remain after ${qaRounds} correction round(s) · ${w} warning(s)` : `All objective checks passed · ${w} warning(s)`);
        return best;
      });

      const design = await createDesign(userId, { projectId: project.id, name: `${brief.title}${brief.concepts.length > 1 ? ` — ${concept.name}` : ""}`, brief: { request: input.brief, creativeBrief: brief, conceptIndex: i, preset: input.preset, assetMode: input.assetMode } });
      const version = await commitVersion(userId, design.id, project.id, { ...doc, name: design.name }, png, qa, `Generated from brief: concept “${concept.name}”`, "agent", null);
      const entry: (typeof designs)[number] = { designId: design.id, versionId: version.id, qaErrors: errorCount(qa) };
      designs.push(entry);

      if (ctx.timeLeft() < 75_000) {
        ctx.skip(`critique-${i}`, "Skipped to stay within the server time limit. Run Critique from the studio.");
        continue;
      }
      await ctx.step(`critique-${i}`, async (detail) => {
        try {
          const c = await critiqueVersion(userId, version, project.id, brand, brief);
          entry.critiqueId = c.critiqueId;
          entry.score = c.overall;
          detail(`Score ${c.overall}/100`);
        } catch (err) {
          // The design itself is saved; a failed critique shouldn't discard it.
          detail(`Critique failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }
    return { designs, brief };
  });
}

/* ── Editing: every save is a new, reviewable version ── */

/** Key-order-independent JSON, so equal layers compare equal however they were built. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function saveUserVersion(userId: string, designId: string, input: { document: unknown; changeSummary: string; baseVersionId: string }): Promise<DesignVersion> {
  const design = await getDesign(userId, designId);
  const base = await getVersion(userId, input.baseVersionId);
  if (base.designId !== design.id) throw new HttpError(400, "That version belongs to another design.");
  const parsed = DesignDocument.safeParse(input.document);
  if (!parsed.success) throw new HttpError(400, `The design document is invalid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const doc = normalizeDocument(parsed.data);

  // Locked layers and artboard size can't change through the editor.
  if (doc.artboard.width !== base.document.artboard.width || doc.artboard.height !== base.document.artboard.height) {
    throw new HttpError(409, "The artboard size can't be changed on an existing design.");
  }
  const baseNormalized = normalizeDocument(base.document);
  for (const l of baseNormalized.layers.filter((x) => x.locked)) {
    const now = doc.layers.find((x) => x.id === l.id);
    if (!now) throw new HttpError(409, `Layer “${l.name}” is locked and can’t be deleted. Unlock and save first.`);
    if (now.locked && canonical(now) !== canonical(l)) throw new HttpError(409, `Layer “${l.name}” is locked and can’t be changed.`);
  }
  for (const id of assetIdsInDocument(doc)) {
    const a = await getAsset(userId, id);
    if (a.projectId !== design.projectId) throw new HttpError(400, "An image layer references an asset from another project.");
    if (a.status === "rejected") throw new HttpError(400, `“${a.title}” was rejected in the Asset Library and can’t be used.`);
  }
  const project = await getProject(userId, design.projectId);
  const brand = withBrandStrictness(project.brandId ? await getBrand(userId, project.brandId) : null, (await getPreferences(userId)).brandStrictness);
  const { png, qa } = await renderAndInspect(userId, doc, brand);
  return commitVersion(userId, design.id, design.projectId, doc, png, qa, input.changeSummary, "user", base.id);
}

/** Restore = a new version that copies an old one; history is never rewritten. */
export async function restoreVersion(userId: string, designId: string, versionId: string): Promise<DesignVersion> {
  const v = await getVersion(userId, versionId);
  if (v.designId !== designId) throw new HttpError(400, "That version belongs to another design.");
  const design = await getDesign(userId, designId);
  const project = await getProject(userId, design.projectId);
  const brand = withBrandStrictness(project.brandId ? await getBrand(userId, project.brandId) : null, (await getPreferences(userId)).brandStrictness);
  const { png, qa } = await renderAndInspect(userId, v.document, brand);
  return commitVersion(userId, designId, design.projectId, v.document, png, qa, `Restored version ${v.number}`, "user", v.id);
}

export async function startDesignCritique(userId: string, designId: string, versionId: string) {
  const design = await getDesign(userId, designId);
  const version = await getVersion(userId, versionId);
  if (version.designId !== design.id || !version.renderFileId) throw new HttpError(400, "That version has no render to critique.");
  const project = await getProject(userId, design.projectId);
  const brand = withBrandStrictness(project.brandId ? await getBrand(userId, project.brandId) : null, (await getPreferences(userId)).brandStrictness);
  const brief = (design.brief.creativeBrief as CreativeBrief | undefined) ?? null;
  return await startJob(userId, { type: "design-critique", projectId: project.id, steps: [{ key: "critique", label: "Senior Design Critic reviewing this version" }] }, async (ctx) => {
    const r = await ctx.step("critique", () => critiqueVersion(userId, version, project.id, brand, brief));
    return r;
  });
}

/* ── Export ── */

export async function exportDesign(userId: string, versionId: string, format: "png" | "jpg" | "pdf" | "html", scale: number): Promise<{ body: Buffer | string; type: string; ext: string }> {
  const v = await getVersion(userId, versionId);
  const doc = v.document;
  const resolveAsset = await buildResolver(userId, doc);
  const html = renderDesignHtml(doc, { resolveAsset, mode: "export" });
  const { width, height } = doc.artboard;
  if (format === "html") return { body: html, type: "text/html; charset=utf-8", ext: "html" };
  if (format === "pdf") return { body: await renderToPdf(html, { width, height }), type: "application/pdf", ext: "pdf" };
  const safeScale = Math.max(1, Math.min(scale, Math.floor(8000 / Math.max(width, height)) || 1, 4));
  const png = await renderToPng(html, { width, height, scale: safeScale });
  if (format === "jpg") return { body: await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer(), type: "image/jpeg", ext: "jpg" };
  return { body: png, type: "image/png", ext: "png" };
}
