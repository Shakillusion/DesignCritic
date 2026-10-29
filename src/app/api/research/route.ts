import type { NextRequest } from "next/server";
import { z } from "zod";
import { listResearchRuns } from "@/lib/database/research-repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { startResearch } from "@/lib/services/research";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const runs = listResearchRuns(user.id, IdParam.parse(req.nextUrl.searchParams.get("projectId")));
  return json({ runs: runs.map(({ items, brief, ...r }) => ({ ...r, itemCount: items.length, insightCount: brief?.insights.length ?? 0 })) });
});

const Body = z.object({
  projectId: IdParam,
  topic: z.string().trim().min(2).max(200),
  industry: z.string().trim().max(120).default(""),
  direction: z.string().trim().max(300).default(""),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, Body);
  return json({ job: startResearch(user.id, body) }, { status: 202 });
});
