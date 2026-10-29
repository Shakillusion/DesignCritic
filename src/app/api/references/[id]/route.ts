import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteReference, updateReferenceNotes } from "@/lib/database/research-repo";
import { getFileStoragePath } from "@/lib/database/repo";
import { getDb } from "@/lib/database/db";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { removeStoredPaths } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/references/[id]">) => {
  const user = await requireUser();
  const { notes } = await parseBody(req, z.object({ notes: z.string().max(2000) }));
  return json({ reference: await updateReferenceNotes(user.id, IdParam.parse((await ctx.params).id), notes) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/references/[id]">) => {
  const user = await requireUser();
  const fileId = await deleteReference(user.id, IdParam.parse((await ctx.params).id));
  if (fileId) {
    const { storagePath } = await getFileStoragePath(user.id, fileId);
    await getDb().prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(fileId, user.id);
    await removeStoredPaths([storagePath]);
  }
  return json({ deleted: true });
});
