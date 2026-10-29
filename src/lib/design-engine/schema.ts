import { z } from "zod";

/**
 * DesignCritic design document, version 1.
 *
 * A flat, ordered list of layers on a fixed artboard. Layers are listed
 * bottom → top. Everything stays editable: text is real text, shapes are
 * vector boxes, images reference stored assets by id (never inlined).
 *
 * The schema is deliberately free of numeric min/max constraints so it can be
 * sent to Claude as a structured-output format; `normalizeDocument` clamps
 * values afterwards.
 */

export const SolidFill = z.object({
  type: z.literal("solid"),
  color: z.string().describe("Hex colour, e.g. #1A1816 or #1A1816CC with alpha"),
});

export const GradientStop = z.object({
  color: z.string().describe("Hex colour with optional alpha"),
  position: z.number().describe("0–100 percent along the gradient"),
});

export const LinearGradientFill = z.object({
  type: z.literal("linear"),
  angle: z.number().describe("CSS gradient angle in degrees (180 = top→bottom)"),
  stops: z.array(GradientStop),
});

export const Fill = z.discriminatedUnion("type", [SolidFill, LinearGradientFill]);
export type Fill = z.infer<typeof Fill>;

const LayerBase = {
  id: z.string().describe("Unique, stable, kebab-case id, e.g. headline"),
  name: z.string().describe("Human-readable layer name"),
  x: z.number().describe("Left edge in artboard px"),
  y: z.number().describe("Top edge in artboard px"),
  width: z.number(),
  height: z.number(),
  rotation: z.number().describe("Degrees clockwise"),
  opacity: z.number().describe("0–1"),
  locked: z.boolean(),
  visible: z.boolean(),
};

export const TextLayer = z.object({
  ...LayerBase,
  type: z.literal("text"),
  role: z
    .enum(["headline", "subheadline", "body", "caption", "cta", "label", "credit", "other"])
    .describe("Semantic role, used by QA and the critic"),
  text: z.string().describe("Use \\n for intentional line breaks"),
  fontFamily: z.string().describe("Must be one of the allowed font families"),
  fontWeight: z.number().describe("100–900"),
  fontSize: z.number().describe("px"),
  lineHeight: z.number().describe("Unitless multiplier, e.g. 1.1"),
  letterSpacing: z.number().describe("em, e.g. -0.02 or 0.12"),
  color: z.string(),
  align: z.enum(["left", "center", "right"]),
  verticalAlign: z.enum(["top", "middle", "bottom"]),
  textTransform: z.enum(["none", "uppercase", "lowercase"]),
  italic: z.boolean(),
});

export const ImageLayer = z.object({
  ...LayerBase,
  type: z.literal("image"),
  assetId: z.string().describe("Id of an asset in the project library"),
  fit: z.enum(["cover", "contain"]),
  focalX: z.number().describe("0–1 horizontal focal point kept visible when cropping"),
  focalY: z.number().describe("0–1 vertical focal point"),
  brightness: z.number().describe("1 = unchanged"),
  contrast: z.number().describe("1 = unchanged"),
  saturation: z.number().describe("1 = unchanged"),
  borderRadius: z.number(),
});

export const ShapeLayer = z.object({
  ...LayerBase,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "line"]),
  fill: Fill.nullable(),
  stroke: z.string().nullable(),
  strokeWidth: z.number(),
  borderRadius: z.number(),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay", "soft-light"]),
});

export const Layer = z.discriminatedUnion("type", [TextLayer, ImageLayer, ShapeLayer]);
export type Layer = z.infer<typeof Layer>;
export type TextLayer = z.infer<typeof TextLayer>;
export type ImageLayer = z.infer<typeof ImageLayer>;
export type ShapeLayer = z.infer<typeof ShapeLayer>;

export const Artboard = z.object({
  width: z.number().describe("px"),
  height: z.number().describe("px"),
  background: Fill,
  /** Print metadata. `dpi` is the intended output resolution; bleed/safe are in px at that dpi. */
  print: z
    .object({
      dpi: z.number(),
      bleed: z.number(),
      safeMargin: z.number(),
      trimWidthMm: z.number(),
      trimHeightMm: z.number(),
    })
    .nullable(),
});

