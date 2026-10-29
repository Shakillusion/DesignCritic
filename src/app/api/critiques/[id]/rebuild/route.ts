import type { NextRequest } from "next/server";
import { handle, json, requireUser } from "@/lib/http";
import { startRebuild } from "@/lib/services/improve";
import { IdParam } from "@/lib/validation/api";

/** Rebuild the critiqued upload as an editable design (a new design; the upload is untouched). */
export const POST = handle(async (_req: NextRequest, ctx: RouteContext<"/api/critiques/[id]/rebuild">) => {
  const user = await requireUser();
  const job = await startRebuild(user.id, IdParam.parse((await ctx.params).id));
  return json({ job }, { status: 202 });
});
