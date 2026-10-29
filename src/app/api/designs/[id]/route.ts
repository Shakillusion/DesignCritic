import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteDesign, getBrand, getDesign, getProject, listAssets, listCritiques, listVersions, renameDesign } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { removeStoredPaths } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/designs/[id]">) => {
  const user = await requireUser();
  const design = await getDesign(user.id, IdParam.parse((await ctx.params).id));
  const project = await getProject(user.id, design.projectId);
  const versions = await listVersions(user.id, design.id);
  const versionIds = new Set(versions.map((v) => v.id));
  return json({
    design,
    project,
    brand: project.brandId ? await getBrand(user.id, project.brandId) : null,
    versions,
    assets: await listAssets(user.id, { projectId: project.id }),
    critiques: (await listCritiques(user.id, project.id))
      .filter((c) => c.designVersionId && versionIds.has(c.designVersionId))
      .map(({ result, ...c }) => ({ ...c, findingCount: result?.findings.length ?? 0 })),
  });
});

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/designs/[id]">) => {
  const user = await requireUser();
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(160) }));
  return json({ design: await renameDesign(user.id, IdParam.parse((await ctx.params).id), name) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/designs/[id]">) => {
  const user = await requireUser();
  await removeStoredPaths(await deleteDesign(user.id, IdParam.parse((await ctx.params).id)));
  return json({ deleted: true });
});
