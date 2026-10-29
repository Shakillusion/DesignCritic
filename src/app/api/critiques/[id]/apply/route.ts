import type { NextRequest } from "next/server";
import { handle, json, requireUser } from "@/lib/http";
import { startApplyFixes } from "@/lib/services/improve";
import { IdParam } from "@/lib/validation/api";

/** Apply the critique's accepted findings to its design as a new, reviewable version. */
export const POST = handle(async (_req: NextRequest, ctx: RouteContext<"/api/critiques/[id]/apply">) => {
  const user = await requireUser();
  const job = await startApplyFixes(user.id, IdParam.parse((await ctx.params).id));
  return json({ job }, { status: 202 });
});
