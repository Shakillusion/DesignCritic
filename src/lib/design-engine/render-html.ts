import { ALLOWED_FONTS, type DesignDocument, type Fill, type ImageLayer, type Layer, type ShapeLayer, type TextLayer } from "./schema";

/**
 * DesignDocument → standalone HTML. Pure string building (no DOM / Node APIs),
 * so the same markup drives the in-app preview iframe and the headless
 * export/QA renderer. Never emits <script>.
 */

export interface ResolvedAsset {
  src: string;
  width: number | null;
  height: number | null;
}

export interface RenderHtmlOptions {
  resolveAsset: (assetId: string) => ResolvedAsset | null;
  mode: "preview" | "export";
  /** Hide all text layers (visibility:hidden) — used by QA to sample backgrounds. */
  hideText?: boolean;
  hideLayerIds?: string[];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Escape for both HTML text and (double- or single-quoted) attribute contexts. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const num = (v: number, fallback = 0): number => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : fallback);
const color = (c: string | null | undefined, fallback = "transparent"): string => (c && HEX.test(c) ? c : fallback);
/** Font family names are restricted to a safe charset before going into CSS. */
const safeFamily = (f: string): string => f.replace(/[^A-Za-z0-9 \-]/g, "").trim() || "Inter";

/** Only allow URL schemes that make sense for an <img>; anything else becomes a placeholder. */
function safeSrc(src: string): string | null {
  const s = src.trim();
  if (/^data:image\/(png|jpe?g|webp|gif|avif|svg\+xml)[;,]/i.test(s)) return s;
  if (/^(https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return null;
}

export function layerBox(layer: Layer): Box {
  return { x: layer.x, y: layer.y, w: layer.width, h: layer.height };
}

export function fillCss(fill: Fill | null): string {
  if (!fill) return "transparent";
  if (fill.type === "solid") return color(fill.color);
  const stops = fill.stops.map((s) => `${color(s.color)} ${num(s.position)}%`).join(", ");
  return `linear-gradient(${num(fill.angle, 180)}deg, ${stops})`;
}

/** Google Fonts css2 URL covering exactly the families / weights / italics used, or null if no text. */
export function fontsCssUrl(doc: DesignDocument): string | null {
  const used = new Map<string, Set<string>>();
  for (const l of doc.layers) {
    if (l.type !== "text" || !l.visible) continue;
    const meta = ALLOWED_FONTS[l.fontFamily];
    if (!meta) continue;
    const weight = meta.weights.includes(l.fontWeight) ? l.fontWeight : meta.weights[0];
    const ital = l.italic && meta.italic ? 1 : 0;
    const set = used.get(l.fontFamily) ?? new Set<string>();
    set.add(`${ital},${weight}`);
    used.set(l.fontFamily, set);
  }
  if (used.size === 0) return null;
  const families = [...used.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, tuples]) => {
      const sorted = [...tuples]
        .map((t) => t.split(",").map(Number) as [number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const name = encodeURIComponent(family).replace(/%20/g, "+");
      // Google rejects `ital` for families without italics, so only use the ital axis when needed.
      const axis = sorted.some(([i]) => i === 1)
        ? `ital,wght@${sorted.map(([i, w]) => `${i},${w}`).join(";")}`
        : `wght@${sorted.map(([, w]) => w).join(";")}`;
      return `family=${name}:${axis}`;
    });
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=block`;
}

function baseStyle(layer: Layer, z: number, hidden: boolean): string {
  const parts = [
    `left:${num(layer.x)}px`,
    `top:${num(layer.y)}px`,
    `width:${num(layer.width, 1)}px`,
    `height:${num(layer.height, 1)}px`,
    `z-index:${z}`,
    `opacity:${num(layer.opacity, 1)}`,
  ];
  if (layer.rotation) parts.push(`transform:rotate(${num(layer.rotation)}deg)`);
  if (hidden) parts.push("visibility:hidden");
  return parts.join(";");
}

function textHtml(l: TextLayer, style: string): string {
  const family = safeFamily(l.fontFamily);
  const category = ALLOWED_FONTS[l.fontFamily]?.category;
  const generic = category === "serif" ? "serif" : category === "mono" ? "monospace" : "sans-serif";
  const justify = l.verticalAlign === "middle" ? "center" : l.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  const outer = `${style};display:flex;flex-direction:column;justify-content:${justify};overflow:hidden`;
  const inner = [
    `font-family:"${family}", ${generic}`,
    `font-weight:${num(l.fontWeight, 400)}`,
    `font-size:${num(l.fontSize, 16)}px`,
    `line-height:${num(l.lineHeight, 1.2)}`,
    `letter-spacing:${num(l.letterSpacing)}em`,
    `color:${color(l.color, "#111111")}`,
    `text-align:${l.align === "center" || l.align === "right" ? l.align : "left"}`,
    `text-transform:${l.textTransform === "uppercase" || l.textTransform === "lowercase" ? l.textTransform : "none"}`,
    `font-style:${l.italic ? "italic" : "normal"}`,
    l.role === "headline" ? "text-wrap:balance" : "",
  ]
    .filter(Boolean)
    .join(";");
  const body = escapeHtml(l.text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
  return (
    `<div class="l" data-layer-id="${escapeHtml(l.id)}" data-layer-type="text" data-role="${escapeHtml(l.role)}"` +
    ` data-name="${escapeHtml(l.name)}" data-font-family="${escapeHtml(family)}" data-font-weight="${num(l.fontWeight, 400)}"` +
    ` data-font-size="${num(l.fontSize, 16)}" data-font-style="${l.italic ? "italic" : "normal"}" style="${escapeHtml(outer)}">` +
    `<div class="t" style="${escapeHtml(inner)}">${body}</div></div>`
  );
}

function imageHtml(l: ImageLayer, style: string, opts: RenderHtmlOptions): string {
  const asset = opts.resolveAsset(l.assetId);
  const src = asset ? safeSrc(asset.src) : null;
  const radius = `border-radius:${num(l.borderRadius)}px`;
  const attrs = `class="l" data-layer-id="${escapeHtml(l.id)}" data-layer-type="image" data-name="${escapeHtml(l.name)}" data-asset-id="${escapeHtml(l.assetId)}"`;
  if (!asset || !src) {
    const hatch =
      "background:repeating-linear-gradient(45deg,#E8E4DE 0 10px,#D2CCC4 10px 20px);outline:2px dashed #B3261E;outline-offset:-2px;display:flex;align-items:center;justify-content:center";
    const label =
      opts.mode === "preview"
        ? `<span style="font:600 12px/1.2 sans-serif;color:#B3261E;background:#FFFFFF;padding:2px 6px">Missing image</span>`
        : "";
    return `<div ${attrs} data-missing-asset="true" style="${escapeHtml(`${style};${radius};overflow:hidden;${hatch}`)}">${label}</div>`;
  }
  const img = [
    "display:block",
    "width:100%",
    "height:100%",
    `object-fit:${l.fit === "contain" ? "contain" : "cover"}`,
    `object-position:${num(l.focalX * 100, 50)}% ${num(l.focalY * 100, 50)}%`,
    `filter:brightness(${num(l.brightness, 1)}) contrast(${num(l.contrast, 1)}) saturate(${num(l.saturation, 1)})`,
  ].join(";");
  const dims =
    (asset.width ? ` data-asset-width="${num(asset.width)}"` : "") + (asset.height ? ` data-asset-height="${num(asset.height)}"` : "");
  return (
    `<div ${attrs}${dims} style="${escapeHtml(`${style};${radius};overflow:hidden`)}">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(l.name)}" draggable="false" style="${escapeHtml(img)}"></div>`
  );
}

