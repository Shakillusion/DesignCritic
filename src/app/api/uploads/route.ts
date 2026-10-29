import { z } from "zod";
import { getBrand, getProject, insertAsset, updateBrand } from "@/lib/database/repo";
import { env } from "@/lib/env";
import { handle, HttpError, json, requireUser } from "@/lib/http";
import { colorProfile, validateUpload } from "@/lib/image-processing/image";
import { saveFile } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";
import type { FileKind } from "@/types/domain";

const Purpose = z.enum(["critique", "asset", "reference", "brand-logo", "brand-reference", "brand-guideline"]);

const RULES: Record<z.infer<typeof Purpose>, { kind: FileKind; allow: ("raster" | "svg" | "pdf")[]; scope: "project" | "brand" }> = {
  critique: { kind: "upload", allow: ["raster", "svg"], scope: "project" },
  asset: { kind: "asset-original", allow: ["raster", "svg"], scope: "project" },
  reference: { kind: "reference", allow: ["raster"], scope: "project" },
  "brand-logo": { kind: "logo", allow: ["raster", "svg"], scope: "brand" },
  "brand-reference": { kind: "reference", allow: ["raster"], scope: "brand" },
  "brand-guideline": { kind: "guideline", allow: ["raster", "pdf"], scope: "brand" },
};

/** multipart/form-data: file, purpose, projectId | brandId */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Expected multipart form data.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file was attached.");
  if (file.size > env.maxUploadBytes) {
    throw new HttpError(413, `The file is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${Math.round(env.maxUploadBytes / 1048576)} MB.`);
  }
  const purpose = Purpose.parse(form.get("purpose"));
  const rule = RULES[purpose];
  const projectId = rule.scope === "project" ? IdParam.parse(form.get("projectId")) : null;
  const brandId = rule.scope === "brand" ? IdParam.parse(form.get("brandId")) : null;
  if (projectId) getProject(user.id, projectId);
  const brand = brandId ? getBrand(user.id, brandId) : null;

  const validated = await validateUpload(Buffer.from(await file.arrayBuffer()), { allow: rule.allow, maxBytes: env.maxUploadBytes });
  const originalName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 160) || "upload";
  const stored = await saveFile(user.id, validated.buffer, {
    projectId,
    brandId,
    kind: rule.kind,
    originalName,
    mime: validated.mime,
    width: validated.width,
    height: validated.height,
  });

  if (brand) {
    const key = purpose === "brand-logo" ? "logoFileIds" : purpose === "brand-reference" ? "referenceFileIds" : "guidelineFileIds";
    updateBrand(user.id, brand.id, { [key]: [...brand[key], stored.id] }, `Added ${purpose.replace("brand-", "")} file “${originalName}”`);
  }

  let asset = null;
  if (purpose === "asset" && projectId) {
    const profile = validated.mime === "image/svg+xml" ? null : await colorProfile(validated.buffer).catch(() => null);
    asset = insertAsset(user.id, {
      projectId,
      fileId: stored.id,
      type: validated.mime === "image/svg+xml" ? "vector" : "photo",
      source: "upload",
      provider: null,
      providerId: null,
      title: originalName.replace(/\.[a-z0-9]+$/i, ""),
      creator: null,
      creatorUrl: null,
      sourceUrl: null,
      license: {
        code: "user-provided",
        name: "Provided by you",
        url: null,
        commercialUse: null,
        modificationAllowed: null,
        attributionRequired: false,
        shareAlike: false,
        notes: "Uploaded by the user, who is responsible for having the rights to use it.",
      },
      attribution: null,
      status: "approved",
      locked: false,
      analysis: profile ? { luminance: profile.luminance, dominantColors: profile.dominantColors } : {},
      retrievedAt: null,
    });
  }

  return json({ file: stored, asset }, { status: 201 });
});
