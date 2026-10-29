import "server-only";
import { assistantTurn, type AssistantTurn } from "@/agents/assistant";
import { brandRulesText } from "@/agents/brand-guardian";
import { describeDocument } from "@/lib/design-engine/edit-ops";
import { FORMAT_PRESETS } from "@/lib/design-engine/schema";
import { addChatMessage, getBrand, getCritique, getDesign, getProject, getVersion, listChatMessages } from "@/lib/database/repo";
import { listResearchRuns } from "@/lib/database/research-repo";
import { prepareForVision } from "@/lib/image-processing/image";
import { readFile } from "@/lib/storage/storage";
import { logger } from "@/lib/logger";
import type { ChatMessage } from "@/types/domain";
import { startDesignCritique, startGenerateDesign } from "./design";
import { startApplyFixes, startInstructionEdit } from "./improve";

/** One chat turn: store the user's message, ask the assistant, run its (whitelisted) action, store the reply. */
export async function handleChatMessage(userId: string, input: { projectId: string; designId: string | null; message: string }): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  const project = await getProject(userId, input.projectId);
  const design = input.designId ? await getDesign(userId, input.designId) : null;
  if (design && design.projectId !== project.id) throw new Error("That design belongs to another project.");
  const history = (await listChatMessages(userId, project.id, design?.id ?? null, 16)).map((m) => ({ role: m.role, content: m.content }));
  const userMsg = await addChatMessage(userId, { projectId: project.id, designId: design?.id ?? null, role: "user", content: input.message });

  const version = design?.currentVersionId ? await getVersion(userId, design.currentVersionId) : null;
  const critique = version?.critiqueId ? await getCritique(userId, version.critiqueId) : null;
  let render: { base64: string; mediaType: "image/png" | "image/jpeg" } | null = null;
  if (version?.renderFileId) {
    const { buffer } = await readFile(userId, version.renderFileId);
    render = await prepareForVision(buffer, 1024);
  }
  const allowed: AssistantTurn["action"]["type"][] = ["none"];
  if (design && version) allowed.push("edit", "critique", "variations");
  if (critique?.status === "succeeded") allowed.push("apply_fixes");

  const turn = await assistantTurn({
    userId,
    message: input.message,
    context: {
      projectName: project.name,
      projectDescription: project.description,
      brandRules: brandRulesText(project.brandId ? await getBrand(userId, project.brandId) : null),
      design: design && version ? { name: design.name, versionNumber: version.number, layers: describeDocument(version.document), render } : null,
      critique: critique?.result
        ? { score: critique.overallScore, summary: critique.result.summary, findings: critique.result.findings.map((f) => `- ${f.id} [${f.severity}, ${critique.decisions[f.id] ?? "pending"}] ${f.title}`) }
        : null,
      history,
      allowedActions: allowed,
      research: await (async () => {
        const run = (await listResearchRuns(userId, project.id))[0];
        if (!run?.brief) return null;
        const byId = new Map(run.items.map((i) => [i.id, i]));
        const insights = run.brief.insights.map((i) => `- [${i.category}] ${i.title} — sources: ${i.citations.map((c) => byId.get(c)?.url).filter(Boolean).join(", ")}`);
        return [`Latest research on “${run.query.topic}” (${run.createdAt.slice(0, 10)}): ${run.brief.summary}`, ...insights].join("\n");
      })(),
    },
  });

  let action: ChatMessage["action"] = null;
  try {
    const a = turn.action;
    if (a.type === "edit" && design && version) {
      const job = await startInstructionEdit(userId, { designId: design.id, versionId: version.id, instruction: a.instruction! });
      action = { type: "edit", jobId: job.id, detail: a.instruction! };
    } else if (a.type === "critique" && design && version) {
      action = { type: "critique", jobId: (await startDesignCritique(userId, design.id, version.id)).id };
    } else if (a.type === "apply_fixes" && critique) {
      action = { type: "apply_fixes", jobId: (await startApplyFixes(userId, critique.id)).id };
    } else if (a.type === "variations" && design && version) {
      const brief = design.brief as { request?: string; preset?: string };
      const preset = brief.preset && FORMAT_PRESETS[brief.preset] ? brief.preset : "custom";
      const job = await startGenerateDesign(userId, {
        projectId: project.id,
        brief: `${brief.request ?? design.name}. Direction for these variations: ${a.instruction ?? "explore distinctly different layouts"}`,
        preset,
        customSize: preset === "custom" ? { width: version.document.artboard.width, height: version.document.artboard.height } : null,
        variations: Math.min(3, Math.max(1, Math.round(a.count ?? 2))),
        assetMode: "automatic",
        uploadedAssetIds: [],
        referenceFileIds: [],
      });
      action = { type: "variations", jobId: job.id, detail: a.instruction ?? undefined };
    }
  } catch (err) {
    // The reply still goes out; the failure is shown on the message instead of being swallowed.
    logger.warn("assistant.action_failed", { error: String(err) });
    action = { type: turn.action.type, status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
  const assistant = await addChatMessage(userId, { projectId: project.id, designId: design?.id ?? null, role: "assistant", content: turn.reply, action });
  return { user: userMsg, assistant };
}
