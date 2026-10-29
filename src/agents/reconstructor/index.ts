import "server-only";
import { z } from "zod";
import { imageBlock, structuredCall, UNTRUSTED_CONTENT_RULE } from "@/lib/ai/client";
import { ALLOWED_FONTS } from "@/lib/design-engine/schema";

/**
 * Reconstructor: reads a flattened design and describes its structure —
 * text blocks, photo regions and flat shapes — in normalised coordinates.
 * It only describes what it sees; geometry → layers happens in code.
 */

const Box = {
  x: z.number().describe("Left edge, 0–1 fraction of image width"),
  y: z.number().describe("Top edge, 0–1 fraction of image height"),
  width: z.number().describe("0–1 fraction of image width"),
  height: z.number().describe("0–1 fraction of image height"),
};

export const Reconstruction = z.object({
  backgroundColor: z.string().describe("Dominant flat background colour as #RRGGBB"),
  textBlocks: z.array(
    z.object({
      ...Box,
      text: z.string().describe("Exact text, with \\n where lines break in the design"),
      role: z.enum(["headline", "subheadline", "body", "caption", "cta", "label", "credit", "other"]),
      fontStyle: z.enum(["sans", "serif", "condensed", "display", "mono", "script"]),
      fontGuess: z.string().describe("Closest family name you recognise, or 'unknown'"),
      fontWeight: z.number().describe("100–900"),
      color: z.string().describe("#RRGGBB"),
      align: z.enum(["left", "center", "right"]),
      uppercase: z.boolean(),
      italic: z.boolean(),
    }),
  ),
  imageRegions: z.array(
    z.object({
      ...Box,
      description: z.string(),
    }),
  ).describe("Photographs, illustrations, logos or textures — anything not reproducible as flat shapes or live text"),
  shapes: z.array(
    z.object({
      ...Box,
      shape: z.enum(["rect", "ellipse"]),
      color: z.string().describe("#RRGGBB"),
      opacity: z.number().describe("0–1"),
      borderRadius: z.number().describe("Corner radius as a 0–1 fraction of the shape's height (pills ≈ 0.5)"),
    }),
  ).describe("Flat-colour blocks, bars, buttons and circles"),
  notes: z.string().describe("Anything that won't survive the rebuild faithfully (textures, effects, unusual fonts)"),
});
export type Reconstruction = z.infer<typeof Reconstruction>;

export async function reconstructLayout(opts: { userId: string; image: { base64: string; mediaType: "image/png" | "image/jpeg" }; width: number; height: number }): Promise<Reconstruction> {
  return structuredCall({
    operation: "rebuild.read",
    userId: opts.userId,
    effort: "high",
    system: `You are a production designer rebuilding a flattened design as editable layers. Describe it precisely so it can be recreated.
- Boxes are tight bounding boxes in 0–1 fractions of the image (origin top-left).
- Text blocks: one block per visually separate text element (headline, each line group, button label…). Transcribe exactly; keep line breaks as \\n. Report text even when it sits on a photo.
- Image regions: photographic or illustrated areas, logos and textures. Do NOT include regions that are just flat colour (use shapes) or just text.
- Shapes: flat-colour rectangles, bars, buttons (the button background, not its label), circles. Order shapes as they're stacked, bottom first.
- Colours: sample the actual pixels; hex only.
- Fonts that exist for the rebuild: ${Object.keys(ALLOWED_FONTS).join(", ")}. Pick fontGuess from this list when one is a close match.
- Be honest in notes about what can't be reproduced.
${UNTRUSTED_CONTENT_RULE}`,
    content: [imageBlock(opts.image.base64, opts.image.mediaType), { type: "text", text: `The original is ${opts.width}×${opts.height}px. Describe its structure.` }],
    schema: Reconstruction,
  });
}

const STYLE_FONT: Record<Reconstruction["textBlocks"][number]["fontStyle"], string> = {
  sans: "Inter",
  serif: "Playfair Display",
  condensed: "Oswald",
  display: "Archivo Black",
  mono: "IBM Plex Mono",
  script: "Instrument Serif",
};

/** Closest available font: the model's guess if it exists, otherwise a stand-in for the style. */
export function pickFont(block: Pick<Reconstruction["textBlocks"][number], "fontGuess" | "fontStyle" | "uppercase" | "fontWeight">): string {
  const guess = Object.keys(ALLOWED_FONTS).find((f) => f.toLowerCase() === block.fontGuess.trim().toLowerCase());
  if (guess) return guess;
  if (block.fontStyle === "display" && block.uppercase) return "Anton";
  if (block.fontStyle === "serif" && block.fontWeight < 500) return "EB Garamond";
  return STYLE_FONT[block.fontStyle];
}
