import type { NextRequest } from "next/server";
import { reportHtml, reportMarkdown } from "@/agents/export/report";
import { getBrand, getCritique, getFile, getProject } from "@/lib/database/repo";
import { handle, HttpError, requireUser } from "@/lib/http";
import { fileAsDataUri } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";

export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/critiques/[id]/report">) => {
  const user = await requireUser();
  const critique = await getCritique(user.id, IdParam.parse((await ctx.params).id));
  if (!critique.result) throw new HttpError(409, "This critique has no result to export yet.");
  const format = req.nextUrl.searchParams.get("format") ?? "html";
  const input = {
    critique,
    project: await getProject(user.id, critique.projectId),
    brand: critique.brandId ? await getBrand(user.id, critique.brandId) : null,
    file: await getFile(user.id, critique.fileId),
    imageDataUri: format === "html" ? await fileAsDataUri(user.id, critique.fileId) : "",
  };
  const base = `critique-${critique.title.replace(/[^\w-]+/g, "-").slice(0, 60) || critique.id}`;
  const out =
    format === "md"
      ? { body: reportMarkdown(input), type: "text/markdown; charset=utf-8", ext: "md" }
      : format === "json"
        ? { body: JSON.stringify({ critique, file: input.file, project: input.project }, null, 2), type: "application/json", ext: "json" }
        : { body: reportHtml(input), type: "text/html; charset=utf-8", ext: "html" };
  return new Response(out.body, {
    headers: {
      "Content-Type": out.type,
      "Content-Disposition": `attachment; filename="${base}.${out.ext}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
