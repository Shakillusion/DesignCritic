import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyEditOps, describeDocument, type EditOp, type LayerChanges } from "@/lib/design-engine/edit-ops";
import { buildRebuiltDocument, shrinkOverflowingText, toPixels } from "@/lib/design-engine/rebuild";
import { pickFont, type Reconstruction } from "@/agents/reconstructor";
import type { DesignDocument } from "@/lib/design-engine/schema";
import { addChatMessage, createProject, listChatMessages } from "@/lib/database/repo";
import { useTestDb } from "./fixtures";

const none: LayerChanges = Object.fromEntries(
  ["name", "x", "y", "width", "height", "rotation", "opacity", "visible", "text", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "color", "align", "verticalAlign", "textTransform", "italic", "fit", "focalX", "focalY", "brightness", "contrast", "saturation", "fill", "stroke", "strokeWidth", "borderRadius"].map((k) => [k, null]),
) as LayerChanges;

const doc: DesignDocument = {
  schemaVersion: 1,
  name: "Poster",
  format: { kind: "poster", preset: "poster-digital" },
  artboard: { width: 1200, height: 1800, background: { type: "solid", color: "#FFFFFF" }, print: null },
  layers: [
    { id: "photo", name: "Photo", type: "image", assetId: "ast_aaaaaaaaaaaaaaaa", x: 0, y: 0, width: 1200, height: 1800, rotation: 0, opacity: 1, locked: true, visible: true, fit: "cover", focalX: 0.5, focalY: 0.5, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 },
    { id: "headline", name: "Headline", type: "text", role: "headline", text: "Swiss Summer", x: 80, y: 120, width: 900, height: 200, rotation: 0, opacity: 1, locked: false, visible: true, fontFamily: "Inter", fontWeight: 700, fontSize: 92, lineHeight: 1, letterSpacing: 0, color: "#111111", align: "left", verticalAlign: "top", textTransform: "none", italic: false },
    { id: "cta-bg", name: "CTA", type: "shape", shape: "rect", x: 80, y: 1500, width: 300, height: 60, rotation: 0, opacity: 1, locked: false, visible: true, fill: { type: "solid", color: "#FFFFFF" }, stroke: null, strokeWidth: 0, borderRadius: 30, blendMode: "normal" },
  ],
  metadata: { concept: "c", rationale: "r", fontsUsed: ["Inter"] },
};
const known = new Set(["ast_aaaaaaaaaaaaaaaa"]);

describe("edit operations", () => {
  it("applies targeted updates and records exactly which fields changed", () => {
    const ops: EditOp[] = [{ op: "update", layerId: "headline", findingId: "f1", reason: "stronger", changes: { ...none, fontSize: 110, height: 240, color: "#111111" } }];
    const r = applyEditOps(doc, ops, { knownAssetIds: known });
    expect(r.applied).toEqual([{ findingId: "f1", layerId: "headline", op: "update", reason: "stronger", fields: ["height", "fontSize"] }]);
    const h = r.doc.layers.find((l) => l.id === "headline")!;
    expect(h.type === "text" && [h.fontSize, h.height]).toEqual([110, 240]);
    // Untouched layers are identical.
    expect(r.doc.layers.find((l) => l.id === "cta-bg")).toEqual(doc.layers[2]);
    // The input document isn't mutated.
    expect(doc.layers[1].type === "text" && doc.layers[1].fontSize).toBe(92);
  });

  it("refuses locked layers, unknown layers, wrong-type fields and unknown assets", () => {
    const ops: EditOp[] = [
      { op: "update", layerId: "photo", findingId: null, reason: "x", changes: { ...none, brightness: 1.2 } },
      { op: "remove", layerId: "photo", findingId: null, reason: "x" },
      { op: "update", layerId: "ghost", findingId: null, reason: "x", changes: { ...none, x: 1 } },
      { op: "update", layerId: "cta-bg", findingId: null, reason: "x", changes: { ...none, fontSize: 40 } },
      { op: "add", findingId: null, reason: "x", placeAboveLayerId: null, layer: { ...(doc.layers[0] as Extract<DesignDocument["layers"][number], { type: "image" }>), id: "other-photo", assetId: "ast_bbbbbbbbbbbbbbbb", locked: false } },
    ];
    const r = applyEditOps(doc, ops, { knownAssetIds: known });
    expect(r.applied).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "“Photo” is locked",
      "“Photo” is locked",
      "No layer “ghost”",
      "fontSize don't apply to a shape layer",
      "Image layers can only use assets already in this project",
    ]);
    expect(r.doc.layers).toHaveLength(3);
  });

  it("adds layers at the requested depth, removes and reorders", () => {
    const scrim = { id: "scrim", name: "Scrim", type: "shape" as const, shape: "rect" as const, x: 0, y: 0, width: 1200, height: 500, rotation: 0, opacity: 1, locked: true, visible: true, fill: { type: "solid" as const, color: "#FFFFFF99" }, stroke: null, strokeWidth: 0, borderRadius: 0, blendMode: "normal" as const };
    const r = applyEditOps(
      doc,
      [
        { op: "add", findingId: "f1", reason: "legibility", placeAboveLayerId: "photo", layer: scrim },
        { op: "remove", layerId: "cta-bg", findingId: "f3", reason: "editorial" },
        { op: "reorder", layerId: "headline", findingId: null, reason: "x", position: "back", relativeToLayerId: null },
      ],
      { knownAssetIds: known },
    );
    expect(r.doc.layers.map((l) => l.id)).toEqual(["headline", "photo", "scrim"]);
    expect(r.doc.layers.find((l) => l.id === "scrim")!.locked).toBe(false); // agent-added layers start unlocked
    expect(r.applied.map((a) => a.op)).toEqual(["add", "remove", "reorder"]);
  });

  it("describes documents with ids, lock state and styling for the models", () => {
    const d = describeDocument(doc);
    expect(d).toContain('id="photo"');
    expect(d).toContain("LOCKED");
    expect(d).toContain('text="Swiss Summer"');
  });
});

