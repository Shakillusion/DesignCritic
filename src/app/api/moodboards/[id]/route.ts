import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteMoodboard, getMoodboard, listDirections, saveMoodboard } from "@/lib/database/research-repo";
import { getProject } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/moodboards/[id]">) => {
  const user = await requireUser();
  const board = await getMoodboard(user.id, IdParam.parse((await ctx.params).id));
  return json({ moodboard: board, project: await getProject(user.id, board.projectId), directions: await listDirections(user.id, board.projectId, board.id) });
});

const Body = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).optional(),
  items: z.array(z.object({ refId: IdParam, size: z.enum(["s", "m", "l"]), note: z.string().max(500) })).max(60).optional(),
});

export const PATCH = handle(async (req: NextRequest, ctx: RouteContext<"/api/moodboards/[id]">) => {
  const user = await requireUser();
  return json({ moodboard: await saveMoodboard(user.id, IdParam.parse((await ctx.params).id), await parseBody(req, Body)) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/moodboards/[id]">) => {
  const user = await requireUser();
  await deleteMoodboard(user.id, IdParam.parse((await ctx.params).id));
  return json({ deleted: true });
});
