import "server-only";
import sharp from "sharp";
import type { DesignDocument, TextLayer } from "@/lib/design-engine/schema";
import { renderDesignHtml, type ResolvedAsset } from "@/lib/design-engine/render-html";
import { measureInPage, screenshotArtboard, withPage, type LayerMeasurement } from "@/lib/design-engine/renderer";
import { chroma, compositeOver, contrastRatio, deltaE76, parseHex, relativeLuminance, toHex, type Rgba } from "./color";
import type { QaIssue, QaReport } from "./types";

export { contrastRatio, relativeLuminance } from "./color";

type Lock = "locked" | "flexible" | "inspirational";
export interface QaBrand {
  colors: { hex: string; lock: Lock }[];
  fonts: { family: string; lock: Lock }[];
}

export interface InspectOptions {
  resolveAsset: (assetId: string) => ResolvedAsset | null;
  brand?: QaBrand | null;
  expected?: { width: number; height: number };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Brand colour match threshold (CIE76). Near-neutrals (black/white/greys) are exempt from brand-colour checks. */
const BRAND_DELTA_E = 12;
const NEUTRAL_CHROMA = 6;

/** Objective, programmatic QA of a rendered design. One browser page: measure, then hide text and screenshot. */
export async function inspectDesign(doc: DesignDocument, opts: InspectOptions): Promise<QaReport> {
  const { width: W, height: H } = doc.artboard;
  const issues: QaIssue[] = [];
  const checksRun: string[] = [];
  const run = (check: string) => checksRun.push(check);
  const layerById = new Map(doc.layers.map((l) => [l.id, l]));

  const html = renderDesignHtml(doc, { resolveAsset: opts.resolveAsset, mode: "export" });
  const { measured, background } = await withPage(html, { width: W, height: H, scale: 1 }, async (page) => {
    const measured = await measureInPage(page);
    await page.addStyleTag({ content: '[data-layer-type="text"]{visibility:hidden !important}' });
    const background = await screenshotArtboard(page, { width: W, height: H });
    return { measured, background };
  });

  // dimensions
  run("dimensions");
  if (opts.expected && (opts.expected.width !== W || opts.expected.height !== H)) {
    issues.push({
      check: "dimensions",
      severity: "error",
      layerId: null,
      message: `Artboard is ${W}×${H}px but ${opts.expected.width}×${opts.expected.height}px was expected.`,
      measured: { width: W, height: H, expectedWidth: opts.expected.width, expectedHeight: opts.expected.height },
    });
  }

  const texts = measured.filter((m) => m.type === "text");

  // text-overflow
  run("text-overflow");
  for (const m of texts) {
    const overH = m.scrollHeight > m.clientHeight + 1;
    const overW = m.scrollWidth > m.clientWidth + 1;
    if (!overH && !overW) continue;
    issues.push({
      check: "text-overflow",
      severity: "error",
      layerId: m.id,
      message: overH
        ? `Text needs ${m.scrollHeight}px of height but its box is ${m.clientHeight}px; ${m.scrollHeight - m.clientHeight}px is clipped.`
        : `Text needs ${m.scrollWidth}px of width but its box is ${m.clientWidth}px; it is clipped horizontally.`,
      measured: { contentHeight: m.scrollHeight, boxHeight: m.clientHeight, contentWidth: m.scrollWidth, boxWidth: m.clientWidth },
    });
  }

  // out-of-bounds (any layer fully off the artboard) / clipping (text partly outside)
  run("out-of-bounds");
  run("clipping");
  const outside = (b: LayerMeasurement["box"]) => ({
    left: -b.x,
    top: -b.y,
    right: b.x + b.w - W,
    bottom: b.y + b.h - H,
  });
  for (const m of measured) {
    const b = m.box;
    if (b.x >= W || b.y >= H || b.x + b.w <= 0 || b.y + b.h <= 0) {
      issues.push({
        check: "out-of-bounds",
        severity: "warning",
        layerId: m.id,
        message: `Layer is entirely outside the ${W}×${H} artboard and will not be visible.`,
        measured: { x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) },
      });
      continue;
    }
    if (m.type !== "text") continue; // full-bleed images/shapes are intentional
    const area = m.contentBox && m.contentBox.w > 0 ? m.contentBox : b;
    const o = outside(area);
    const sides = (Object.keys(o) as (keyof typeof o)[]).filter((k) => o[k] > 1);
    if (sides.length) {
      issues.push({
        check: "clipping",
        severity: "error",
        layerId: m.id,
        message: `Text extends past the artboard ${sides.join(", ")} edge (${sides.map((s) => `${Math.round(o[s])}px`).join(", ")}) and is cut off.`,
        measured: Object.fromEntries(sides.map((s) => [`${s}Px`, Math.round(o[s])])),
      });
    }
  }

