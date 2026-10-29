import type { NextRequest } from "next/server";
import { listCritiques } from "@/lib/database/repo";
import { handle, json, parseBody, requireUser } from "@/lib/http";
import { startCritique } from "@/lib/services/critique";
import { CritiqueCreate, IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const projectId = req.nextUrl.searchParams.get("projectId");
  const critiques = await listCritiques(user.id, projectId ? IdParam.parse(projectId) : undefined);
  return json({ critiques: critiques.map(({ result, ...c }) => ({ ...c, findingCount: result?.findings.length ?? 0, summary: result?.summary ?? null })) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, CritiqueCreate);
  const { critique, job } = await startCritique(user.id, body);
  return json({ critique, job }, { status: 202 });
});
