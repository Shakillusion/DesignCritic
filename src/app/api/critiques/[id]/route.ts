import type { NextRequest } from "next/server";
import { deleteCritique, getBrand, getCritique, getFile, getProject, getVersion, updateCritique } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { CritiqueUpdate, IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/critiques/[id]">) => {
  const user = await requireUser();
  const critique = getCritique(user.id, IdParam.parse((await ctx.params).id));
  const project = getProject(user.id, critique.projectId);
  return json({
    critique,
    designId: critique.designVersionId ? getVersion(user.id, critique.designVersionId).designId : null,
    file: getFile(user.id, critique.fileId),
    project,
    brand: critique.brandId ? getBrand(user.id, critique.brandId) : null,
  });
});

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/critiques/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const body = await parseBody(req, CritiqueUpdate);
  const current = getCritique(user.id, id);
  const known = new Set(current.result?.findings.map((f) => f.id) ?? []);
  const decisions = body.decisions
    ? { ...current.decisions, ...Object.fromEntries(Object.entries(body.decisions).filter(([k]) => known.has(k))) }
    : undefined;
  return json({ critique: updateCritique(user.id, id, { title: body.title, decisions }) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/critiques/[id]">) => {
  const user = await requireUser();
  deleteCritique(user.id, IdParam.parse((await ctx.params).id));
  return json({ deleted: true });
});