  // safe-margin
  run("safe-margin");
  const print = doc.artboard.print;
  const artboardPpi = print && print.trimWidthMm > 0 ? W / (print.trimWidthMm / 25.4) : null;
  // print.safeMargin is in px at print.dpi; convert to artboard px when the artboard is a lower-res preview.
  const margin =
    print && print.safeMargin > 0
      ? print.safeMargin * (artboardPpi && print.dpi > 0 ? artboardPpi / print.dpi : 1)
      : 0.04 * Math.min(W, H);
  const clipped = new Set(issues.filter((i) => i.check === "clipping").map((i) => i.layerId));
  for (const m of texts) {
    if (clipped.has(m.id)) continue;
    const a = m.contentBox && m.contentBox.w > 0 ? m.contentBox : m.box;
    const dist = Math.min(a.x, a.y, W - (a.x + a.w), H - (a.y + a.h));
    if (dist < margin - 0.5) {
      issues.push({
        check: "safe-margin",
        severity: "warning",
        layerId: m.id,
        message: `Text is ${Math.max(0, Math.round(dist))}px from the artboard edge; the safe margin is ${Math.round(margin)}px.`,
        measured: { distancePx: r2(Math.max(0, dist)), safeMarginPx: r2(margin) },
      });
    }
  }

  // contrast
  run("contrast");
  const raw = await sharp(background).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const m of texts) {
    const layer = layerById.get(m.id);
    if (!layer || layer.type !== "text" || !layer.text.trim()) continue;
    const area = m.contentBox && m.contentBox.w > 0 ? m.contentBox : m.box;
    const stats = sampleRegion(raw.data, raw.info.width, raw.info.height, raw.info.channels, area);
    if (!stats) continue;
    issues.push(...contrastIssues(layer, stats));
  }

  // low-resolution
  run("low-resolution");
  for (const m of measured) {
    const layer = layerById.get(m.id);
    if (!layer || layer.type !== "image" || m.missingAsset || !m.naturalWidth || !m.naturalHeight) continue;
    const sx = layer.width / m.naturalWidth;
    const sy = layer.height / m.naturalHeight;
    const scale = layer.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy); // artboard px per source px
    const base = { naturalWidth: m.naturalWidth, naturalHeight: m.naturalHeight, displayedWidth: layer.width, displayedHeight: layer.height };
    if (print && artboardPpi) {
      const dpi = artboardPpi / scale;
      if (dpi < 240) {
        issues.push({
          check: "low-resolution",
          severity: dpi < 150 ? "error" : "warning",
          layerId: m.id,
          message: `Image prints at ~${Math.round(dpi)} DPI (aim for 300, minimum 240).`,
          measured: { ...base, effectiveDpi: Math.round(dpi) },
        });
      }
    } else if (scale > 1.1) {
      issues.push({
        check: "low-resolution",
        severity: scale > 1.5 ? "error" : "warning",
        layerId: m.id,
        message: `Image is upscaled ${r2(scale)}× (${m.naturalWidth}×${m.naturalHeight}px source shown at ${layer.width}×${layer.height}px) and will look soft.`,
        measured: { ...base, upscale: r2(scale) },
      });
    }
  }

  // missing-asset
  run("missing-asset");
  for (const m of measured) {
    if (!m.missingAsset) continue;
    const layer = layerById.get(m.id);
    issues.push({
      check: "missing-asset",
      severity: "error",
      layerId: m.id,
      message: `Image asset ${layer?.type === "image" ? `"${layer.assetId}" ` : ""}could not be loaded; a placeholder is shown.`,
    });
  }

  // font-fallback
  run("font-fallback");
  for (const m of texts) {
    if (m.fontLoaded !== false) continue;
    const layer = layerById.get(m.id) as TextLayer | undefined;
    issues.push({
      check: "font-fallback",
      severity: "warning",
      layerId: m.id,
      message: `Font "${m.fontFamily}" ${layer?.fontWeight ?? ""} did not load; a fallback font was used for rendering.`,
      measured: { fontFamily: m.fontFamily ?? "", fontWeight: layer?.fontWeight ?? 0 },
    });
  }

  // brand-color / brand-font
  const brand = opts.brand;
  const brandColors = (brand?.colors ?? []).map((c) => c.hex).filter((h) => parseHex(h));
  if (brand && brand.colors.some((c) => c.lock === "locked") && brandColors.length) {
    run("brand-color");
    const seen = new Set<string>();
    const checkColor = (hex: string, layerId: string | null, what: string) => {
      const c = parseHex(hex);
      if (!c || c.a === 0 || chroma(c) < NEUTRAL_CHROMA) return;
      const key = `${layerId}|${hex.toUpperCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const nearest = brandColors.reduce(
        (best, b) => {
          const d = deltaE76(c, b);
          return d < best.d ? { hex: b, d } : best;
        },
        { hex: "", d: Infinity },
      );
      if (nearest.d >= BRAND_DELTA_E) {
        issues.push({
          check: "brand-color",
          severity: "warning",
          layerId,
          message: `${what} ${hex.toUpperCase()} is not in the brand palette (nearest ${nearest.hex.toUpperCase()}, ΔE ${r2(nearest.d)}).`,
          measured: { color: hex.toUpperCase(), nearestBrand: nearest.hex.toUpperCase(), deltaE: r2(nearest.d) },
        });
      }
    };
    const fillColors = (f: DesignDocument["artboard"]["background"] | null) =>
      !f ? [] : f.type === "solid" ? [f.color] : f.stops.map((s) => s.color);
    fillColors(doc.artboard.background).forEach((c) => checkColor(c, null, "Background colour"));
    for (const l of doc.layers) {
      if (!l.visible) continue;
      if (l.type === "text") checkColor(l.color, l.id, "Text colour");
      if (l.type === "shape") {
        fillColors(l.fill).forEach((c) => checkColor(c, l.id, "Shape fill"));
        if (l.stroke) checkColor(l.stroke, l.id, "Shape stroke");
      }
    }
  }
  const lockedFonts = (brand?.fonts ?? []).filter((f) => f.lock === "locked").map((f) => f.family.trim().toLowerCase());
  if (lockedFonts.length) {
    run("brand-font");
    for (const l of doc.layers) {
      if (l.type !== "text" || !l.visible || lockedFonts.includes(l.fontFamily.toLowerCase())) continue;
      issues.push({
        check: "brand-font",
        severity: "warning",
        layerId: l.id,
        message: `Font "${l.fontFamily}" is not one of the locked brand fonts (${brand!.fonts.filter((f) => f.lock === "locked").map((f) => f.family).join(", ")}).`,
        measured: { fontFamily: l.fontFamily },
      });
    }
  }

  return {
    passed: !issues.some((i) => i.severity === "error"),
    checkedAt: new Date().toISOString(),
    artboard: { width: W, height: H },
    issues,
    checksRun,
  };
}

interface RegionStats {
  mean: Rgba;
  darkest: Rgba; // mean of the darkest 10% of pixels
  lightest: Rgba; // mean of the lightest 10%
}

/** Scan (at most ~40k samples of) a region of a raw RGB(A) buffer. */
function sampleRegion(data: Buffer, iw: number, ih: number, ch: number, box: LayerMeasurement["box"]): RegionStats | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(iw, Math.ceil(box.x + box.w));
  const y1 = Math.min(ih, Math.ceil(box.y + box.h));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40_000)));
  const px: { c: Rgba; l: number }[] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * iw + x) * ch;
      const c = { r: data[i], g: data[i + 1], b: data[i + 2], a: 1 };
      px.push({ c, l: relativeLuminance(c) });
    }
  }
  px.sort((a, b) => a.l - b.l);
  const avg = (arr: { c: Rgba }[]): Rgba => {
    const s = arr.reduce((acc, p) => ({ r: acc.r + p.c.r, g: acc.g + p.c.g, b: acc.b + p.c.b }), { r: 0, g: 0, b: 0 });
    return { r: s.r / arr.length, g: s.g / arr.length, b: s.b / arr.length, a: 1 };
  };
  const k = Math.max(1, Math.round(px.length * 0.1));
  return { mean: avg(px), darkest: avg(px.slice(0, k)), lightest: avg(px.slice(-k)) };
}

function contrastIssues(layer: TextLayer, s: RegionStats): QaIssue[] {
  const large = layer.fontSize >= 24 || (layer.fontSize >= 18.66 && layer.fontWeight >= 700);
  const threshold = large ? 3 : 4.5;
  // Text colour alpha and layer opacity are composited over each background sample.
  const ratioOn = (bg: Rgba) => contrastRatio(compositeOver(layer.color, bg, layer.opacity), bg);
  const mean = ratioOn(s.mean);
  const worst = Math.min(ratioOn(s.darkest), ratioOn(s.lightest));
  const measured = {
    ratio: r2(mean),
    worstRatio: r2(worst),
    threshold,
    textColor: layer.color.toUpperCase(),
    background: toHex(s.mean),
    fontSize: layer.fontSize,
  };
  if (mean < threshold) {
    return [{
      check: "contrast",
      severity: "error",
      layerId: layer.id,
      message: `Contrast ${r2(mean)}:1 against the background is below the ${threshold}:1 minimum for ${large ? "large" : "small"} text.`,
      measured,
    }];
  }
  if (worst < threshold) {
    return [{
      check: "contrast",
      severity: "warning",
      layerId: layer.id,
      message: `Average contrast is ${r2(mean)}:1, but parts of the background drop to ${r2(worst)}:1 (minimum ${threshold}:1).`,
      measured,
    }];
  }
  return [];
}