describe("rebuild", () => {
  const recon: Reconstruction = {
    backgroundColor: "#F3EFE6",
    textBlocks: [
      { x: 0.065, y: 0.575, width: 0.54, height: 0.168, text: "FARMERS\nMARKET", role: "headline", fontStyle: "sans", fontGuess: "Space Grotesk", fontWeight: 700, color: "#1D1D1D", align: "left", uppercase: true, italic: false },
      { x: 0.7, y: 0.93, width: 0.25, height: 0.02, text: "freshlocal.example", role: "label", fontStyle: "sans", fontGuess: "Helvetica", fontWeight: 400, color: "#B9B3A7", align: "left", uppercase: false, italic: false },
    ],
    imageRegions: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.2, description: "Photo of apples" }],
    shapes: [{ x: 0.065, y: 0.052, width: 0.87, height: 0.474, shape: "rect", color: "#2F6F5E", opacity: 1, borderRadius: 0 }],
    notes: "",
  };

  it("converts normalised boxes to pixels, clamped to the artboard", () => {
    expect(toPixels({ x: 0.5, y: 0.5, width: 0.8, height: 0.2 }, 1000, 1000)).toEqual({ x: 500, y: 500, width: 500, height: 200 });
    expect(toPixels({ x: -1, y: 2, width: 0.1, height: 0.1 }, 1000, 1000)).toEqual({ x: 0, y: 1000, width: 100, height: 1 });
  });

  it("builds editable layers with box-derived font sizes and real fonts", () => {
    const d = buildRebuiltDocument(recon, { width: 1080, height: 1350 }, [{ assetId: "ast_cccccccccccccccc", index: 0 }], pickFont, "Rebuilt");
    expect(d.layers.map((l) => l.type)).toEqual(["image", "shape", "text", "text"]);
    const headline = d.layers.find((l) => l.id === "headline-1")!;
    expect(headline.type === "text" && headline.fontFamily).toBe("Space Grotesk");
    // 2 lines in a 227px box at 1.05 leading → ~108px type.
    expect(headline.type === "text" && headline.fontSize).toBeGreaterThan(95);
    const label = d.layers.find((l) => l.id === "label-2")!;
    expect(label.type === "text" && label.fontFamily).toBe("Inter"); // Helvetica isn't available → sans stand-in
    expect(d.artboard.background).toEqual({ type: "solid", color: "#F3EFE6" });
  });

  it("shrinks overflowing text proportionally, bounded", () => {
    const d = buildRebuiltDocument(recon, { width: 1080, height: 1350 }, [], pickFont, "Rebuilt");
    const before = d.layers.find((l) => l.id === "headline-1")!;
    const next = shrinkOverflowingText(d, [{ layerId: "headline-1", contentHeight: 300, boxHeight: 250 }])!;
    const after = next.layers.find((l) => l.id === "headline-1")!;
    expect(before.type === "text" && after.type === "text" && after.fontSize / before.fontSize).toBeCloseTo(0.83, 1);
    expect(shrinkOverflowingText(d, [])).toBeNull();
  });
});

describe("assistant chat store", () => {
  beforeEach(() => useTestDb());
  it("keeps conversations per project and design, oldest first", () => {
    const p = createProject("local-user", { name: "P" });
    addChatMessage("local-user", { projectId: p.id, designId: null, role: "user", content: "project-level" });
    addChatMessage("local-user", { projectId: p.id, designId: "dsn_aaaaaaaaaaaaaaaa", role: "user", content: "about design A" });
    addChatMessage("local-user", { projectId: p.id, designId: "dsn_bbbbbbbbbbbbbbbb", role: "user", content: "about design B" });
    const a = listChatMessages("local-user", p.id, "dsn_aaaaaaaaaaaaaaaa");
    expect(a.map((m) => m.content)).toEqual(["project-level", "about design A"]);
    expect(() => listChatMessages("someone-else", p.id, null)).toThrow();
  });
});

describe("assistant action whitelist", () => {
  beforeEach(() => {
    useTestDb();
    process.env.GEMINI_API_KEY = "g";
  });
  it("downgrades actions that aren't available to 'none'", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/models?")
            ? { models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }] }
            : { candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Done!", action: { type: "variations", instruction: "wild", count: 3 } }) }] }, finishReason: "STOP" }] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { assistantTurn } = await import("@/agents/assistant");
    const t = await assistantTurn({
      userId: "local-user",
      message: "give me variations",
      context: { projectName: "P", projectDescription: "", brandRules: "none", design: null, critique: null, history: [], allowedActions: ["none"] },
    });
    expect(t.action).toEqual({ type: "none", instruction: null, count: null });
    vi.unstubAllGlobals();
  });
});
