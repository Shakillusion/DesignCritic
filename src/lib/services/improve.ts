import "server-only";
import sharp from "sharp";
import { pickFont, reconstructLayout } from "@/agents/reconstructor";
import { buildRebuiltDocument, shrinkOverflowingText, toPixels } from "@/lib/design-engine/rebuild";
import { withBrandStrictness } from "@/agents/brand-guardian";
import type { CreativeBrief } from "@/agents/creative-director";
import type { Finding } from "@/agents/design-critic/schema";
import { proposeFixes } from "@/agents/design-fixer";
import type { QaReport } from "@/agents/qa-inspector/types";
import { applyEditOps, type EditOp } from "@/lib/design-engine/edit-ops";
import type { DesignDocument } from "@/lib/design-engine/schema";
import { createDesign, getBrand, getCritique, getDesign, getPreferences, getProject, getVersion, insertAsset, listAssets } from "@/lib/database/repo";
import { prepareForVision } from "@/lib/image-processing/image";
import { HttpError } from "@/lib/http";
import { startJob, type JobContext } from "@/lib/jobs";
import { readFile, saveFile } from "@/lib/storage/storage";
import type { AppliedChange, Brand, DesignVersion } from "@/types/domain";
import { commitVersion, critiqueVersion, errorCount, renderAndInspect } from "./design";

/**
 * Phase 3: turn accepted findings (or a chat instruction) into a reviewable
 * new version. Bounded loop: plan → apply → render → QA → (one correction) →
 * commit → re-critique. The base version is never modified.
 */

interface EditRoundInput {
  userId: string;
  designId: string;
  base: DesignVersion;
  findings: Finding[];
  strengths: string[];
  instruction?: string;
  label: string;
}

export interface EditRoundResult extends Record<string, unknown> {
  designId: string;
  versionId: string;
  versionNumber: number;
  madeCurrent: boolean;
  applied: number;
  rejected: string[];
  notFixable: { findingId: string; why: string }[];
  qaErrorsBefore: number;
  qaErrorsAfter: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  regressed: boolean;
  critiqueId: string | null;
}

