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

beforeEach(() => {
  useTestDb();
  getDb().prepare("INSERT INTO users (id, name, created_at) VALUES (?, 'Other', ?)").run(OTHER, new Date().toISOString());
});

const file = (projectId: string | null, brandId: string | null = null) =>
  insertFile(U, { projectId, brandId, kind: "upload", originalName: "poster.png", mime: "image/png", size: 10, width: 900, height: 1200, storagePath: `x/${Math.random()}.png`, sha256: "abc" });

describe("projects", () => {
  it("creates, lists with counts, renames and deletes", () => {
    const p = createProject(U, { name: "Alpine Rail", description: "Summer campaign" });
    expect(getProject(U, p.id).name).toBe("Alpine Rail");
    updateProject(U, p.id, { name: "Alpine Rail 2026" });
    const list = listProjects(U);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Alpine Rail 2026", critiqueCount: 0, designCount: 0 });
    const f = file(p.id);
    createCritique(U, { projectId: p.id, fileId: f.id, brandId: null, title: "v1", model: "claude-opus-5-5", context: {}, technical: null });
    expect(listProjects(U)[0].critiqueCount).toBe(1);
    expect(listProjects(U)[0].coverFileId).toBe(f.id);
    const paths = deleteProject(U, p.id);
    expect(paths).toHaveLength(1);
    expect(() => getProject(U, p.id)).toThrow(NotFoundError);
  });

  it("isolates projects between users", () => {
    const p = createProject(U, { name: "Mine" });
    expect(() => getProject(OTHER, p.id)).toThrow(NotFoundError);
    expect(listProjects(OTHER)).toHaveLength(0);
    expect(() => updateProject(OTHER, p.id, { name: "Hijack" })).toThrow(NotFoundError);
  });

  it("refuses to attach another user's brand", () => {
    const b = createBrand(OTHER, { name: "Theirs" });
    expect(() => createProject(U, { name: "X", brandId: b.id })).toThrow(NotFoundError);
  });
});

describe("brands", () => {
  it("persists rules with lock levels and records history", () => {
    const b = createBrand(U, { name: "Alpine Rail" });
    updateBrand(U, b.id, {
      colors: [{ name: "Glacier", hex: "#1F4E79", role: "primary", lock: "locked" }],
      typography: [{ role: "display", family: "Fraunces", weights: "600", notes: "", lock: "flexible" }],
      restrictions: [{ text: "Never place the logo on busy photography", lock: "locked" }],
    });
    const fresh = getBrand(U, b.id);
    expect(fresh.colors[0]).toMatchObject({ hex: "#1F4E79", lock: "locked" });
    expect(fresh.typography[0].lock).toBe("flexible");
    const history = listBrandChanges(U, b.id);
    expect(history.map((h) => h.summary).sort()).toEqual(["Brand profile created", "Updated colors, typography, restrictions"]);
    // A no-op update records nothing new.
    updateBrand(U, b.id, { name: "Alpine Rail" });
    expect(listBrandChanges(U, b.id)).toHaveLength(history.length);
  });
});

describe("critiques", () => {
  it("stores results and decisions", () => {
    const p = createProject(U, { name: "P" });
    const c = createCritique(U, { projectId: p.id, fileId: file(p.id).id, brandId: null, title: "t", model: "claude-opus-5-5", context: { purpose: "sell tickets" }, technical: null });
    expect(c.status).toBe("queued");
    updateCritique(U, c.id, { status: "succeeded", overallScore: 71, decisions: { f1: "accepted" } });
    const again = getCritique(U, c.id);
    expect(again).toMatchObject({ status: "succeeded", overallScore: 71, decisions: { f1: "accepted" }, context: { purpose: "sell tickets" } });
    expect(() => getCritique(OTHER, c.id)).toThrow(NotFoundError);
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

  it("tracks usage and blocks removing used or locked assets", () => {
    const p = createProject(U, { name: "P" });
    const f = file(p.id);
    const a = insertAsset(U, { projectId: p.id, fileId: f.id, type: "photo", source: "provider", provider: "wikimedia", providerId: "1", title: "Alps", creator: "Jane", creatorUrl: null, sourceUrl: "https://commons.wikimedia.org/x", license: { code: "cc-by", name: "CC BY 4.0", url: null, commercialUse: true, modificationAllowed: true, attributionRequired: true, shareAlike: false, notes: null }, attribution: "Alps by Jane", status: "approved", locked: false, analysis: {}, retrievedAt: new Date().toISOString() });
    const d = createDesign(U, { projectId: p.id, name: "Poster", brief: {} });
    const v1 = addDesignVersion(U, d.id, { document: doc(a.id), changeSummary: "Generated", createdBy: "agent", assetIds: [a.id] });
    const v2 = addDesignVersion(U, d.id, { document: doc(a.id), changeSummary: "Edit", createdBy: "user", assetIds: [a.id] });
    expect([v1.number, v2.number]).toEqual([1, 2]);
    expect(v2.parentVersionId).toBe(v1.id);
    expect(listVersions(U, d.id).map((v) => v.number)).toEqual([2, 1]);
    expect(() => deleteAsset(U, a.id)).toThrow(ConflictError);
  });
});

describe("preferences", () => {
  it("merges partial updates over defaults", () => {
    expect(getPreferences(U).aiProvider).toBe("gemini");
    setPreferences(U, { critiqueStrictness: "strict" });
    expect(getPreferences(U)).toMatchObject({ critiqueStrictness: "strict", assetMode: "automatic" });
  });
});
