import type { NextRequest } from "next/server";
import { deleteAsset, updateAsset } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { removeStoredPaths } from "@/lib/storage/storage";
import { AssetUpdate, IdParam } from "@/lib/validation/api";

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  const user = await requireUser();
  const body = await parseBody(req, AssetUpdate);
  return json({ asset: await updateAsset(user.id, IdParam.parse((await ctx.params).id), body) });
});

/** Only unused, unlocked assets can be removed (enforced in the repository). */
export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  const user = await requireUser();
  await removeStoredPaths(await deleteAsset(user.id, IdParam.parse((await ctx.params).id)));
  return json({ deleted: true });
});
