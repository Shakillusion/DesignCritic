import type { NextRequest } from "next/server";
import { listAssets } from "@/lib/database/repo";
import { handle, json, requireUser } from "@/lib/http";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  return json({
    assets: await listAssets(user.id, {
      projectId: projectId ? IdParam.parse(projectId) : undefined,
      type: sp.get("type") || undefined,
      status: sp.get("status") || undefined,
    }),
  });
});
