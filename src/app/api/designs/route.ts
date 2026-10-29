import type { NextRequest } from "next/server";
import { listDesigns } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { startGenerateDesign } from "@/lib/services/design";
import { DesignGenerate, IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const projectId = req.nextUrl.searchParams.get("projectId");
  return json({ designs: await listDesigns(user.id, projectId ? IdParam.parse(projectId) : undefined) });
});

/** Start the Create pipeline. Returns a job to poll. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, DesignGenerate);
  return json({ job: await startGenerateDesign(user.id, body) }, { status: 202 });
});
