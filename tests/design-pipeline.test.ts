import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDesignVersion, createDesign, createProject, getAsset, insertAsset, listVersions } from "@/lib/database/repo";
import { closeRenderer, findBrowserExecutable } from "@/lib/design-engine/renderer";
import type { DesignDocument } from "@/lib/design-engine/schema";
import { exportDesign, restoreVersion, saveUserVersion } from "@/lib/services/design";
import { saveFile } from "@/lib/storage/storage";
import { landscapeJpeg, useTestDb } from "./fixtures";

const U = "local-user";
const browser = (() => {
  try {
    return findBrowserExecutable();
  } catch {
    return null;
  }
})();

describe.skipIf(!browser)("design pipeline (real renderer)", () => {
  let designId = "";
  let v1 = "";
  let assetId = "";

  beforeAll(async () => {
    useTestDb();
    const p = createProject(U, { name: "Switzerland" });
    const photo = await landscapeJpeg(2400, 1600);
    const f = await saveFile(U, photo, { projectId: p.id, kind: "asset-original", originalName: "alps.jpg", mime: "image/jpeg", width: 2400, height: 1600 });
    assetId = insertAsset(U, { projectId: p.id, fileId: f.id, type: "photo", source: "upload", provider: null, providerId: null, title: "Alps", creator: null, creatorUrl: null, sourceUrl: null, license: { code: "user-provided", name: "Provided by you", url: null, commercialUse: null, modificationAllowed: null, attributionRequired: false, shareAlike: false, notes: null }, attribution: null, status: "approved", locked: false, analysis: {}, retrievedAt: null }).id;
    const doc: DesignDocument = {
      schemaVersion: 1,
      name: "Switzerland poster",
      format: { kind: "poster", preset: "poster-digital" },
      artboard: { width: 600, height: 900, background: { type: "solid", color: "#0E1A24" }, print: null },
      layers: [
        { id: "photo", name: "Photo", type: "image", assetId, x: 0, y: 0, width: 600, height: 900, rotation: 0, opacity: 1, locked: true, visible: true, fit: "cover", focalX: 0.45, focalY: 0.4, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 },
        { id: "scrim", name: "Scrim", type: "shape", shape: "rect", x: 0, y: 0, width: 600, height: 380, rotation: 0, opacity: 1, locked: false, visible: true, fill: { type: "linear", angle: 180, stops: [{ color: "#0E1A24CC", position: 0 }, { color: "#0E1A2400", position: 100 }] }, stroke: null, strokeWidth: 0, borderRadius: 0, blendMode: "normal" },
        { id: "headline", name: "Headline", type: "text", role: "headline", text: "Switzerland", x: 48, y: 56, width: 504, height: 120, rotation: 0, opacity: 1, locked: false, visible: true, fontFamily: "Inter", fontWeight: 700, fontSize: 84, lineHeight: 1, letterSpacing: -0.02, color: "#FFFFFF", align: "left", verticalAlign: "top", textTransform: "none", italic: false },
      ],
      metadata: { concept: "Quiet grandeur", rationale: "Calm sky for type", fontsUsed: ["Inter"] },
    };
    const d = createDesign(U, { projectId: p.id, name: "Switzerland poster", brief: {} });
    designId = d.id;
    v1 = addDesignVersion(U, d.id, { document: doc, changeSummary: "Generated", createdBy: "agent", assetIds: [assetId] }).id;
  });

  afterAll(async () => {
    await closeRenderer();
  });

  it("saves an edit as a new rendered, QA-checked version that uses the asset", async () => {
    const base = listVersions(U, designId).find((v) => v.id === v1)!;
    const edited = { ...base.document, layers: base.document.layers.map((l) => (l.id === "headline" && l.type === "text" ? { ...l, text: "Switzerland\nawaits", height: 200 } : l)) };
    const v2 = await saveUserVersion(U, designId, { document: edited, changeSummary: "Two-line headline", baseVersionId: v1 });
    expect(v2.number).toBe(2);
    expect(v2.renderFileId).toBeTruthy();
    expect(v2.qa?.checksRun.length).toBeGreaterThan(3);
    expect(v2.qa?.issues.find((i) => i.check === "missing-asset")).toBeUndefined();
    expect(getAsset(U, assetId).usageCount).toBe(2);
  });

  it("refuses to change a locked layer", async () => {
    const base = listVersions(U, designId).find((v) => v.id === v1)!;
    const tampered = { ...base.document, layers: base.document.layers.map((l) => (l.id === "photo" ? { ...l, x: 40 } : l)) };
    await expect(saveUserVersion(U, designId, { document: tampered, changeSummary: "Move photo", baseVersionId: v1 })).rejects.toThrow(/locked/);
    const removed = { ...base.document, layers: base.document.layers.filter((l) => l.id !== "photo") };
    await expect(saveUserVersion(U, designId, { document: removed, changeSummary: "Drop photo", baseVersionId: v1 })).rejects.toThrow(/locked/);
  });

  it("restores by creating a new version, never rewriting history", async () => {
    const v = await restoreVersion(U, designId, v1);
    expect(v.number).toBe(3);
    expect(v.changeSummary).toBe("Restored version 1");
    expect(listVersions(U, designId)).toHaveLength(3);
  });

  it("exports PNG at exact size, @2x, JPG, PDF and standalone HTML", async () => {
    const png = await exportDesign(U, v1, "png", 1);
    expect(await sharp(png.body as Buffer).metadata()).toMatchObject({ width: 600, height: 900, format: "png" });
    const png2 = await exportDesign(U, v1, "png", 2);
    expect((await sharp(png2.body as Buffer).metadata()).width).toBe(1200);
    const jpg = await exportDesign(U, v1, "jpg", 1);
    expect((await sharp(jpg.body as Buffer).metadata()).format).toBe("jpeg");
    const pdf = await exportDesign(U, v1, "pdf", 1);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const html = await exportDesign(U, v1, "html", 1);
    expect(html.body).toContain("data:image/jpeg;base64,");
    expect(html.body).not.toContain("<script");
    // The photo really is in the render: the top-left area is not the flat background colour.
    const { data } = await sharp(png.body as Buffer).extract({ left: 20, top: 500, width: 40, height: 40 }).raw().toBuffer({ resolveWithObject: true });
    const isBackground = data[0] === 0x0e && data[1] === 0x1a && data[2] === 0x24;
    expect(isBackground).toBe(false);
  });
});
