import type { NextRequest } from "next/server";
import { z } from "zod";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { startDirections } from "@/lib/services/research";
import { IdParam } from "@/lib/validation/api";

/** Propose original art directions from this moodboard. */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/moodboards/[id]/directions">) => {
  const user = await requireUser();
  const body = await parseBody(req, z.object({ brief: z.string().max(2000).default(""), count: z.number().int().min(1).max(3).default(3) }));
  return json({ job: await startDirections(user.id, { moodboardId: IdParam.parse((await ctx.params).id), ...body }) }, { status: 202 });
});
