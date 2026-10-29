import type { NextRequest } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { readFile, saveFile } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";

const Body = z.object({
  brightness: z.number().min(0.5).max(1.5).default(1),
  contrast: z.number().min(0.5).max(1.5).default(1),
  saturation: z.number().min(0.5).max(1.5).default(1),
  crop: z.enum(["none", "1:1", "4:5", "9:16", "16:9"]).default("none"),
  width: z.number().int().min(64).max(8000).nullable().default(null),
});

/** Non-destructive raster adjustments: writes a new project image, never the original. */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/files/[id]/adjust">) => {
  const user = await requireUser();
  const { file, buffer } = await readFile(user.id, IdParam.parse((await ctx.params).id));
  if (!file.projectId || !file.mime.startsWith("image/") || file.mime === "image/svg+xml") throw new HttpError(400, "Only raster images in a project can be adjusted.");
  const b = await parseBody(req, Body);

  let img = sharp(buffer).rotate();
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (b.crop !== "none" && W && H) {
    const [a, c] = b.crop.split(":").map(Number);
    const target = a / c;
    const w = W / H > target ? Math.round(H * target) : W;
    const h = W / H > target ? H : Math.round(W / target);
    img = img.extract({ left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), width: w, height: h });
  }
  if (b.width) img = img.resize({ width: b.width, withoutEnlargement: true });
  // sharp's linear(a, b): a = contrast slope around mid-grey; modulate handles brightness/saturation.
  img = img.modulate({ brightness: b.brightness, saturation: b.saturation }).linear(b.contrast, 128 * (1 - b.contrast));
  const png = file.mime === "image/png";
  const out = await (png ? img.png() : img.jpeg({ quality: 92, mozjpeg: true })).toBuffer({ resolveWithObject: true });
  const saved = await saveFile(user.id, out.data, {
    projectId: file.projectId,
    kind: "upload",
    originalName: `${file.originalName.replace(/\.[a-z0-9]+$/i, "")} (adjusted).${png ? "png" : "jpg"}`,
    mime: png ? "image/png" : "image/jpeg",
    width: out.info.width,
    height: out.info.height,
    meta: { derivedFrom: file.id, adjustments: b },
  });
  return json({ file: saved }, { status: 201 });
});
