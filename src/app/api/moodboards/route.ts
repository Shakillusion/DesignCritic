import type { NextRequest } from "next/server";
import { z } from "zod";
import { createMoodboard, listMoodboards } from "@/lib/database/research-repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  return json({ moodboards: listMoodboards(user.id, IdParam.parse(req.nextUrl.searchParams.get("projectId"))) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, z.object({ projectId: IdParam, name: z.string().trim().min(1).max(120), refIds: z.array(IdParam).max(60).default([]) }));
  return json({ moodboard: createMoodboard(user.id, body) }, { status: 201 });
});
