import type { NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { readFile } from "@/lib/storage/storage";
import { thumbnail } from "@/lib/image-processing/image";
import { IdParam } from "@/lib/validation/api";

/**
 * Serves a stored file to its owner. Strict headers: no sniffing, and a CSP
 * that stops an SVG from running script even if opened directly.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/files/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const { file, buffer } = await readFile(user.id, id);
  const thumb = req.nextUrl.searchParams.get("thumb");
  const download = req.nextUrl.searchParams.get("download") === "1";
  let body: Buffer = buffer;
  let type = file.mime;
  if (thumb && file.mime.startsWith("image/") && file.mime !== "image/gif") {
    const edge = Math.min(1600, Math.max(64, Number(thumb) || 480));
    body = await thumbnail(buffer, edge);
    type = "image/webp";
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.originalName)}"`,
    },
  });
});
