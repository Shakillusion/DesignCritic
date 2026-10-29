import type { NextRequest } from "next/server";
import { handle, json, requireUser } from "@/lib/http";
import { startImprovementPlan } from "@/lib/services/critique";
import { IdParam } from "@/lib/validation/api";

export const POST = handle(async (_req: NextRequest, ctx: RouteContext<"/api/critiques/[id]/plan">) => {
  const user = await requireUser();
  const job = startImprovementPlan(user.id, IdParam.parse((await ctx.params).id));
  return json({ job }, { status: 202 });
});
