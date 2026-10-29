import type { NextRequest } from "next/server";
import { deleteProject, getBrand, getProject, listAssets, listCritiques, listDesigns, listFiles, updateProject } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { removeScopeDir, removeStoredPaths } from "@/lib/storage/storage";
import { IdParam, ProjectUpdate } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const project = getProject(user.id, id);
  return json({
    project,
    brand: project.brandId ? getBrand(user.id, project.brandId) : null,
    critiques: listCritiques(user.id, id).map(({ result, ...c }) => ({ ...c, findingCount: result?.findings.length ?? 0 })),
    designs: listDesigns(user.id, id),
    assets: listAssets(user.id, { projectId: id }),
    uploads: listFiles(user.id, { projectId: id, kind: "upload" }),
  });
});

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const body = await parseBody(req, ProjectUpdate);
  return json({ project: updateProject(user.id, id, body) });
});

/** Permanently deletes the project and its files. The UI asks for typed confirmation first. */
export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const paths = deleteProject(user.id, id);
  await removeStoredPaths(paths);
  await removeScopeDir(user.id, { projectId: id });
  return json({ deleted: true });
});
