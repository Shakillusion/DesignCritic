import type { NextRequest } from "next/server";
import { deleteBrand, getBrand, listBrandChanges, listFiles, updateBrand } from "@/lib/database/repo";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { removeScopeDir, removeStoredPaths } from "@/lib/storage/storage";
import { BrandUpdate, IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/brands/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  return json({ brand: getBrand(user.id, id), files: listFiles(user.id, { brandId: id }), history: listBrandChanges(user.id, id) });
});

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/brands/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const { changeSummary, ...patch } = await parseBody(req, BrandUpdate);
  // File references must point at this brand's own files.
  const own = new Set(listFiles(user.id, { brandId: id }).map((f) => f.id));
  for (const key of ["logoFileIds", "referenceFileIds", "guidelineFileIds"] as const) {
    if (patch[key]?.some((f) => !own.has(f))) throw new HttpError(400, "A referenced file doesn't belong to this brand.");
  }
  return json({ brand: updateBrand(user.id, id, patch, changeSummary) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/brands/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  await removeStoredPaths(deleteBrand(user.id, id));
  await removeScopeDir(user.id, { brandId: id });
  return json({ deleted: true });
});