export const DesignDocument = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  format: z.object({
    kind: z.enum(["social", "poster", "print", "web", "presentation", "advertisement", "other"]),
    preset: z.string().describe("Preset key or 'custom'"),
  }),
  artboard: Artboard,
  layers: z.array(Layer).describe("Bottom → top paint order"),
  metadata: z.object({
    concept: z.string().describe("One-paragraph concept statement"),
    rationale: z.string().describe("Why these typography, layout and colour choices fit the brief"),
    fontsUsed: z.array(z.string()),
  }),
});
export type DesignDocument = z.infer<typeof DesignDocument>;

/** Fonts the renderer can load (Google Fonts). The builder may only use these. */
export const ALLOWED_FONTS: Record<string, { category: string; weights: number[]; italic: boolean }> = {
  Inter: { category: "sans", weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  "Inter Tight": { category: "sans", weights: [400, 500, 600, 700, 800, 900], italic: true },
  Manrope: { category: "sans", weights: [400, 500, 600, 700, 800], italic: false },
  "DM Sans": { category: "sans", weights: [400, 500, 700], italic: true },
  "Space Grotesk": { category: "sans", weights: [400, 500, 600, 700], italic: false },
  Archivo: { category: "sans", weights: [400, 500, 700, 800, 900], italic: true },
  "Archivo Black": { category: "display", weights: [400], italic: false },
  Oswald: { category: "condensed", weights: [400, 500, 600, 700], italic: false },
  "Bebas Neue": { category: "display", weights: [400], italic: false },
  Anton: { category: "display", weights: [400], italic: false },
  "Playfair Display": { category: "serif", weights: [400, 500, 600, 700, 800, 900], italic: true },
  "Cormorant Garamond": { category: "serif", weights: [400, 500, 600, 700], italic: true },
  "DM Serif Display": { category: "serif", weights: [400], italic: true },
  Fraunces: { category: "serif", weights: [300, 400, 600, 700, 900], italic: true },
  "Instrument Serif": { category: "serif", weights: [400], italic: true },
  "EB Garamond": { category: "serif", weights: [400, 500, 600, 700], italic: true },
  "Libre Baskerville": { category: "serif", weights: [400, 700], italic: true },
  "IBM Plex Mono": { category: "mono", weights: [400, 500, 600, 700], italic: true },
  "JetBrains Mono": { category: "mono", weights: [400, 500, 700], italic: true },
  Syne: { category: "display", weights: [400, 600, 700, 800], italic: false },
  Unbounded: { category: "display", weights: [400, 600, 700, 900], italic: false },
};

export const FORMAT_PRESETS: Record<string, { label: string; width: number; height: number; kind: DesignDocument["format"]["kind"]; print?: { dpi: number; trimWidthMm: number; trimHeightMm: number; bleedMm: number } }> = {
  "instagram-post": { label: "Instagram post · 1080×1350", width: 1080, height: 1350, kind: "social" },
  "instagram-square": { label: "Instagram square · 1080×1080", width: 1080, height: 1080, kind: "social" },
  "story": { label: "Story / Reel cover · 1080×1920", width: 1080, height: 1920, kind: "social" },
  "linkedin-post": { label: "LinkedIn post · 1200×1500", width: 1200, height: 1500, kind: "social" },
  "x-post": { label: "X / Twitter post · 1600×900", width: 1600, height: 900, kind: "social" },
  "web-hero": { label: "Web hero · 1920×1080", width: 1920, height: 1080, kind: "web" },
  "display-ad-mrec": { label: "Display ad MREC · 300×250", width: 300, height: 250, kind: "advertisement" },
  "presentation-16-9": { label: "Slide 16:9 · 1920×1080", width: 1920, height: 1080, kind: "presentation" },
  // Screen-resolution poster; print presets carry real size metadata.
  "poster-digital": { label: "Digital poster · 1200×1800 (2:3)", width: 1200, height: 1800, kind: "poster" },
  "poster-a3": {
    label: "A3 poster · 297×420 mm (preview at 1240×1754)",
    width: 1240,
    height: 1754,
    kind: "print",
    print: { dpi: 300, trimWidthMm: 297, trimHeightMm: 420, bleedMm: 3 },
  },
  "flyer-a5": {
    label: "A5 flyer · 148×210 mm (preview at 874×1240)",
    width: 874,
    height: 1240,
    kind: "print",
    print: { dpi: 300, trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3 },
  },
};

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isHexColor = (c: string) => HEX.test(c);
const safeColor = (c: string | null, fallback: string) => (c && HEX.test(c) ? c : fallback);

/** Clamp numbers, repair colours, de-duplicate ids, map unknown fonts to Inter. */
export function normalizeDocument(input: DesignDocument): DesignDocument {
  const doc = structuredClone(input);
  doc.artboard.width = Math.round(clamp(doc.artboard.width, 50, 8000));
  doc.artboard.height = Math.round(clamp(doc.artboard.height, 50, 8000));
  doc.artboard.background = normalizeFill(doc.artboard.background) ?? { type: "solid", color: "#FFFFFF" };
  const seen = new Set<string>();
  doc.layers = doc.layers.map((layer, i) => {
    let id = (layer.id || `layer-${i + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-");
    while (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    const base = {
      ...layer,
      id,
      name: layer.name || id,
      width: Math.max(1, layer.width),
      height: Math.max(1, layer.height),
      rotation: clamp(layer.rotation, -360, 360),
      opacity: clamp(layer.opacity, 0, 1),
    };
    if (base.type === "text") {
      const font = ALLOWED_FONTS[base.fontFamily] ? base.fontFamily : "Inter";
      return {
        ...base,
        fontFamily: font,
        fontWeight: nearestWeight(font, base.fontWeight),
        fontSize: clamp(base.fontSize, 4, 1200),
        lineHeight: clamp(base.lineHeight, 0.6, 3),
        letterSpacing: clamp(base.letterSpacing, -0.2, 1),
        color: safeColor(base.color, "#111111"),
      };
    }
    if (base.type === "image") {
      return {
        ...base,
        focalX: clamp(base.focalX, 0, 1),
        focalY: clamp(base.focalY, 0, 1),
        brightness: clamp(base.brightness, 0, 3),
        contrast: clamp(base.contrast, 0, 3),
        saturation: clamp(base.saturation, 0, 3),
        borderRadius: Math.max(0, base.borderRadius),
      };
    }
    return {
      ...base,
      fill: normalizeFill(base.fill),
      stroke: base.stroke && HEX.test(base.stroke) ? base.stroke : null,
      strokeWidth: Math.max(0, base.strokeWidth),
      borderRadius: Math.max(0, base.borderRadius),
    };
  });
  doc.metadata.fontsUsed = [...new Set(doc.layers.flatMap((l) => (l.type === "text" ? [l.fontFamily] : [])))];
  return doc;
}

function normalizeFill(fill: Fill | null): Fill | null {
  if (!fill) return null;
  if (fill.type === "solid") return { type: "solid", color: safeColor(fill.color, "#FFFFFF") };
  const stops = fill.stops
    .filter((s) => HEX.test(s.color))
    .map((s) => ({ color: s.color, position: clamp(s.position, 0, 100) }));
  if (stops.length < 2) return stops[0] ? { type: "solid", color: stops[0].color } : null;
  return { type: "linear", angle: clamp(fill.angle, -360, 360), stops };
}

function nearestWeight(font: string, weight: number): number {
  const weights = ALLOWED_FONTS[font]?.weights ?? [400];
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);
}

export function assetIdsInDocument(doc: DesignDocument): string[] {
  return [...new Set(doc.layers.flatMap((l) => (l.type === "image" ? [l.assetId] : [])))];
}
