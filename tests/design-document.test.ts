import { describe, expect, it } from "vitest";
import { assetIdsInDocument, DesignDocument, normalizeDocument, type DesignDocument as Doc } from "@/lib/design-engine/schema";

const base: Doc = {
  schemaVersion: 1,
  name: "Test",
  format: { kind: "social", preset: "instagram-post" },
  artboard: { width: 1080, height: 1350, background: { type: "solid", color: "#ffffff" }, print: null },
  layers: [
    { id: "headline", name: "Headline", type: "text", role: "headline", text: "Run the city", x: 80, y: 80, width: 900, height: 300, rotation: 0, opacity: 1.4, locked: false, visible: true, fontFamily: "Comic Sans MS", fontWeight: 680, fontSize: 120, lineHeight: 0.2, letterSpacing: -0.02, color: "red", align: "left", verticalAlign: "top", textTransform: "uppercase", italic: false },
    { id: "headline", name: "Dup id", type: "shape", shape: "rect", x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, fill: { type: "linear", angle: 180, stops: [{ color: "#00000000", position: -20 }, { color: "nope", position: 50 }] }, stroke: "blue", strokeWidth: -2, borderRadius: 0, blendMode: "normal" },
    { id: "photo", name: "Photo", type: "image", assetId: "ast_0123456789abcdef", x: 0, y: 0, width: 1080, height: 1350, rotation: 0, opacity: 1, locked: true, visible: true, fit: "cover", focalX: 1.7, focalY: 0.4, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 },
  ],
  metadata: { concept: "c", rationale: "r", fontsUsed: [] },
};

describe("design document", () => {
  it("validates the schema shape", () => {
    expect(DesignDocument.safeParse(base).success).toBe(true);
    expect(DesignDocument.safeParse({ ...base, layers: [{ ...base.layers[0], type: "video" }] }).success).toBe(false);
  });

  it("normalises unsafe values without changing intent", () => {
    const d = normalizeDocument(base);
    const [t, s, img] = d.layers;
    expect(t.type === "text" && [t.fontFamily, t.fontWeight, t.lineHeight, t.opacity, t.color]).toEqual(["Inter", 700, 0.6, 1, "#111111"]);
    expect(s.id).not.toBe("headline");
    expect(s.type === "shape" && s.fill).toEqual({ type: "solid", color: "#00000000" });
    expect(s.type === "shape" && [s.stroke, s.strokeWidth]).toEqual([null, 0]);
    expect(img.type === "image" && img.focalX).toBe(1);
    expect(d.metadata.fontsUsed).toEqual(["Inter"]);
    expect(assetIdsInDocument(d)).toEqual(["ast_0123456789abcdef"]);
    // The input is not mutated.
    expect(base.layers[0].type === "text" && base.layers[0].fontFamily).toBe("Comic Sans MS");
  });
});
