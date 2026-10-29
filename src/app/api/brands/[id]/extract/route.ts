import type { NextRequest } from "next/server";
import { z } from "zod";
import { extractBrandRules } from "@/agents/brand-guardian";
import { engineLimits, imageBlock, type UserContent } from "@/lib/ai/client";
import { getBrand } from "@/lib/database/repo";
import { handle, HttpError, json, parseBody, requireUser } from "@/lib/http";
import { prepareForVision } from "@/lib/image-processing/image";
import { startJob } from "@/lib/jobs";
import { readFile } from "@/lib/storage/storage";
import { IdParam } from "@/lib/validation/api";

const Body = z.object({ fileIds: z.array(IdParam).max(6).default([]), text: z.string().max(20000).optional() });

/** Proposes brand rules from guideline files/text. The result is a proposal the user reviews; nothing is saved here. */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/brands/[id]/extract">) => {
  const user = await requireUser();
  const brand = getBrand(user.id, IdParam.parse((await ctx.params).id));
  const body = await parseBody(req, Body);
  if (!body.fileIds.length && !body.text?.trim()) throw new HttpError(400, "Choose a guideline file or paste written guidelines.");
  const files = await Promise.all(body.fileIds.map((f) => readFile(user.id, f)));
  if (files.some((f) => f.file.brandId !== brand.id)) throw new HttpError(400, "A file doesn't belong to this brand.");
  const limits = engineLimits(user.id);
  if (files.some((f) => f.file.mime === "application/pdf") && !limits.supportsPdf) {
    throw new HttpError(400, "The selected AI provider can't read PDFs. Switch to Gemini in Settings, upload the pages as images, or paste the text.");
  }
  if (files.filter((f) => f.file.mime !== "application/pdf").length > limits.maxImages) {
    throw new HttpError(400, `The selected AI provider accepts at most ${limits.maxImages} images per request. Select fewer files.`);
  }

  const job = startJob(
    user.id,
    { type: "brand-extract", projectId: null, steps: [{ key: "extract", label: "Brand Guardian reading the guidelines" }] },
    async (c) => {
      const proposal = await c.step("extract", async () => {
        const documents: UserContent = [];
        for (const { file, buffer } of files) {
          if (file.mime === "application/pdf") {
            documents.push({ type: "pdf", base64: buffer.toString("base64"), title: file.originalName });
          } else {
            const img = await prepareForVision(buffer);
            documents.push(imageBlock(img.base64, img.mediaType));
          }
        }
        return extractBrandRules({ userId: user.id, documents, text: body.text });
      });
      return { brandId: brand.id, proposal };
    },
  );
  return json({ job }, { status: 202 });
});
