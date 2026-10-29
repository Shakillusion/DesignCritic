import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderDesignHtml, type ResolvedAsset } from "@/lib/design-engine/render-html";
import { closeRenderer, findBrowserExecutable, measureLayers, renderToPdf, renderToPng } from "@/lib/design-engine/renderer";
import { inspectDesign } from "@/agents/qa-inspector";
import type { DesignDocument } from "@/lib/design-engine/schema";

const browser = (() => {
  try {
    return findBrowserExecutable();
  } catch {
    return null;
  }
})();

const base = { rotation: 0, opacity: 1, locked: false, visible: true };
const textBase = {
  ...base,
  type: "text" as const,
  fontFamily: "Inter",
  fontWeight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "left" as const,
  verticalAlign: "top" as const,
  textTransform: "none" as const,
  italic: false,
};

const doc: DesignDocument = {
  schemaVersion: 1,
  name: "Renderer test",
  format: { kind: "social", preset: "custom" },
  artboard: { width: 400, height: 300, background: { type: "solid", color: "#FFFFFF" }, print: null },
  layers: [
    { ...base, id: "dot", name: "Dot", type: "shape", x: 360, y: 15, width: 24, height: 24, shape: "ellipse", fill: { type: "solid", color: "#1A1816" }, stroke: null, strokeWidth: 0, borderRadius: 0, blendMode: "normal" },
    { ...base, id: "photo", name: "Photo", type: "image", x: 50, y: 60, width: 300, height: 200, assetId: "tiny", fit: "cover", focalX: 0.5, focalY: 0.5, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 },
    { ...textBase, id: "overflow", name: "Overflow", role: "body", x: 20, y: 15, width: 120, height: 30, fontSize: 14, color: "#111111", text: "This is a deliberately long sentence that cannot possibly fit inside such a small box." },
    { ...textBase, id: "faint", name: "Faint", role: "caption", x: 20, y: 266, width: 300, height: 20, fontSize: 14, color: "#EEEEEE", text: "Barely visible" },
  ],
  metadata: { concept: "", rationale: "", fontsUsed: ["Inter"] },
};

describe.skipIf(!browser)("renderer + QA (system browser)", () => {
  let asset: ResolvedAsset;
  beforeAll(async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 200, g: 60, b: 40 } } }).png().toBuffer();
    asset = { src: `data:image/png;base64,${png.toString("base64")}`, width: 50, height: 50 };
  });
  afterAll(() => closeRenderer());
  const resolveAsset = (id: string) => (id === "tiny" ? asset : null);
  const html = () => renderDesignHtml(doc, { resolveAsset, mode: "export" });

  it("renders a PNG at the artboard size (and scale)", async () => {
    const t = Date.now();
    const png = await renderToPng(html(), { width: 400, height: 300 });
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 400, 300]);
    const hi = await sharp(await renderToPng(html(), { width: 400, height: 300, scale: 2 })).metadata();
    expect([hi.width, hi.height]).toEqual([800, 600]);
    console.log(`png render x2: ${Date.now() - t}ms (incl. browser launch)`);
  });

  it("renders a PDF", async () => {
    const pdf = await renderToPdf(html(), { width: 400, height: 300 });
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("measures layers", async () => {
    const m = await measureLayers(html(), { width: 400, height: 300 });
    expect(m.map((l) => l.id)).toEqual(["dot", "photo", "overflow", "faint"]);
    const photo = m.find((l) => l.id === "photo")!;
    expect([photo.naturalWidth, photo.naturalHeight, photo.missingAsset]).toEqual([50, 50, false]);
    expect(photo.box).toEqual({ x: 50, y: 60, w: 300, h: 200 });
  });

  it("reports text-overflow, contrast and low-resolution on the right layers", async () => {
    const t = Date.now();
    const report = await inspectDesign(doc, { resolveAsset, expected: { width: 400, height: 300 } });
    console.log(`inspectDesign: ${Date.now() - t}ms`, JSON.stringify(report.issues.map((i) => [i.check, i.severity, i.layerId, i.measured])));
    const has = (check: string, layerId: string) => report.issues.some((i) => i.check === check && i.layerId === layerId && i.severity === "error");
    expect(has("text-overflow", "overflow")).toBe(true);
    expect(has("contrast", "faint")).toBe(true);
    expect(has("low-resolution", "photo")).toBe(true);
    expect(report.issues.some((i) => i.check === "contrast" && i.layerId === "overflow")).toBe(false);
    expect(report.issues.some((i) => i.check === "text-overflow" && i.layerId === "faint")).toBe(false);
    expect(report.issues.some((i) => i.check === "dimensions" || i.check === "missing-asset")).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.checksRun).toEqual(expect.arrayContaining(["text-overflow", "contrast", "low-resolution", "safe-margin"]));
  });
});
