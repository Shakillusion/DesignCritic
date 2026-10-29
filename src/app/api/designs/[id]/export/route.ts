import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDesign, getVersion } from "@/lib/database/repo";
import { handle, HttpError, requireUser } from "@/lib/http";
import { exportDesign } from "@/lib/services/design";
import { IdParam } from "@/lib/validation/api";

const Query = z.object({
  format: z.enum(["png", "jpg", "pdf", "html"]).default("png"),
  version: IdParam.optional(),
  scale: z.coerce.number().min(1).max(4).default(1),
});

export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/designs/[id]/export">) => {
  const user = await requireUser();
  const design = getDesign(user.id, IdParam.parse((await ctx.params).id));
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const versionId = q.version ?? design.currentVersionId;
  if (!versionId) throw new HttpError(409, "This design has no versions yet.");
  const v = getVersion(user.id, versionId);
  if (v.designId !== design.id) throw new HttpError(404, "Design version not found");
  const out = await exportDesign(user.id, versionId, q.format, q.scale);
  const name = `${design.name.replace(/[^\w-]+/g, "-").slice(0, 60)}-v${v.number}${q.scale > 1 ? `@${q.scale}x` : ""}.${out.ext}`;
  return new Response(typeof out.body === "string" ? out.body : new Uint8Array(out.body), {
    headers: { "Content-Type": out.type, "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" },
  });
});
