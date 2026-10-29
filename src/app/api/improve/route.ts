import { listCritiques, listDesigns, listVersions } from "@/lib/database/repo";
import { handle, json, requireUser } from "@/lib/http";

/** Everything that can be improved: editable designs (with their latest critique) and critiqued uploads. */
export const GET = handle(async () => {
  const user = await requireUser();
  const critiques = await listCritiques(user.id);
  const designs = await Promise.all((await listDesigns(user.id)).map(async (d) => {
    const versions = await listVersions(user.id, d.id);
    const current = versions.find((v) => v.id === d.currentVersionId) ?? versions[0];
    const c = current?.critiqueId ? critiques.find((x) => x.id === current.critiqueId) : undefined;
    return {
      id: d.id,
      name: d.name,
      projectName: d.projectName,
      renderFileId: current?.renderFileId ?? null,
      currentNumber: current?.number ?? null,
      awaitingReview: versions.filter((v) => current && v.number > current.number).map((v) => ({ id: v.id, number: v.number, summary: v.changeSummary })),
      rebuilt: Boolean(d.sourceFileId),
      updatedAt: d.updatedAt,
      critique: c
        ? { id: c.id, status: c.status, score: c.overallScore, findings: c.result?.findings.length ?? 0, accepted: Object.values(c.decisions).filter((x) => x === "accepted").length }
        : null,
    };
  }));
  // Latest critique per uploaded file (critiques of design renders are covered above).
  const seen = new Set<string>();
  const uploads = critiques
    .filter((c) => !c.designVersionId && c.status === "succeeded")
    .filter((c) => (seen.has(c.fileId) ? false : (seen.add(c.fileId), true)))
    .map((c) => ({ critiqueId: c.id, fileId: c.fileId, title: c.title, projectName: c.projectName, score: c.overallScore, findings: c.result?.findings.length ?? 0, createdAt: c.createdAt }));
  return json({ designs, uploads });
});
