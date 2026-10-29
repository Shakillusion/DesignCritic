import type { Reconstruction } from "@/agents/reconstructor";
import { normalizeDocument, type DesignDocument, type Layer } from "./schema";

/** Pixel box from a 0–1 box, clamped to the artboard. */
export function toPixels(b: { x: number; y: number; width: number; height: number }, W: number, H: number) {
  const c = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = Math.round(c(b.x) * W), y = Math.round(c(b.y) * H);
  return { x, y, width: Math.max(1, Math.min(W - x, Math.round(c(b.width) * W))), height: Math.max(1, Math.min(H - y, Math.round(c(b.height) * H))) };
}

/**
 * Turn a reconstruction into an editable document. Font size comes from the
 * measured box height (more reliable than a model's guess); boxes get a little
 * headroom so the closest-match font doesn't clip.
 */
export function buildRebuiltDocument(
  r: Reconstruction,
  size: { width: number; height: number },
  regions: { assetId: string; index: number }[],
  fonts: (block: Reconstruction["textBlocks"][number]) => string,
  name: string,
): DesignDocument {
  const { width: W, height: H } = size;
  const layers: Layer[] = [];
  const base = { rotation: 0, opacity: 1, locked: false, visible: true };

  r.shapes.forEach((s, i) => {
    const p = toPixels(s, W, H);
    layers.push({ ...base, ...p, id: `shape-${i + 1}`, name: `Shape ${i + 1}`, type: "shape", shape: s.shape, fill: { type: "solid", color: s.color }, stroke: null, strokeWidth: 0, borderRadius: Math.round(Math.min(1, Math.max(0, s.borderRadius)) * p.height), blendMode: "normal", opacity: Math.min(1, Math.max(0, s.opacity)) });
  });
  for (const { assetId, index } of regions) {
    const region = r.imageRegions[index];
    if (!region) continue;
    const p = toPixels(region, W, H);
    layers.push({ ...base, ...p, id: `image-${index + 1}`, name: region.description.slice(0, 40) || `Image ${index + 1}`, type: "image", assetId, fit: "cover", focalX: 0.5, focalY: 0.5, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 });
  }
  // Images usually sit beneath flat shapes like buttons; keep shapes that overlap an image above it.
  layers.sort((a, b) => (a.type === "image" ? 0 : 1) - (b.type === "image" ? 0 : 1));

  r.textBlocks.forEach((t, i) => {
    const p = toPixels(t, W, H);
    const lines = Math.max(1, t.text.split("\n").length);
    const lineHeight = t.role === "headline" ? 1.05 : 1.25;
    const fontSize = Math.max(6, Math.round(p.height / (lines * lineHeight)));
    // Small headroom: the substitute font rarely has identical metrics.
    const width = Math.min(W - p.x, Math.round(p.width * 1.08));
    const height = Math.min(H - p.y, Math.round(p.height * 1.12));
    layers.push({
      ...base,
      x: p.x,
      y: p.y,
      width,
      height,
      id: `${t.role}-${i + 1}`,
      name: t.text.split("\n")[0].slice(0, 32) || `Text ${i + 1}`,
      type: "text",
      role: t.role,
      text: t.text,
      fontFamily: fonts(t),
      fontWeight: t.fontWeight,
      fontSize,
      lineHeight,
      letterSpacing: t.uppercase ? 0.04 : 0,
      color: t.color,
      align: t.align,
      verticalAlign: "top",
      textTransform: "none",
      italic: t.italic,
    });
  });

  return normalizeDocument({
    schemaVersion: 1,
    name,
    format: { kind: "other", preset: "custom" },
    artboard: { width: W, height: H, background: { type: "solid", color: r.backgroundColor }, print: null },
    layers,
    metadata: { concept: "Rebuilt from an uploaded image.", rationale: r.notes, fontsUsed: [] },
  });
}

/** Shrink text that overflows its box (measured by QA), keeping the box. Returns null when nothing changed. */
export function shrinkOverflowingText(doc: DesignDocument, overflow: { layerId: string; contentHeight: number; boxHeight: number; contentWidth?: number; boxWidth?: number }[]): DesignDocument | null {
  if (!overflow.length) return null;
  const next = structuredClone(doc);
  let changed = false;
  for (const o of overflow) {
    const l = next.layers.find((x) => x.id === o.layerId);
    if (!l || l.type !== "text" || o.contentHeight <= 0) continue;
    const hRatio = o.boxHeight / o.contentHeight;
    const wRatio = o.contentWidth && o.boxWidth ? o.boxWidth / o.contentWidth : 1;
    const ratio = Math.max(0.6, Math.min(0.97, hRatio, wRatio));
    l.fontSize = Math.max(6, Math.floor(l.fontSize * ratio));
    changed = true;
  }
  return changed ? next : null;
}
