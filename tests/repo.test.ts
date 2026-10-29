import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  createBrand,
  createCritique,
  createProject,
  deleteProject,
  getBrand,
  getCritique,
  getPreferences,
  getProject,
  insertAsset,
  insertFile,
  listBrandChanges,
  listProjects,
  NotFoundError,
  setPreferences,
  updateBrand,
  updateCritique,
  updateProject,
  deleteAsset,
  addDesignVersion,
  createDesign,
  listVersions,
} from "@/lib/database/repo";
import { getDb, LOCAL_USER_ID } from "@/lib/database/db";
import type { DesignDocument } from "@/lib/design-engine/schema";
import { useTestDb } from "./fixtures";

const U = LOCAL_USER_ID;
const OTHER = "other-user";

beforeEach(async () => {
  await useTestDb();
  await getDb().prepare("INSERT INTO users (id, name, created_at) VALUES (?, 'Other', ?)").run(OTHER, new Date().toISOString());
});

const file = async (projectId: string | null, brandId: string | null = null) =>
  await insertFile(U, { projectId, brandId, kind: "upload", originalName: "poster.png", mime: "image/png", size: 10, width: 900, height: 1200, storagePath: `x/${Math.random()}.png`, sha256: "abc" });

describe("projects", () => {
  it("creates, lists with counts, renames and deletes", async () => {
    const p = await createProject(U, { name: "Alpine Rail", description: "Summer campaign" });
    expect((await getProject(U, p.id)).name).toBe("Alpine Rail");
    await updateProject(U, p.id, { name: "Alpine Rail 2026" });
    const list = await listProjects(U);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Alpine Rail 2026", critiqueCount: 0, designCount: 0 });
    const f = await file(p.id);
    await createCritique(U, { projectId: p.id, fileId: f.id, brandId: null, title: "v1", model: "claude-opus-5-5", context: {}, technical: null });
    expect((await listProjects(U))[0].critiqueCount).toBe(1);
    expect((await listProjects(U))[0].coverFileId).toBe(f.id);
    const paths = await deleteProject(U, p.id);
    expect(paths).toHaveLength(1);
    await expect(getProject(U, p.id)).rejects.toThrow(NotFoundError);
  });

  it("isolates projects between users", async () => {
    const p = await createProject(U, { name: "Mine" });
    await expect(getProject(OTHER, p.id)).rejects.toThrow(NotFoundError);
    expect(await listProjects(OTHER)).toHaveLength(0);
    await expect(updateProject(OTHER, p.id, { name: "Hijack" })).rejects.toThrow(NotFoundError);
  });

  it("refuses to attach another user's brand", async () => {
    const b = await createBrand(OTHER, { name: "Theirs" });
    await expect(createProject(U, { name: "X", brandId: b.id })).rejects.toThrow(NotFoundError);
  });
});

describe("brands", () => {
  it("persists rules with lock levels and records history", async () => {
    const b = await createBrand(U, { name: "Alpine Rail" });
    await updateBrand(U, b.id, {
      colors: [{ name: "Glacier", hex: "#1F4E79", role: "primary", lock: "locked" }],
      typography: [{ role: "display", family: "Fraunces", weights: "600", notes: "", lock: "flexible" }],
      restrictions: [{ text: "Never place the logo on busy photography", lock: "locked" }],
    });
    const fresh = await getBrand(U, b.id);
    expect(fresh.colors[0]).toMatchObject({ hex: "#1F4E79", lock: "locked" });
    expect(fresh.typography[0].lock).toBe("flexible");
    const history = await listBrandChanges(U, b.id);
    expect(history.map((h) => h.summary).sort()).toEqual(["Brand profile created", "Updated colors, typography, restrictions"]);
    // A no-op update records nothing new.
    await updateBrand(U, b.id, { name: "Alpine Rail" });
    expect(await listBrandChanges(U, b.id)).toHaveLength(history.length);
  });
});

describe("critiques", () => {
  it("stores results and decisions", async () => {
    const p = await createProject(U, { name: "P" });
    const c = await createCritique(U, { projectId: p.id, fileId: (await file(p.id)).id, brandId: null, title: "t", model: "claude-opus-5-5", context: { purpose: "sell tickets" }, technical: null });
    expect(c.status).toBe("queued");
    await updateCritique(U, c.id, { status: "succeeded", overallScore: 71, decisions: { f1: "accepted" } });
    const again = await getCritique(U, c.id);
    expect(again).toMatchObject({ status: "succeeded", overallScore: 71, decisions: { f1: "accepted" }, context: { purpose: "sell tickets" } });
    await expect(getCritique(OTHER, c.id)).rejects.toThrow(NotFoundError);
  });
});

describe("assets and versions", () => {
  const doc = (assetId: string): DesignDocument => ({
    schemaVersion: 1,
    name: "Poster",
    format: { kind: "poster", preset: "poster-digital" },
    artboard: { width: 1200, height: 1800, background: { type: "solid", color: "#FFFFFF" }, print: null },
    layers: [{ id: "photo", name: "Photo", type: "image", assetId, x: 0, y: 0, width: 1200, height: 1800, rotation: 0, opacity: 1, locked: false, visible: true, fit: "cover", focalX: 0.5, focalY: 0.5, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 }],
    metadata: { concept: "", rationale: "", fontsUsed: [] },
  });

  it("tracks usage and blocks removing used or locked assets", async () => {
    const p = await createProject(U, { name: "P" });
    const f = await file(p.id);
    const a = await insertAsset(U, { projectId: p.id, fileId: f.id, type: "photo", source: "provider", provider: "wikimedia", providerId: "1", title: "Alps", creator: "Jane", creatorUrl: null, sourceUrl: "https://commons.wikimedia.org/x", license: { code: "cc-by", name: "CC BY 4.0", url: null, commercialUse: true, modificationAllowed: true, attributionRequired: true, shareAlike: false, notes: null }, attribution: "Alps by Jane", status: "approved", locked: false, analysis: {}, retrievedAt: new Date().toISOString() });
    const d = await createDesign(U, { projectId: p.id, name: "Poster", brief: {} });
    const v1 = await addDesignVersion(U, d.id, { document: doc(a.id), changeSummary: "Generated", createdBy: "agent", assetIds: [a.id] });
    const v2 = await addDesignVersion(U, d.id, { document: doc(a.id), changeSummary: "Edit", createdBy: "user", assetIds: [a.id] });
    expect([v1.number, v2.number]).toEqual([1, 2]);
    expect(v2.parentVersionId).toBe(v1.id);
    expect((await listVersions(U, d.id)).map((v) => v.number)).toEqual([2, 1]);
    await expect(deleteAsset(U, a.id)).rejects.toThrow(ConflictError);
  });
});

describe("preferences", () => {
  it("merges partial updates over defaults", async () => {
    expect((await getPreferences(U)).aiProvider).toBe("gemini");
    await setPreferences(U, { critiqueStrictness: "strict" });
    expect(await getPreferences(U)).toMatchObject({ critiqueStrictness: "strict", assetMode: "automatic" });
  });
});
