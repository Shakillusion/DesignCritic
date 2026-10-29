import "server-only";
import { critiqueImage, planImprovements } from "@/agents/design-critic";
import { withBrandStrictness } from "@/agents/brand-guardian";
import { engineLabel } from "@/lib/ai/client";
import { createCritique, getBrand, getCritique, getPreferences, getProject, updateCritique } from "@/lib/database/repo";
import { startJob } from "@/lib/jobs";
import { readFile } from "@/lib/storage/storage";
import { prepareForVision, technicalFacts } from "@/lib/image-processing/image";
import { HttpError } from "@/lib/http";
import type { CritiqueContext } from "@/types/domain";
import type { QaReport } from "@/agents/qa-inspector/types";

/** Queue a critique of a stored image. Returns immediately with the critique + job ids. */
export async function startCritique(
  userId: string,
  input: { projectId: string; fileId: string; title?: string; context: CritiqueContext; designVersionId?: string | null; qa?: QaReport | null },
) {
  const project = await getProject(userId, input.projectId);
  const { file, buffer } = await readFile(userId, input.fileId);
  if (file.projectId !== project.id) throw new HttpError(400, "That file belongs to a different project.");
  if (!file.mime.startsWith("image/")) throw new HttpError(400, "Only images can be critiqued.");

  const prefs = await getPreferences(userId);
  const model = await engineLabel(userId);
  const technical = await technicalFacts(buffer);
  const critique = await createCritique(userId, {
    projectId: project.id,
    fileId: file.id,
    brandId: project.brandId,
    designVersionId: input.designVersionId ?? null,
    title: input.title || file.originalName.replace(/\.[a-z0-9]+$/i, ""),
    model,
    context: input.context,
    technical,
  });

  const job = await startJob(
    userId,
    {
      type: input.designVersionId ? "design-critique" : "critique",
      projectId: project.id,
      steps: [
        { key: "prepare", label: "Measuring the file" },
        { key: "critique", label: "Senior Design Critic reviewing" },
        { key: "save", label: "Saving the report" },
      ],
    },
    async (ctx) => {
      await updateCritique(userId, critique.id, { status: "running" });
      try {
        const image = await ctx.step("prepare", async (detail) => {
          const img = await prepareForVision(buffer);
          detail(`${technical.width}×${technical.height} ${technical.format.toUpperCase()}`);
          return img;
        });
        const brand = withBrandStrictness(project.brandId ? await getBrand(userId, project.brandId) : null, prefs.brandStrictness);
        const { result, overall } = await ctx.step("critique", async (detail) => {
          detail(`${model}${brand ? ` · brand: ${brand.name}` : ""}`);
          return critiqueImage({
            userId,
            image,
            technical,
            context: input.context,
            brand,
            strictness: prefs.critiqueStrictness,
            qa: input.qa,
            onMeta: (m) => void updateCritique(userId, critique.id, { model: `${m.provider}/${m.model}` }),
          });
        });
        await ctx.step("save", async () => {
          await updateCritique(userId, critique.id, {
            status: "succeeded",
            result,
            overallScore: overall,
            decisions: Object.fromEntries(result.findings.map((f) => [f.id, "pending" as const])),
            completedAt: new Date().toISOString(),
          });
        });
        return { critiqueId: critique.id, overall };
      } catch (err) {
        await updateCritique(userId, critique.id, { status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date().toISOString() });
        throw err;
      }
    },
  );
  return { critique, job };
}

/** Build an improvement plan from the findings the user accepted (or all non-rejected ones). */
export async function startImprovementPlan(userId: string, critiqueId: string) {
  const critique = await getCritique(userId, critiqueId);
  if (critique.status !== "succeeded" || !critique.result) throw new HttpError(409, "The critique hasn't finished yet.");
  const result = critique.result;
  const accepted = result.findings.filter((f) => critique.decisions[f.id] === "accepted");
  const findings = accepted.length ? accepted : result.findings.filter((f) => critique.decisions[f.id] !== "rejected");
  if (!findings.length) throw new HttpError(400, "Accept at least one finding (or leave some unrejected) to build a plan.");
  return await startJob(
    userId,
    { type: "improvement-plan", projectId: critique.projectId, steps: [{ key: "plan", label: "Creative Director drafting the correction plan" }] },
    async (ctx) => {
      const plan = await ctx.step("plan", async () => {
        const { buffer } = await readFile(userId, critique.fileId);
        const image = await prepareForVision(buffer);
        return planImprovements({ userId, image, critique: result, findings, editable: Boolean(critique.designVersionId) });
      });
      await updateCritique(userId, critique.id, { improvementPlan: plan });
      return { critiqueId: critique.id };
    },
  );
}
