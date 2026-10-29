/** Pure colour maths for QA (WCAG 2.x luminance/contrast, CIE76 ΔE). No browser needed. */

export interface Rgba {
  r: number; // 0–255
  g: number;
  b: number;
  a: number; // 0–1
}

export function parseHex(hex: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const toRgb = (c: string | Rgba): Rgba => {
  if (typeof c !== "string") return c;
  const p = parseHex(c);
  if (!p) throw new Error(`Invalid hex colour: ${c}`);
  return p;
};

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance (alpha ignored), 0–1. */
export function relativeLuminance(c: string | Rgba): number {
  const { r, g, b } = toRgb(c);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastFromLuminance(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast ratio, 1–21. Alpha is ignored; composite first with `compositeOver`. */
export function contrastRatio(a: string | Rgba, b: string | Rgba): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** Source-over compositing of `fg` (with extra opacity multiplier) onto an opaque `bg`, in sRGB like browsers. */
export function compositeOver(fg: string | Rgba, bg: string | Rgba, opacity = 1): Rgba {
  const f = toRgb(fg);
  const k = toRgb(bg);
  const a = Math.max(0, Math.min(1, f.a * opacity));
  return { r: f.r * a + k.r * (1 - a), g: f.g * a + k.g * (1 - a), b: f.b * a + k.b * (1 - a), a: 1 };
}

/** sRGB → CIE L*a*b* (D65). */
export function rgbToLab(c: string | Rgba): { L: number; a: number; b: number } {
  const { r, g, b } = toRgb(c);
  const [R, G, B] = [channel(r), channel(g), channel(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 colour difference. ~2.3 is a just-noticeable difference. */
export function deltaE76(c1: string | Rgba, c2: string | Rgba): number {
  const a = rgbToLab(c1);
  const b = rgbToLab(c2);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** Chroma C*ab; low values are near-neutral greys. */
export function chroma(c: string | Rgba): number {
  const { a, b } = rgbToLab(c);
  return Math.hypot(a, b);
}

export const toHex = (c: Rgba): string =>
  "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
