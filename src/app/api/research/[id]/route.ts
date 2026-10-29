import type { NextRequest } from "next/server";
import { getResearchRun } from "@/lib/database/research-repo";
import { handle, json, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser();
  return json({ run: getResearchRun(user.id, IdParam.parse((await ctx.params).id)) });
});
