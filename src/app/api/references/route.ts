import type { NextRequest } from "next/server";
import { z } from "zod";
import { listReferences } from "@/lib/database/research-repo";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { saveReference } from "@/lib/services/research";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  return json({ references: listReferences(user.id, IdParam.parse(req.nextUrl.searchParams.get("projectId"))) });
});

const Body = z.object({
  projectId: IdParam,
  runId: IdParam.optional(),
  itemId: z.string().max(10).optional(),
  url: z.string().trim().url().max(2000).optional(),
});

/** Save a research item, or a pasted link (only that page's meta tags are read). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, Body);
  if (!(body.runId && body.itemId) && !body.url) throw new HttpError(400, "Give a research item or a URL.");
  return json({ reference: await saveReference(user.id, body) }, { status: 201 });
});
