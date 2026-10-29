import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDesign, getVersion, setCurrentVersion, updateVersionMeta } from "@/lib/database/repo";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { restoreVersion, startDesignCritique } from "@/lib/services/design";
import { IdParam } from "@/lib/validation/api";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), approved: z.boolean() }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("view") }),
  z.object({ action: z.literal("critique") }),
]);

export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/designs/[id]/versions/[versionId]">) => {
  const user = await requireUser();
  const params = await ctx.params;
  const designId = IdParam.parse(params.id);
  // "current" resolves to the design's current version (used by the Improve hub).
  const versionId = params.versionId === "current" ? ((await getDesign(user.id, designId)).currentVersionId ?? "") : IdParam.parse(params.versionId);
  if (!versionId) throw new HttpError(409, "This design has no versions yet.");
  const v = await getVersion(user.id, versionId);
  if (v.designId !== designId) throw new HttpError(404, "Design version not found");
  const body = await parseBody(req, Action);
  switch (body.action) {
    case "approve":
      return json({ version: await updateVersionMeta(user.id, versionId, { approved: body.approved }) });
    case "restore":
      return json({ version: await restoreVersion(user.id, designId, versionId) }, { status: 201 });
    case "view":
      await setCurrentVersion(user.id, designId, versionId);
      return json({ ok: true });
    case "critique":
      return json({ job: await startDesignCritique(user.id, designId, versionId) }, { status: 202 });
  }
});