function shapeHtml(l: ShapeLayer, style: string): string {
  const attrs = `class="l" data-layer-id="${escapeHtml(l.id)}" data-layer-type="shape" data-name="${escapeHtml(l.name)}" data-shape="${escapeHtml(l.shape)}"`;
  const blend = `mix-blend-mode:${["multiply", "screen", "overlay", "soft-light"].includes(l.blendMode) ? l.blendMode : "normal"}`;
  if (l.shape === "line") {
    // The layer box is kept as authored; the line is a strokeWidth-tall bar centred vertically in it.
    const lineColor = l.stroke ? color(l.stroke) : l.fill ? fillCss(l.fill) : "#000000";
    const h = Math.max(1, num(l.strokeWidth, 1));
    const bar = `position:absolute;left:0;right:0;top:50%;height:${h}px;margin-top:${-h / 2}px;background:${lineColor}`;
    return `<div ${attrs} style="${escapeHtml(`${style};${blend}`)}"><div style="${escapeHtml(bar)}"></div></div>`;
  }
  const parts = [
    style,
    blend,
    `background:${fillCss(l.fill)}`,
    `border-radius:${l.shape === "ellipse" ? "50%" : `${num(l.borderRadius)}px`}`,
  ];
  if (l.stroke && l.strokeWidth > 0) parts.push(`border:${num(l.strokeWidth)}px solid ${color(l.stroke)}`);
  return `<div ${attrs} style="${escapeHtml(parts.join(";"))}"></div>`;
}

export function renderDesignHtml(doc: DesignDocument, opts: RenderHtmlOptions): string {
  const W = num(doc.artboard.width, 1080);
  const H = num(doc.artboard.height, 1080);
  const hiddenIds = new Set(opts.hideLayerIds ?? []);
  const layers = doc.layers
    .map((layer, i) => {
      if (!layer.visible) return "";
      const hidden = hiddenIds.has(layer.id) || (opts.hideText === true && layer.type === "text");
      const style = baseStyle(layer, i + 1, hidden);
      if (layer.type === "text") return textHtml(layer, style);
      if (layer.type === "image") return imageHtml(layer, style, opts);
      return shapeHtml(layer, style);
    })
    .join("");
  const fonts = fontsCssUrl(doc);
  const css = [
    `@page{size:${W}px ${H}px;margin:0}`,
    `html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent}`,
    `*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    `#artboard{position:relative;width:${W}px;height:${H}px;overflow:hidden;isolation:isolate;background:${fillCss(doc.artboard.background)}}`,
    `.l{position:absolute;transform-origin:50% 50%}`,
    `.t{flex:0 0 auto;width:100%;margin:0;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;font-kerning:normal;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`,
  ].join("\n");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=${W}, initial-scale=1">` +
    `<title>${escapeHtml(doc.name)}</title>` +
    (fonts ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${escapeHtml(fonts)}">` : "") +
    `<style>${css}</style></head><body data-mode="${opts.mode}">` +
    `<div id="artboard" data-width="${W}" data-height="${H}">${layers}</div></body></html>`
  );
}