async function runEditRound(ctx: JobContext, input: EditRoundInput): Promise<EditRoundResult> {
  const { userId, base } = input;
  const design = getDesign(userId, input.designId);
  const project = getProject(userId, design.projectId);
  const prefs = getPreferences(userId);
  const brand: Brand | null = withBrandStrictness(project.brandId ? getBrand(userId, project.brandId) : null, prefs.brandStrictness);
  if (!base.renderFileId) throw new HttpError(409, "This version has no render yet.");
  const knownAssetIds = new Set(listAssets(userId, { projectId: project.id }).filter((a) => a.status !== "rejected").map((a) => a.id));
  const { buffer } = await readFile(userId, base.renderFileId);
  const render = await prepareForVision(buffer);

  const plan = await ctx.step("plan", async (detail) => {
    const p = await proposeFixes({ userId, doc: base.document, render, findings: input.findings, strengths: input.strengths, brand, instruction: input.instruction, qa: base.qa });
    detail(`${p.edits.length} edit(s) proposed${p.notFixable.length ? ` · ${p.notFixable.length} need more than layer edits` : ""} — ${p.summary}`);
    return p;
  });

  const outcome = await ctx.step("apply", async (detail) => {
    // Re-measure the base with the current inspector so the comparison is fair.
    const baseline = await renderAndInspect(userId, base.document, brand);
    const baseErrors = errorCount(baseline.qa);
    let state: GateState = { doc: base.document, png: baseline.png, qa: baseline.qa, applied: [], rejected: [] };

    detail(`Checking ${plan.edits.length} edit(s) one by one`);
    state = await gateEdits(userId, brand, state, plan.edits, knownAssetIds);

    // One bounded correction round, told exactly which edits failed and why.
    if (state.rejected.length) {
      detail(`Correction round: ${state.rejected.length} edit(s) were skipped`);
      const retryPlan = await proposeFixes({
        userId,
        doc: state.doc,
        render: await prepareForVision(state.png),
        findings: input.findings,
        strengths: input.strengths,
        brand,
        instruction: input.instruction,
        qa: state.qa,
        previousAttempt: { rejected: state.rejected.map((r) => r.reason), newQaErrors: [] },
      });
      const rejectedFirst = state.rejected;
      state = await gateEdits(userId, brand, { ...state, rejected: [] }, retryPlan.edits, knownAssetIds);
      state.rejected = [...rejectedFirst, ...state.rejected];
    }
    if (!state.applied.length) {
      const reasons = [...plan.notFixable.map((n) => `${n.findingId}: ${n.why}`), ...state.rejected.slice(0, 3).map((r) => r.reason)].join("; ");
      throw new Error(`No change could be applied without making the design worse.${reasons ? ` ${reasons}.` : ""} Try editing in the studio, or rebuild/replace the imagery.`);
    }
    detail(`${state.applied.length} change(s) kept${state.rejected.length ? `, ${state.rejected.length} dropped (they made measured quality worse)` : ""} · QA errors ${baseErrors} → ${errorCount(state.qa)}`);
    return { ...state, baseErrors };
  });

  const makeCurrent = !prefs.requireApproval;
  const fixedIds = [...new Set(outcome.applied.map((a) => a.findingId).filter(Boolean))];
  const summary = input.instruction ? `Assistant: ${input.instruction.slice(0, 140)}` : `${input.label}${fixedIds.length ? `: ${fixedIds.join(", ")}` : ""}`;
  const version = await commitVersion(userId, design.id, project.id, { ...outcome.doc, name: base.document.name }, outcome.png, outcome.qa, summary, "agent", base.id, { changes: outcome.applied, makeCurrent });

  const baseCritique = base.critiqueId ? getCritique(userId, base.critiqueId) : null;
  const critique = await ctx.step("critique", async (detail) => {
    try {
      const c = await critiqueVersion(userId, version, project.id, brand, (design.brief.creativeBrief as CreativeBrief | undefined) ?? null);
      detail(`Score ${baseCritique?.overallScore ?? "–"} → ${c.overall}`);
      return c;
    } catch (err) {
      detail(`Re-critique failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  return {
    designId: design.id,
    versionId: version.id,
    versionNumber: version.number,
    madeCurrent: makeCurrent,
    applied: outcome.applied.length,
    rejected: outcome.rejected.map((r) => r.reason),
    notFixable: plan.notFixable,
    qaErrorsBefore: outcome.baseErrors,
    qaErrorsAfter: errorCount(outcome.qa),
    scoreBefore: baseCritique?.overallScore ?? null,
    scoreAfter: critique?.overall ?? null,
    // AI scores vary by a few points between runs; a clear drop means the edits likely didn't help.
    regressed: baseCritique?.overallScore != null && critique?.overall != null && critique.overall < baseCritique.overallScore - 4,
    critiqueId: critique?.critiqueId ?? null,
  };
}

interface GateState {
  doc: DesignDocument;
  png: Buffer;
  qa: QaReport;
  applied: AppliedChange[];
  rejected: { reason: string }[];
}

/**
 * Apply edits one at a time, rendering and inspecting after each. An edit that
 * adds a measured QA error is dropped, so objective quality never gets worse.
 */
async function gateEdits(userId: string, brand: Brand | null, start: GateState, edits: EditOp[], knownAssetIds: Set<string>): Promise<GateState> {
  const state: GateState = { ...start, applied: [...start.applied], rejected: [...start.rejected] };
  for (const edit of edits) {
    const label = `${edit.op} ${"layerId" in edit ? edit.layerId : edit.layer.id}`;
    const r = applyEditOps(state.doc, [edit], { knownAssetIds });
    if (!r.applied.length) {
      state.rejected.push({ reason: `${label}: ${r.rejected[0]?.reason ?? "not applicable"}` });
      continue;
    }
    const next = await renderAndInspect(userId, r.doc, brand);
    const added = next.qa.issues.filter((i) => i.severity === "error" && !state.qa.issues.some((p) => p.severity === "error" && p.check === i.check && p.layerId === i.layerId));
    if (errorCount(next.qa) > errorCount(state.qa) || added.length) {
      state.rejected.push({ reason: `${label} introduced ${added.map((i) => `${i.check} on ${i.layerId}: ${i.message}`).join("; ") || "a new QA error"}` });
      continue;
    }
    state.doc = r.doc;
    state.png = next.png;
    state.qa = next.qa;
    state.applied.push(...r.applied);
  }
  return state;
}

/**
 * Rebuild a critiqued upload as an editable design. Photo regions are cut from
 * the user's own file (text baked into them is softened so the live text layer
 * reads cleanly); text, shapes and colours become editable layers.
 */
export function startRebuild(userId: string, critiqueId: string) {
  const critique = getCritique(userId, critiqueId);
  if (critique.designVersionId) throw new HttpError(409, "This critique is already of an editable design.");
  const project = getProject(userId, critique.projectId);
  const prefs = getPreferences(userId);
  const brand = withBrandStrictness(project.brandId ? getBrand(userId, project.brandId) : null, prefs.brandStrictness);
  return startJob(
    userId,
    {
      type: "rebuild",
      projectId: project.id,
      steps: [
        { key: "read", label: "Reading the layout, text and colours" },
        { key: "regions", label: "Cutting image regions from your original" },
        { key: "build", label: "Building editable layers and fitting text" },
      ],
    },
    async (ctx) => {
      const { file, buffer } = await readFile(userId, critique.fileId);
      const W = file.width ?? 0, H = file.height ?? 0;
      if (!W || !H) throw new Error("The original image has no dimensions.");
      const recon = await ctx.step("read", async (detail) => {
        const r = await reconstructLayout({ userId, image: await prepareForVision(buffer), width: W, height: H });
        detail(`${r.textBlocks.length} text block(s), ${r.imageRegions.length} image region(s), ${r.shapes.length} shape(s)`);
        return r;
      });

      const regions = await ctx.step("regions", async (detail) => {
        const out: { assetId: string; index: number }[] = [];
        for (const [index, region] of recon.imageRegions.entries()) {
          const p = toPixels(region, W, H);
          if (p.width < 8 || p.height < 8) continue;
          let crop = await sharp(buffer).rotate().extract({ left: p.x, top: p.y, width: p.width, height: p.height }).png().toBuffer();
          // Soften original text inside the crop where a live text layer will sit on top.
          for (const t of recon.textBlocks) {
            const tp = toPixels(t, W, H);
            const ix = Math.max(tp.x, p.x), iy = Math.max(tp.y, p.y);
            const iw = Math.min(tp.x + tp.width, p.x + p.width) - ix, ih = Math.min(tp.y + tp.height, p.y + p.height) - iy;
            if (iw < 4 || ih < 4) continue;
            const pad = Math.round(Math.min(iw, ih) * 0.15);
            const left = Math.max(0, ix - p.x - pad), top = Math.max(0, iy - p.y - pad);
            const w = Math.min(p.width - left, iw + pad * 2), h = Math.min(p.height - top, ih + pad * 2);
            const patch = await sharp(crop).extract({ left, top, width: w, height: h }).blur(Math.max(4, Math.min(40, h / 3))).toBuffer();
            crop = await sharp(crop).composite([{ input: patch, left, top }]).png().toBuffer();
          }
          const saved = await saveFile(userId, crop, { projectId: project.id, kind: "asset-original", originalName: `${file.originalName.replace(/\.[a-z0-9]+$/i, "")}-region-${index + 1}.png`, mime: "image/png", width: p.width, height: p.height, meta: { derivedFrom: file.id, region: p } });
          const asset = insertAsset(userId, {
            projectId: project.id,
            fileId: saved.id,
            type: "photo",
            source: "upload",
            provider: null,
            providerId: null,
            title: `${region.description.slice(0, 60) || "Region"} (from ${file.originalName})`,
            creator: null,
            creatorUrl: null,
            sourceUrl: null,
            license: { code: "user-provided", name: "Provided by you", url: null, commercialUse: null, modificationAllowed: null, attributionRequired: false, shareAlike: false, notes: "Cut from your uploaded design during a rebuild." },
            attribution: null,
            status: "approved",
            locked: false,
            analysis: {},
            retrievedAt: null,
          });
          out.push({ assetId: asset.id, index });
        }
        detail(`${out.length} region(s) saved to the Asset Library`);
        return out;
      });

      const result = await ctx.step("build", async (detail) => {
        let doc = buildRebuiltDocument(recon, { width: W, height: H }, regions, pickFont, `${critique.title} (editable)`);
        let { png, qa } = await renderAndInspect(userId, doc, brand);
        // Fit substitute fonts: shrink overflowing text a few times, measured each round.
        for (let round = 0; round < 3; round++) {
          const overflow = qa.issues
            .filter((i) => i.check === "text-overflow" && i.layerId)
            .map((i) => ({ layerId: i.layerId!, contentHeight: Number(i.measured?.contentHeight ?? 0), boxHeight: Number(i.measured?.boxHeight ?? 0), contentWidth: Number(i.measured?.contentWidth ?? 0), boxWidth: Number(i.measured?.boxWidth ?? 0) }));
          const next = shrinkOverflowingText(doc, overflow);
          if (!next) break;
          doc = next;
          ({ png, qa } = await renderAndInspect(userId, doc, brand));
        }
        const design = createDesign(userId, { projectId: project.id, name: doc.name, brief: { rebuiltFrom: file.id, critiqueId: critique.id, notes: recon.notes }, sourceFileId: file.id });
        const version = await commitVersion(userId, design.id, project.id, doc, png, qa, "Rebuilt from your upload", "agent", null);
        detail(`${doc.layers.length} editable layers · QA errors ${errorCount(qa)}${recon.notes ? ` · ${recon.notes.slice(0, 120)}` : ""}`);
        return { designId: design.id, versionId: version.id };
      });
      return result;
    },
  );
}

const EDIT_STEPS = [
  { key: "plan", label: "Design Fixer planning targeted edits" },
  { key: "apply", label: "Applying edits, rendering and running QA" },
  { key: "critique", label: "Senior Critic reviewing the new version" },
];

/** Apply a design critique's accepted findings (or all non-rejected ones) as a new version. */
export function startApplyFixes(userId: string, critiqueId: string) {
  const critique = getCritique(userId, critiqueId);
  if (!critique.designVersionId) throw new HttpError(409, "This critique is of an uploaded image. Rebuild it as an editable design first.");
  if (critique.status !== "succeeded" || !critique.result) throw new HttpError(409, "The critique hasn't finished yet.");
  const base = getVersion(userId, critique.designVersionId);
  const accepted = critique.result.findings.filter((f) => critique.decisions[f.id] === "accepted");
  const findings = accepted.length ? accepted : critique.result.findings.filter((f) => critique.decisions[f.id] !== "rejected");
  if (!findings.length) throw new HttpError(400, "Accept at least one finding (or leave some unrejected) to apply fixes.");
  const strengths = critique.result.strengths.map((s) => `${s.title}: ${s.description}`);
  return startJob(userId, { type: "apply-fixes", projectId: critique.projectId, steps: EDIT_STEPS }, (ctx) =>
    runEditRound(ctx, { userId, designId: base.designId, base, findings, strengths, label: "Applied critique fixes" }),
  );
}

/** Free-form change request (from the assistant) as a new version. */
export function startInstructionEdit(userId: string, input: { designId: string; versionId?: string | null; instruction: string }, onDone?: (r: EditRoundResult | null, err?: unknown) => void) {
  const design = getDesign(userId, input.designId);
  const versionId = input.versionId ?? design.currentVersionId;
  if (!versionId) throw new HttpError(409, "This design has no versions yet.");
  const base = getVersion(userId, versionId);
  if (base.designId !== design.id) throw new HttpError(400, "That version belongs to another design.");
  const baseCritique = base.critiqueId ? getCritique(userId, base.critiqueId) : null;
  const strengths = baseCritique?.result?.strengths.map((s) => `${s.title}: ${s.description}`) ?? [];
  return startJob(userId, { type: "apply-fixes", projectId: design.projectId, steps: EDIT_STEPS }, async (ctx) => {
    try {
      const r = await runEditRound(ctx, { userId, designId: design.id, base, findings: [], strengths, instruction: input.instruction, label: "Assistant edit" });
      onDone?.(r);
      return r;
    } catch (err) {
      onDone?.(null, err);
      throw err;
    }
  });
}
