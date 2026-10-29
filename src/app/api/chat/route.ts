import type { NextRequest } from "next/server";
import { z } from "zod";
import { listChatMessages } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { handleChatMessage } from "@/lib/services/assistant";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const projectId = IdParam.parse(req.nextUrl.searchParams.get("projectId"));
  const designId = req.nextUrl.searchParams.get("designId");
  return json({ messages: await listChatMessages(user.id, projectId, designId ? IdParam.parse(designId) : null) });
});

const Body = z.object({ projectId: IdParam, designId: IdParam.nullable(), message: z.string().trim().min(1).max(2000) });

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, Body);
  return json(await handleChatMessage(user.id, body), { status: 201 });
});
