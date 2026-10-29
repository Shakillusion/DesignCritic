import "server-only";
import { imageBlock, structuredCall, UNTRUSTED_CONTENT_RULE, type UserContent } from "@/lib/ai/client";
import { brandRulesText } from "@/agents/brand-guardian";
import type { CreativeBrief } from "@/agents/creative-director";
import { ALLOWED_FONTS, DesignDocument, normalizeDocument, type DesignDocument as Doc } from "@/lib/design-engine/schema";
import type { QaReport } from "@/agents/qa-inspector/types";
import type { Asset, Brand } from "@/types/domain";

/**
 * Design Builder: writes an editable DesignDocument (real text, vector shapes,
 * image layers referencing library assets) for one concept, and revises it
 * from measured QA issues. Layout is structured data, never a flattened image.
 */

const FONT_LIST = Object.entries(ALLOWED_FONTS)
  .map(([f, m]) => `${f} (${m.category}; weights ${m.weights.join("/")}${m.italic ? "; italic" : ""})`)
  .join("\n");

const SYSTEM = `You are the Senior Designer at a top studio, building a layout as structured, editable layers.

Craft standards
- One clear focal point and a deliberate reading order. Strong scale contrast between headline and supporting text (typically 3–6×).
- A consistent margin system: pick a margin (≈5–8% of the short side) and align text edges to it; keep all text inside the safe area.
- Text boxes must be large enough for their content: estimate line count from fontSize, letterSpacing and box width (average glyph width ≈ 0.5–0.6 × fontSize for sans, ≈0.45–0.55 for condensed/display; uppercase ≈ 0.65). Box height ≥ lines × fontSize × lineHeight. Prefer intentional \\n line breaks for headlines.
- Typography: use only the allowed fonts. At most two families. Display sizes need tighter leading (0.9–1.05) and slightly negative tracking; small caps/labels need positive tracking (0.08–0.2em).
- Legibility over photos: place type in the photo's calm area, and when needed add a subtle shape layer (solid with alpha, or a linear gradient fading to transparent) between photo and text so text contrast reaches WCAG AA (4.5:1 small, 3:1 large).
- The photo layer should usually fill the artboard (x=0,y=0,width/height = artboard) with fit "cover" and focal point set from the analysis so the subject survives the crop. Do not distort images.
- Do not add decoration for its own sake. Every element needs a job. A minimal layout can be excellent.
- If an attribution line is required, add a small "credit" text layer (≈1.1–1.4% of artboard height, 60–75% opacity) near an edge.
- Logos: you cannot draw or recreate brand logos. Never fake a logo with text or shapes.

Format rules
- Coordinates in artboard px, origin top-left. Layers are painted in array order (first = bottom).
- Every layer: rotation 0 unless purposeful, opacity 0–1, locked false, visible true.
- Colours are hex (#RRGGBB or #RRGGBBAA). Images: brightness/contrast/saturation 1 unless a treatment is intended.
- Use meaningful kebab-case ids: "photo", "scrim", "headline", "subhead", "cta", "credit".

Allowed fonts:
${FONT_LIST}

${UNTRUSTED_CONTENT_RULE}`;

export interface BuildInput {
  brief: CreativeBrief;
  conceptIndex: number;
  artboard: { width: number; height: number; kind: Doc["format"]["kind"]; preset: string; print: Doc["artboard"]["print"] };
  asset: Asset | null;
  assetPreview: { base64: string; mediaType: "image/png" | "image/jpeg" } | null;
  brand: Brand | null;
}

function assetText(a: Asset | null) {
  if (!a) return "No photograph is available: build a typographic/graphic layout with shapes and type only.";
  const an = a.analysis;
  return `Photograph available — use assetId "${a.id}" (the image above).
- Size: ${a.width}×${a.height}px. ${an.description ?? ""}
- Main subject focal point: x=${an.focalX ?? 0.5}, y=${an.focalY ?? 0.5}. Calm space for type: ${an.negativeSpace ?? "unknown"}. Mean brightness ${an.luminance ?? "?"} (0 dark – 1 light). Dominant colours: ${(an.dominantColors ?? []).join(", ")}.
- Licence: ${a.license.name}.${a.license.attributionRequired ? ` Attribution REQUIRED: add a credit layer reading exactly: ${a.attribution}` : " No attribution required."}`;
}

