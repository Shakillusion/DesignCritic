import type { NextRequest } from "next/server";
import { getJob } from "@/lib/database/repo";
import { handle, json, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) => {
  const user = await requireUser();
  return json({ job: getJob(user.id, IdParam.parse((await ctx.params).id)) });
});
