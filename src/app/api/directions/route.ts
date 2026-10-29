import type { NextRequest } from "next/server";
import { getDirection, getMoodboard, listDirections } from "@/lib/database/research-repo";
import { handle, json, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

/** ?projectId lists directions; ?id returns one with its moodboard's reference files (for "Use in Create"). */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const d = getDirection(user.id, IdParam.parse(id));
    const board = d.moodboardId ? getMoodboard(user.id, d.moodboardId) : null;
    const inspired = new Set(d.data.inspiredBy.map((x) => x.refId));
    const refFiles = (board?.items ?? []).filter((i) => i.ref.fileId && (inspired.size === 0 || inspired.has(i.ref.id))).map((i) => i.ref.fileId!);
    return json({ direction: d, referenceFileIds: refFiles.slice(0, 4) });
  }
  return json({ directions: listDirections(user.id, IdParam.parse(req.nextUrl.searchParams.get("projectId"))) });
});
