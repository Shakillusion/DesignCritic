import "server-only";
import { customAlphabet } from "nanoid";
import { getDb, transaction } from "./db";
import type {
  AppliedChange,
  Asset,
  ChatMessage,
  Brand,
  BrandChange,
  Critique,
  Design,
  DesignVersion,
  FileKind,
  Job,
  JobStep,
  Preferences,
  Project,
  ProjectSummary,
  StoredFile,
} from "@/types/domain";
import { DEFAULT_PREFERENCES } from "@/types/domain";
import type { DesignDocument } from "@/lib/design-engine/schema";

/**
 * Data access. Every function takes the acting userId and filters by it, so
 * project-level isolation holds once real auth replaces LOCAL_USER_ID.
 */

type Row = Record<string, unknown>;
const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);
export const newId = (prefix: string) => `${prefix}_${nano()}`;
const now = () => new Date().toISOString();
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/* ───────────────────────── Projects ───────────────────────── */

const toProject = (r: Row): Project => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description ?? ""),
  brandId: str(r.brand_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await getDb()
    .prepare(
      `SELECT p.*, b.name AS brand_name,
        (SELECT COUNT(*) FROM critiques c WHERE c.project_id = p.id) AS critique_count,
        (SELECT COUNT(*) FROM designs d WHERE d.project_id = p.id) AS design_count,
        (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
        COALESCE(
          (SELECT v.render_file_id FROM designs d JOIN design_versions v ON v.id = d.current_version_id
             WHERE d.project_id = p.id AND v.render_file_id IS NOT NULL ORDER BY d.updated_at DESC LIMIT 1),
          (SELECT c.file_id FROM critiques c WHERE c.project_id = p.id ORDER BY c.created_at DESC LIMIT 1)
        ) AS cover_file_id
       FROM projects p LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({
    ...toProject(r),
    brandName: str(r.brand_name),
    critiqueCount: Number(r.critique_count),
    designCount: Number(r.design_count),
    assetCount: Number(r.asset_count),
    coverFileId: str(r.cover_file_id),
  }));
}

export async function getProject(userId: string, id: string): Promise<Project> {
  const r = await getDb().prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Project");
  return toProject(r);
}

export async function createProject(userId: string, input: { name: string; description?: string; brandId?: string | null }): Promise<Project> {
  if (input.brandId) await getBrand(userId, input.brandId);
  const id = newId("prj");
  const t = now();
  await getDb()
    .prepare("INSERT INTO projects (id, user_id, name, description, brand_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, input.name, input.description ?? "", input.brandId ?? null, t, t);
  return await getProject(userId, id);
}

export async function updateProject(userId: string, id: string, patch: { name?: string; description?: string; brandId?: string | null }): Promise<Project> {
  const p = await getProject(userId, id);
  if (patch.brandId) await getBrand(userId, patch.brandId);
  await getDb()
    .prepare("UPDATE projects SET name = ?, description = ?, brand_id = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(
      patch.name ?? p.name,
      patch.description ?? p.description,
      patch.brandId === undefined ? p.brandId : patch.brandId,
      now(),
      id,
      userId,
    );
  return await getProject(userId, id);
}

export async function touchProject(userId: string, id: string) {
  await getDb().prepare("UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?").run(now(), id, userId);
}

/** Deletes the project and its rows; returns the storage paths the caller must remove. */
export async function deleteProject(userId: string, id: string): Promise<string[]> {
  await getProject(userId, id);
  return await transaction(async () => {
    const paths = (await getDb().prepare("SELECT storage_path FROM files WHERE project_id = ? AND user_id = ?").all(id, userId) as Row[]).map(
      (r) => String(r.storage_path),
    );
    const db = getDb();
    await db.prepare("DELETE FROM critiques WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM asset_usages WHERE asset_id IN (SELECT id FROM assets WHERE project_id = ?)").run(id);
    await db.prepare("DELETE FROM design_versions WHERE design_id IN (SELECT id FROM designs WHERE project_id = ?)").run(id);
    await db.prepare("DELETE FROM designs WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM assets WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM jobs WHERE project_id = ?").run(id);
    // Research rows reference files (thumbnails), so they go before the files.
    await db.prepare("DELETE FROM directions WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM moodboards WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM refs WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM research_runs WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM chat_messages WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM files WHERE project_id = ?").run(id);
    await db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
    return paths;
  });
}

/* ───────────────────────── Brands ───────────────────────── */

const toBrand = (r: Row): Brand => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description ?? ""),
  industry: String(r.industry ?? ""),
  audience: String(r.audience ?? ""),
  personality: String(r.personality ?? ""),
  photographyStyle: String(r.photography_style ?? ""),
  graphicElements: String(r.graphic_elements ?? ""),
  colors: json(r.colors, []),
  typography: json(r.typography, []),
  restrictions: json(r.restrictions, []),
  logoFileIds: json(r.logo_file_ids, []),
  referenceFileIds: json(r.reference_file_ids, []),
  guidelineFileIds: json(r.guideline_file_ids, []),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export type BrandInput = Partial<Omit<Brand, "id" | "createdAt" | "updatedAt">> & { name?: string };

export async function listBrands(userId: string): Promise<(Brand & { projectCount: number })[]> {
  const rows = await getDb()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM projects p WHERE p.brand_id = b.id) AS project_count
       FROM brands b WHERE b.user_id = ? ORDER BY b.updated_at DESC`,
    )
    .all(userId) as Row[];
  return rows.map((r) => ({ ...toBrand(r), projectCount: Number(r.project_count) }));
}