export async function buildDesign(opts: { userId: string; input: BuildInput }): Promise<Doc> {
  const { brief, conceptIndex, artboard, asset, assetPreview, brand } = opts.input;
  const concept = brief.concepts[conceptIndex];
  const content: UserContent = [];
  if (assetPreview) content.push(imageBlock(assetPreview.base64, assetPreview.mediaType));
  content.push({
    type: "text",
    text: `Build concept ${conceptIndex + 1}: “${concept.name}”.

Brief
- Objective: ${brief.objective}
- Audience: ${brief.audience}
- Key message: ${brief.keyMessage}
- Tone: ${brief.tone}

Copy (use exactly; you may add line breaks but not change words)
- Headline: ${brief.copy.headline}
${brief.copy.subheadline ? `- Subheadline: ${brief.copy.subheadline}\n` : ""}${brief.copy.body ? `- Body: ${brief.copy.body}\n` : ""}${brief.copy.cta ? `- CTA: ${brief.copy.cta}\n` : ""}${brief.copy.extras.map((e) => `- Extra line: ${e}`).join("\n")}

Concept
- Idea: ${concept.idea}
- Composition: ${concept.composition}
- Typography: ${concept.typography}
- Colour: ${concept.color}
- Image direction: ${concept.imageDirection}
- Type zone: ${concept.textZone}

Artboard: ${artboard.width}×${artboard.height}px, format kind "${artboard.kind}", preset "${artboard.preset}".${artboard.print ? ` Print: ${artboard.print.trimWidthMm}×${artboard.print.trimHeightMm}mm trim (the artboard is the trim area); keep text ≥ ${Math.ceil((artboard.width / (artboard.print.trimWidthMm / 25.4)) * (artboard.print.safeMargin / artboard.print.dpi))}px from every edge.` : ""}

${assetText(asset)}

Brand:
${brandRulesText(brand)}

Return the complete design document. Set artboard.print to ${artboard.print ? JSON.stringify(artboard.print) : "null"}.`,
  });
  const doc = await structuredCall({
    operation: "builder.build",
    userId: opts.userId,
    effort: "high",
    system: SYSTEM,
    content,
    schema: DesignDocument,
  });
  return enforce(doc, opts.input);
}

/** Correct measured QA problems while preserving the concept and every locked layer. */
export async function reviseDesign(opts: { userId: string; doc: Doc; qa: QaReport; render: { base64: string; mediaType: "image/png" | "image/jpeg" }; input: BuildInput; instructions?: string }): Promise<Doc> {
  const locked = opts.doc.layers.filter((l) => l.locked).map((l) => l.id);
  const issues = opts.qa.issues.filter((i) => i.severity !== "info");
  const revised = await structuredCall({
    operation: "builder.revise",
    userId: opts.userId,
    effort: "medium",
    system: SYSTEM,
    content: [
      imageBlock(opts.render.base64, opts.render.mediaType),
      {
        type: "text",
        text: `The image above is the current render of this design document:
${JSON.stringify(opts.doc)}

Measured problems from the automated inspector (objective; fix every error):
${issues.map((i) => `- [${i.severity}] ${i.check}${i.layerId ? ` (layer "${i.layerId}")` : ""}: ${i.message}${i.measured ? ` ${JSON.stringify(i.measured)}` : ""}`).join("\n") || "- none"}
${opts.instructions ? `\nAdditional direction:\n${opts.instructions}\n` : ""}
Revise with the smallest changes that fix these problems: enlarge or reflow text boxes, adjust font size, move text into calmer areas, or strengthen the scrim. Keep the concept, copy, ids and asset references. ${locked.length ? `These layers are locked and must stay byte-identical: ${locked.join(", ")}.` : ""} Return the full revised document.`,
      },
    ],
    schema: DesignDocument,
  });
  const out = enforce(revised, opts.input);
  // Locked layers are restored verbatim no matter what the model returned.
  out.layers = out.layers.map((l) => opts.doc.layers.find((o) => o.locked && o.id === l.id) ?? l);
  return out;
}

/** Hard guarantees the model can't override: size, format, real asset ids, print metadata. */
function enforce(doc: Doc, input: BuildInput): Doc {
  const d: Doc = {
    ...doc,
    schemaVersion: 1,
    format: { kind: input.artboard.kind, preset: input.artboard.preset },
    artboard: { ...doc.artboard, width: input.artboard.width, height: input.artboard.height, print: input.artboard.print },
    layers: doc.layers.filter((l) => l.type !== "image" || (input.asset && l.assetId === input.asset.id)),
  };
  return normalizeDocument(d);
}
