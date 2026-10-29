import type { NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { readFile, streamFile } from "@/lib/storage/storage";
import { thumbnail } from "@/lib/image-processing/image";
import { IdParam } from "@/lib/validation/api";

/**
 * Serves a stored file to its owner. Strict headers: no sniffing, and a CSP
 * that stops an SVG from running script even if opened directly.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/files/[id]">) => {
  const user = await requireUser();
  const id = IdParam.parse((await ctx.params).id);
  const thumb = req.nextUrl.searchParams.get("thumb");
  const download = req.nextUrl.searchParams.get("download") === "1";
  let body: BodyInit;
  let type: string;
  let size: number;
  let name: string;
  if (thumb) {
    const { file, buffer } = await readFile(user.id, id);
    const resize = file.mime.startsWith("image/") && file.mime !== "image/gif";
    const out = resize ? await thumbnail(buffer, Math.min(1600, Math.max(64, Number(thumb) || 480))) : buffer;
    [body, type, size, name] = [new Uint8Array(out), resize ? "image/webp" : file.mime, out.length, file.originalName];
  } else {
    // Streamed, so full-size originals and exports aren't capped by serverless response limits.
    const { file, stream } = await streamFile(user.id, id);
    [body, type, size, name] = [stream, file.mime, file.size, file.originalName];
  }
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(name)}"`,
    },
  });
});
