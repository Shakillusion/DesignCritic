import type { NextRequest } from "next/server";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { saveUserVersion } from "@/lib/services/design";
import { IdParam, VersionSave } from "@/lib/validation/api";

/** Save editor changes as a new version (rendered and QA-checked). */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/designs/[id]/versions">) => {
  const user = await requireUser();
  const body = await parseBody(req, VersionSave);
  const version = await saveUserVersion(user.id, IdParam.parse((await ctx.params).id), body);
  return json({ version }, { status: 201 });
});
