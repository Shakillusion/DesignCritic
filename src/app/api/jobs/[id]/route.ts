import type { NextRequest } from "next/server";
import { failInterruptedWork, getJob } from "@/lib/database/repo";
import { env } from "@/lib/env";
import { handle, json, requireUser } from "@/lib/http";
import { STALE_JOB_MS } from "@/lib/jobs";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) => {
  const user = await requireUser();
  // On serverless a job cut off by the time limit never reports back; polling notices instead.
  if (env.onVercel) await failInterruptedWork(new Date(Date.now() - STALE_JOB_MS).toISOString());
  return json({ job: await getJob(user.id, IdParam.parse((await ctx.params).id)) });
});