export async function getBrand(userId: string, id: string): Promise<Brand> {
  const r = await getDb().prepare("SELECT * FROM brands WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Brand");
  return toBrand(r);
}

export async function createBrand(userId: string, input: BrandInput & { name: string }): Promise<Brand> {
  const id = newId("brd");
  const t = now();
  await getDb()
    .prepare(
      `INSERT INTO brands (id, user_id, name, description, industry, audience, personality, photography_style, graphic_elements,
        colors, typography, restrictions, logo_file_ids, reference_file_ids, guideline_file_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.name,
      input.description ?? "",
      input.industry ?? "",
      input.audience ?? "",
      input.personality ?? "",
      input.photographyStyle ?? "",
      input.graphicElements ?? "",
      JSON.stringify(input.colors ?? []),
      JSON.stringify(input.typography ?? []),
      JSON.stringify(input.restrictions ?? []),
      JSON.stringify(input.logoFileIds ?? []),
      JSON.stringify(input.referenceFileIds ?? []),
      JSON.stringify(input.guidelineFileIds ?? []),
      t,
      t,
    );
  await addBrandChange(id, "Brand profile created", {});
  return await getBrand(userId, id);
}

const BRAND_FIELDS: [keyof BrandInput, string, boolean][] = [
  ["name", "name", false],
  ["description", "description", false],
  ["industry", "industry", false],
  ["audience", "audience", false],
  ["personality", "personality", false],
  ["photographyStyle", "photography_style", false],
  ["graphicElements", "graphic_elements", false],
  ["colors", "colors", true],
  ["typography", "typography", true],
  ["restrictions", "restrictions", true],
  ["logoFileIds", "logo_file_ids", true],
  ["referenceFileIds", "reference_file_ids", true],
  ["guidelineFileIds", "guideline_file_ids", true],
];

export async function updateBrand(userId: string, id: string, patch: BrandInput, summary?: string): Promise<Brand> {
  const before = await getBrand(userId, id);
  const sets: string[] = [];
  const values: (string | null)[] = [];
  const changed: string[] = [];
  for (const [key, col, isJson] of BRAND_FIELDS) {
    if (patch[key] === undefined) continue;
    const next = isJson ? JSON.stringify(patch[key]) : String(patch[key]);
    const prev = isJson ? JSON.stringify(before[key as keyof Brand]) : String(before[key as keyof Brand]);
    if (next === prev) continue;
    sets.push(`${col} = ?`);
    values.push(next);
    changed.push(key);
  }
  if (!sets.length) return before;
  await getDb()
    .prepare(`UPDATE brands SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(...values, now(), id, userId);
  await addBrandChange(id, summary ?? `Updated ${changed.join(", ")}`, { fields: changed });
  return await getBrand(userId, id);
}

export async function deleteBrand(userId: string, id: string): Promise<string[]> {
  await getBrand(userId, id);
  return await transaction(async () => {
    const paths = (await getDb().prepare("SELECT storage_path FROM files WHERE brand_id = ? AND user_id = ?").all(id, userId) as Row[]).map(
      (r) => String(r.storage_path),
    );
    await getDb().prepare("DELETE FROM files WHERE brand_id = ? AND user_id = ?").run(id, userId);
    await getDb().prepare("DELETE FROM brands WHERE id = ? AND user_id = ?").run(id, userId);
    return paths;
  });
}

async function addBrandChange(brandId: string, summary: string, detail: Record<string, unknown>) {
  await getDb()
    .prepare("INSERT INTO brand_changes (id, brand_id, summary, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(newId("bch"), brandId, summary, JSON.stringify(detail), now());
}

export async function listBrandChanges(userId: string, brandId: string): Promise<BrandChange[]> {
  await getBrand(userId, brandId);
  return (await getDb().prepare("SELECT * FROM brand_changes WHERE brand_id = ? ORDER BY created_at DESC").all(brandId) as Row[]).map((r) => ({
    id: String(r.id),
    brandId: String(r.brand_id),
    summary: String(r.summary),
    detail: json(r.detail, {}),
    createdAt: String(r.created_at),
  }));
}

/* ───────────────────────── Files ───────────────────────── */

const toFile = (r: Row): StoredFile => ({
  id: String(r.id),
  projectId: str(r.project_id),
  brandId: str(r.brand_id),
  kind: String(r.kind) as FileKind,
  originalName: String(r.original_name),
  mime: String(r.mime),
  size: Number(r.size),
  width: num(r.width),
  height: num(r.height),
  sha256: String(r.sha256),
  meta: json(r.meta, {}),
  createdAt: String(r.created_at),
});

export interface FileInsert {
  projectId?: string | null;
  brandId?: string | null;
  kind: FileKind;
  originalName: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  storagePath: string;
  sha256: string;
  meta?: Record<string, unknown>;
}

export async function insertFile(userId: string, f: FileInsert, id = newId("fil")): Promise<StoredFile> {
  await getDb()
    .prepare(
      `INSERT INTO files (id, user_id, project_id, brand_id, kind, original_name, mime, size, width, height, storage_path, sha256, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      f.projectId ?? null,
      f.brandId ?? null,
      f.kind,
      f.originalName,
      f.mime,
      f.size,
      f.width ?? null,
      f.height ?? null,
      f.storagePath,
      f.sha256,
      JSON.stringify(f.meta ?? {}),
      now(),
    );
  return await getFile(userId, id);
}

export async function getFile(userId: string, id: string): Promise<StoredFile> {
  const r = await getDb().prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("File");
  return toFile(r);
}

export async function getFileStoragePath(userId: string, id: string): Promise<{ file: StoredFile; storagePath: string }> {
  const r = await getDb().prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("File");
  return { file: toFile(r), storagePath: String(r.storage_path) };
}

export async function listFiles(userId: string, filter: { projectId?: string; brandId?: string; kind?: FileKind }): Promise<StoredFile[]> {
  const where = ["user_id = ?"];
  const args: string[] = [userId];
  if (filter.projectId) {
    where.push("project_id = ?");
    args.push(filter.projectId);
  }
  if (filter.brandId) {
    where.push("brand_id = ?");
    args.push(filter.brandId);
  }
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  return (await getDb().prepare(`SELECT * FROM files WHERE ${where.join(" AND ")} ORDER BY created_at DESC`).all(...args) as Row[]).map(toFile);
}

/* ───────────────────────── Assets ───────────────────────── */

const toAsset = (r: Row): Asset => ({
  id: String(r.id),
  projectId: String(r.project_id),
  fileId: String(r.file_id),
  preparedFileId: str(r.prepared_file_id),
  type: String(r.type) as Asset["type"],
  source: String(r.source) as Asset["source"],
  provider: str(r.provider),
  providerId: str(r.provider_id),
  title: String(r.title ?? ""),
  creator: str(r.creator),
  creatorUrl: str(r.creator_url),
  sourceUrl: str(r.source_url),
  license: json(r.license, {
    code: "unknown",
    name: "Unknown",
    url: null,
    commercialUse: null,
    modificationAllowed: null,
    attributionRequired: false,
    shareAlike: false,
    notes: null,
  }),
  attribution: str(r.attribution),
  status: String(r.status) as Asset["status"],
  locked: Number(r.locked) === 1,
  analysis: json(r.analysis, {}),
  retrievedAt: str(r.retrieved_at),
  createdAt: String(r.created_at),
  width: num(r.f_width),
  height: num(r.f_height),
  mime: String(r.f_mime ?? ""),
  usageCount: Number(r.usage_count ?? 0),
});

const ASSET_SELECT = `SELECT a.*, f.width AS f_width, f.height AS f_height, f.mime AS f_mime,
  (SELECT COUNT(*) FROM asset_usages u WHERE u.asset_id = a.id) AS usage_count
  FROM assets a JOIN files f ON f.id = a.file_id`;

export type AssetInsert = Omit<Asset, "id" | "createdAt" | "width" | "height" | "mime" | "usageCount" | "preparedFileId"> & {
  preparedFileId?: string | null;
};

export async function insertAsset(userId: string, a: AssetInsert): Promise<Asset> {
  await getProject(userId, a.projectId);
  const id = newId("ast");
  await getDb()
    .prepare(
      `INSERT INTO assets (id, user_id, project_id, file_id, prepared_file_id, type, source, provider, provider_id, title, creator, creator_url,
        source_url, license, attribution, status, locked, analysis, retrieved_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      a.projectId,
      a.fileId,
      a.preparedFileId ?? null,
      a.type,
      a.source,
      a.provider,
      a.providerId,
      a.title,
      a.creator,
      a.creatorUrl,
      a.sourceUrl,
      JSON.stringify(a.license),
      a.attribution,
      a.status,
      a.locked ? 1 : 0,
      JSON.stringify(a.analysis),
      a.retrievedAt,
      now(),
    );
  return await getAsset(userId, id);
}

export async function getAsset(userId: string, id: string): Promise<Asset> {
  const r = await getDb().prepare(`${ASSET_SELECT} WHERE a.id = ? AND a.user_id = ?`).get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Asset");
  return toAsset(r);
}

export async function findAssetByProviderId(userId: string, projectId: string, provider: string, providerId: string): Promise<Asset | null> {
  const r = await getDb()
    .prepare(`${ASSET_SELECT} WHERE a.user_id = ? AND a.project_id = ? AND a.provider = ? AND a.provider_id = ?`)
    .get(userId, projectId, provider, providerId) as Row | undefined;
  return r ? toAsset(r) : null;
}

export async function listAssets(userId: string, filter: { projectId?: string; type?: string; status?: string } = {}): Promise<(Asset & { projectName: string })[]> {
  const where = ["a.user_id = ?"];
  const args: string[] = [userId];
  if (filter.projectId) {
    where.push("a.project_id = ?");
    args.push(filter.projectId);
  }
  if (filter.type) {
    where.push("a.type = ?");
    args.push(filter.type);
  }
  if (filter.status) {
    where.push("a.status = ?");
    args.push(filter.status);
  }
  const rows = await getDb()
    .prepare(
      `SELECT x.*, p.name AS project_name FROM (${ASSET_SELECT} WHERE ${where.join(" AND ")}) x
       JOIN projects p ON p.id = x.project_id ORDER BY x.created_at DESC`,
    )
    .all(...args) as Row[];
  return rows.map((r) => ({ ...toAsset(r), projectName: String(r.project_name) }));
}

export async function updateAsset(userId: string, id: string, patch: { status?: Asset["status"]; locked?: boolean; analysis?: Asset["analysis"]; preparedFileId?: string }): Promise<Asset> {
  const a = await getAsset(userId, id);
  await getDb()
    .prepare("UPDATE assets SET status = ?, locked = ?, analysis = ?, prepared_file_id = ? WHERE id = ? AND user_id = ?")
    .run(
      patch.status ?? a.status,
      (patch.locked ?? a.locked) ? 1 : 0,
      JSON.stringify(patch.analysis ?? a.analysis),
      patch.preparedFileId ?? a.preparedFileId,
      id,
      userId,
    );
  return await getAsset(userId, id);
}

/** Removes an unused, unlocked asset. Returns storage paths to delete. */
export async function deleteAsset(userId: string, id: string): Promise<string[]> {
  const a = await getAsset(userId, id);
  if (a.locked) throw new ConflictError("This asset is locked. Unlock it before removing it.");
  if (a.usageCount > 0) throw new ConflictError(`This asset is used in ${a.usageCount} design version(s) and can't be removed.`);
  return await transaction(async () => {
    const fileIds = [a.fileId, a.preparedFileId].filter(Boolean) as string[];
    const paths: string[] = [];
    for (const f of fileIds) paths.push((await getFileStoragePath(userId, f)).storagePath);
    await getDb().prepare("DELETE FROM assets WHERE id = ? AND user_id = ?").run(id, userId);
    for (const f of fileIds) await getDb().prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(f, userId);
    return paths;
  });
}

/* ───────────────────────── Designs ───────────────────────── */

const toDesign = (r: Row): Design => ({
  id: String(r.id),
  projectId: String(r.project_id),
  name: String(r.name),
  brief: json(r.brief, {}),
  currentVersionId: str(r.current_version_id),
  sourceFileId: str(r.source_file_id),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const toVersion = (r: Row): DesignVersion => ({
  id: String(r.id),
  designId: String(r.design_id),
  number: Number(r.number),
  parentVersionId: str(r.parent_version_id),
  document: json(r.document, null as unknown as DesignDocument),
  renderFileId: str(r.render_file_id),
  qa: json(r.qa, null),
  critiqueId: str(r.critique_id),
  changeSummary: String(r.change_summary ?? ""),
  createdBy: String(r.created_by) as DesignVersion["createdBy"],
  approved: Number(r.approved) === 1,
  createdAt: String(r.created_at),
  changes: json(r.changes, []),
});

export async function createDesign(userId: string, input: { projectId: string; name: string; brief: Record<string, unknown>; sourceFileId?: string | null }): Promise<Design> {
  await getProject(userId, input.projectId);
  const id = newId("dsn");
  const t = now();
  await getDb()
    .prepare("INSERT INTO designs (id, user_id, project_id, name, brief, source_file_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, input.projectId, input.name, JSON.stringify(input.brief), input.sourceFileId ?? null, t, t);
  await touchProject(userId, input.projectId);
  return await getDesign(userId, id);
}

export async function getDesign(userId: string, id: string): Promise<Design> {
  const r = await getDb().prepare("SELECT * FROM designs WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Design");
  return toDesign(r);
}

export async function listDesigns(userId: string, projectId?: string): Promise<(Design & { renderFileId: string | null; versionCount: number; projectName: string })[]> {
  const rows = await getDb()
    .prepare(
      `SELECT d.*, p.name AS project_name, v.render_file_id,
        (SELECT COUNT(*) FROM design_versions x WHERE x.design_id = d.id) AS version_count
       FROM designs d JOIN projects p ON p.id = d.project_id
       LEFT JOIN design_versions v ON v.id = d.current_version_id
       WHERE d.user_id = ? ${projectId ? "AND d.project_id = ?" : ""} ORDER BY d.updated_at DESC`,
    )
    .all(...(projectId ? [userId, projectId] : [userId])) as Row[];
  return rows.map((r) => ({
    ...toDesign(r),
    renderFileId: str(r.render_file_id),
    versionCount: Number(r.version_count),
    projectName: String(r.project_name),
  }));
}

export async function renameDesign(userId: string, id: string, name: string): Promise<Design> {
  await getDesign(userId, id);
  await getDb().prepare("UPDATE designs SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(name, now(), id, userId);
  return await getDesign(userId, id);
}

export async function deleteDesign(userId: string, id: string): Promise<string[]> {
  await getDesign(userId, id);
  return await transaction(async () => {
    const db = getDb();
    const renders = await db
      .prepare(
        `SELECT f.id, f.storage_path FROM files f JOIN design_versions v ON v.render_file_id = f.id WHERE v.design_id = ? AND f.user_id = ?`,
      )
      .all(id, userId) as Row[];
    await db.prepare("UPDATE critiques SET design_version_id = NULL WHERE design_version_id IN (SELECT id FROM design_versions WHERE design_id = ?)").run(id);
    await db.prepare("DELETE FROM design_versions WHERE design_id = ?").run(id);
    await db.prepare("DELETE FROM designs WHERE id = ? AND user_id = ?").run(id, userId);
    // Renders referenced by a critique must survive: the critique still shows them.
    const paths: string[] = [];
    for (const f of renders) {
      if (await db.prepare("SELECT 1 FROM critiques WHERE file_id = ? LIMIT 1").get(String(f.id))) continue;
      await db.prepare("DELETE FROM files WHERE id = ? AND user_id = ?").run(String(f.id), userId);
      paths.push(String(f.storage_path));
    }
    return paths;
  });
}

export async function addDesignVersion(
  userId: string,
  designId: string,
  input: { document: DesignDocument; changeSummary: string; createdBy: "agent" | "user"; parentVersionId?: string | null; assetIds: string[]; changes?: AppliedChange[]; makeCurrent?: boolean },
): Promise<DesignVersion> {
  const design = await getDesign(userId, designId);
  return await transaction(async () => {
    const db = getDb();
    const { n } = await db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM design_versions WHERE design_id = ?").get(designId) as { n: number };
    const id = newId("ver");
    await db.prepare(
      `INSERT INTO design_versions (id, design_id, number, parent_version_id, document, change_summary, created_by, changes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, designId, n, input.parentVersionId ?? design.currentVersionId, JSON.stringify(input.document), input.changeSummary, input.createdBy, JSON.stringify(input.changes ?? []), now());
    for (const assetId of input.assetIds) {
      // Only link assets that belong to this user + project.
      const ok = await db.prepare("SELECT 1 FROM assets WHERE id = ? AND user_id = ? AND project_id = ?").get(assetId, userId, design.projectId);
      if (ok) await db.prepare("INSERT OR IGNORE INTO asset_usages (asset_id, design_version_id) VALUES (?, ?)").run(assetId, id);
    }
    // Agent versions can wait for review instead of becoming current (Settings → ask before applying).
    if (input.makeCurrent !== false || !design.currentVersionId) await db.prepare("UPDATE designs SET current_version_id = ?, updated_at = ? WHERE id = ?").run(id, now(), designId);
    else await db.prepare("UPDATE designs SET updated_at = ? WHERE id = ?").run(now(), designId);
    await touchProject(userId, design.projectId);
    return await getVersion(userId, id);
  });
}

export async function getVersion(userId: string, versionId: string): Promise<DesignVersion> {
  const r = await getDb()
    .prepare("SELECT v.* FROM design_versions v JOIN designs d ON d.id = v.design_id WHERE v.id = ? AND d.user_id = ?")
    .get(versionId, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Design version");
  return toVersion(r);
}

export async function listVersions(userId: string, designId: string): Promise<DesignVersion[]> {
  await getDesign(userId, designId);
  return (await getDb().prepare("SELECT * FROM design_versions WHERE design_id = ? ORDER BY number DESC").all(designId) as Row[]).map(toVersion);
}

export async function updateVersionMeta(
  userId: string,
  versionId: string,
  patch: { renderFileId?: string; qa?: unknown; critiqueId?: string; approved?: boolean },
): Promise<DesignVersion> {
  const v = await getVersion(userId, versionId);
  await getDb()
    .prepare("UPDATE design_versions SET render_file_id = ?, qa = ?, critique_id = ?, approved = ? WHERE id = ?")
    .run(
      patch.renderFileId ?? v.renderFileId,
      patch.qa !== undefined ? JSON.stringify(patch.qa) : v.qa ? JSON.stringify(v.qa) : null,
      patch.critiqueId ?? v.critiqueId,
      (patch.approved ?? v.approved) ? 1 : 0,
      versionId,
    );
  return await getVersion(userId, versionId);
}

export async function setCurrentVersion(userId: string, designId: string, versionId: string) {
  const v = await getVersion(userId, versionId);
  if (v.designId !== designId) throw new NotFoundError("Design version");
  await getDb().prepare("UPDATE designs SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(versionId, now(), designId, userId);
}

/* ───────────────────────── Critiques ───────────────────────── */

const toCritique = (r: Row): Critique => ({
  id: String(r.id),
  projectId: String(r.project_id),
  fileId: String(r.file_id),
  designVersionId: str(r.design_version_id),
  brandId: str(r.brand_id),
  title: String(r.title ?? ""),
  status: String(r.status) as Critique["status"],
  model: String(r.model),
  context: json(r.context, {}),
  technical: json(r.technical, null),
  result: json(r.result, null),
  overallScore: num(r.overall_score),
  decisions: json(r.decisions, {}),
  improvementPlan: json(r.improvement_plan, null),
  error: str(r.error),
  createdAt: String(r.created_at),
  completedAt: str(r.completed_at),
});

export async function createCritique(
  userId: string,
  input: Pick<Critique, "projectId" | "fileId" | "brandId" | "title" | "model" | "context" | "technical"> & { designVersionId?: string | null },
): Promise<Critique> {
  await getProject(userId, input.projectId);
  const id = newId("crt");
  await getDb()
    .prepare(
      `INSERT INTO critiques (id, user_id, project_id, file_id, design_version_id, brand_id, title, status, model, context, technical, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.projectId,
      input.fileId,
      input.designVersionId ?? null,
      input.brandId,
      input.title,
      input.model,
      JSON.stringify(input.context),
      JSON.stringify(input.technical),
      now(),
    );
  await touchProject(userId, input.projectId);
  return await getCritique(userId, id);
}

export async function getCritique(userId: string, id: string): Promise<Critique> {
  const r = await getDb().prepare("SELECT * FROM critiques WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Critique");
  return toCritique(r);
}

export async function listCritiques(userId: string, projectId?: string): Promise<(Critique & { projectName: string })[]> {
  const rows = await getDb()
    .prepare(
      `SELECT c.*, p.name AS project_name FROM critiques c JOIN projects p ON p.id = c.project_id
       WHERE c.user_id = ? ${projectId ? "AND c.project_id = ?" : ""} ORDER BY c.created_at DESC`,
    )
    .all(...(projectId ? [userId, projectId] : [userId])) as Row[];
  return rows.map((r) => ({ ...toCritique(r), projectName: String(r.project_name) }));
}

export async function updateCritique(
  userId: string,
  id: string,
  patch: Partial<Pick<Critique, "status" | "result" | "overallScore" | "decisions" | "improvementPlan" | "error" | "completedAt" | "title" | "model">>,
): Promise<Critique> {
  const c = await getCritique(userId, id);
  await getDb()
    .prepare(
      `UPDATE critiques SET status = ?, result = ?, overall_score = ?, decisions = ?, improvement_plan = ?, error = ?, completed_at = ?, title = ?, model = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.status ?? c.status,
      JSON.stringify(patch.result !== undefined ? patch.result : c.result),
      patch.overallScore !== undefined ? patch.overallScore : c.overallScore,
      JSON.stringify(patch.decisions ?? c.decisions),
      JSON.stringify(patch.improvementPlan !== undefined ? patch.improvementPlan : c.improvementPlan),
      patch.error !== undefined ? patch.error : c.error,
      patch.completedAt !== undefined ? patch.completedAt : c.completedAt,
      patch.title ?? c.title,
      patch.model ?? c.model,
      id,
      userId,
    );
  return await getCritique(userId, id);
}

export async function deleteCritique(userId: string, id: string) {
  await getCritique(userId, id);
  await getDb().prepare("UPDATE design_versions SET critique_id = NULL WHERE critique_id = ?").run(id);
  await getDb().prepare("DELETE FROM critiques WHERE id = ? AND user_id = ?").run(id, userId);
}

/* ───────────────────────── Jobs ───────────────────────── */

const toJob = (r: Row): Job => ({
  id: String(r.id),
  projectId: str(r.project_id),
  type: String(r.type) as Job["type"],
  status: String(r.status) as Job["status"],
  steps: json(r.steps, []),
  result: json(r.result, null),
  error: str(r.error),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

export async function createJob(userId: string, input: { type: Job["type"]; projectId: string | null; steps: JobStep[] }): Promise<Job> {
  const id = newId("job");
  const t = now();
  await getDb()
    .prepare("INSERT INTO jobs (id, user_id, project_id, type, status, steps, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)")
    .run(id, userId, input.projectId, input.type, JSON.stringify(input.steps), t, t);
  return await getJob(userId, id);
}

export async function getJob(userId: string, id: string): Promise<Job> {
  const r = await getDb().prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Job");
  return toJob(r);
}

export async function updateJob(userId: string, id: string, patch: Partial<Pick<Job, "status" | "steps" | "result" | "error">>): Promise<Job> {
  const j = await getJob(userId, id);
  await getDb()
    .prepare("UPDATE jobs SET status = ?, steps = ?, result = ?, error = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(
      patch.status ?? j.status,
      JSON.stringify(patch.steps ?? j.steps),
      JSON.stringify(patch.result !== undefined ? patch.result : j.result),
      patch.error !== undefined ? patch.error : j.error,
      now(),
      id,
      userId,
    );
  return await getJob(userId, id);
}

/** Jobs left running when the server stopped can never finish; mark them failed. */
/**
 * Fail work that can no longer finish. With no cutoff, everything still running
 * (a single local server restarted); with a cutoff, only work untouched since then.
 */
export async function failInterruptedWork(staleBefore: string | null) {
  const msg = staleBefore ? "Interrupted: this ran past the server time limit. Try again, or use fewer QA rounds or variations." : "Interrupted: the server restarted while this was running.";
  const cutoff = staleBefore ?? "9999";
  await getDb().prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued','running') AND updated_at < ?").run(msg, now(), cutoff);
  await getDb().prepare("UPDATE critiques SET status = 'failed', error = ? WHERE status IN ('queued','running') AND created_at < ?").run(msg, cutoff);
}

/* ───────────────────────── AI usage ───────────────────────── */

export async function recordUsage(
  userId: string,
  u: { operation: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; durationMs: number; status: string; error?: string | null },
) {
  await getDb()
    .prepare(
      `INSERT INTO ai_usage (id, user_id, operation, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, duration_ms, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId("use"), userId, u.operation, u.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.costUsd, u.durationMs, u.status, u.error ?? null, now());
}

export async function usageSummary(userId: string) {
  const totals = await getDb()
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cost_usd),0) AS cost_usd, COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END),0) AS failures
       FROM ai_usage WHERE user_id = ?`,
    )
    .get(userId) as Row;
  const recent = await getDb().prepare("SELECT * FROM ai_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 25").all(userId) as Row[];
  return {
    calls: Number(totals.calls),
    inputTokens: Number(totals.input_tokens),
    outputTokens: Number(totals.output_tokens),
    costUsd: Number(totals.cost_usd),
    failures: Number(totals.failures),
    recent: recent.map((r) => ({
      id: String(r.id),
      operation: String(r.operation),
      model: String(r.model),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      costUsd: Number(r.cost_usd),
      durationMs: Number(r.duration_ms),
      status: String(r.status),
      error: str(r.error),
      createdAt: String(r.created_at),
    })),
  };
}

/* ───────────────────────── Preferences ───────────────────────── */

export async function getPreferences(userId: string): Promise<Preferences> {
  const r = await getDb().prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'preferences'").get(userId) as Row | undefined;
  const stored = json<Partial<Preferences>>(r?.value, {});
  return { ...DEFAULT_PREFERENCES, ...stored, aiModels: { ...DEFAULT_PREFERENCES.aiModels, ...stored.aiModels } };
}

export async function setPreferences(userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  const next = { ...await getPreferences(userId), ...patch };
  await getDb()
    .prepare("INSERT INTO settings (user_id, key, value) VALUES (?, 'preferences', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value")
    .run(userId, JSON.stringify(next));
  return next;
}

/* ───────────────────────── Assistant chat ───────────────────────── */

const toChat = (r: Row): ChatMessage => ({
  id: String(r.id),
  projectId: String(r.project_id),
  designId: str(r.design_id),
  role: String(r.role) as ChatMessage["role"],
  content: String(r.content),
  action: json(r.action, null),
  createdAt: String(r.created_at),
});

export async function addChatMessage(userId: string, m: { projectId: string; designId: string | null; role: ChatMessage["role"]; content: string; action?: ChatMessage["action"] }): Promise<ChatMessage> {
  await getProject(userId, m.projectId);
  const id = newId("msg");
  await getDb()
    .prepare("INSERT INTO chat_messages (id, user_id, project_id, design_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, m.projectId, m.designId, m.role, m.content, m.action ? JSON.stringify(m.action) : null, now());
  return toChat(await getDb().prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as Row);
}

export async function updateChatAction(userId: string, id: string, action: ChatMessage["action"]) {
  await getDb().prepare("UPDATE chat_messages SET action = ? WHERE id = ? AND user_id = ?").run(action ? JSON.stringify(action) : null, id, userId);
}

/** Conversation for a project, optionally narrowed to one design (plus project-level messages). */
export async function listChatMessages(userId: string, projectId: string, designId: string | null, limit = 60): Promise<ChatMessage[]> {
  await getProject(userId, projectId);
  const rows = await getDb()
    .prepare(
      `SELECT * FROM (SELECT *, rowid AS seq FROM chat_messages WHERE user_id = ? AND project_id = ? AND (design_id IS ? OR design_id IS NULL)
       ORDER BY created_at DESC, seq DESC LIMIT ?) ORDER BY created_at ASC, seq ASC`,
    )
    .all(userId, projectId, designId, limit) as Row[];
  return rows.map(toChat);
}
