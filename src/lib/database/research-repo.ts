import "server-only";
import { getDb, transaction } from "./db";
import { ConflictError, getProject, newId, NotFoundError } from "./repo";
import type { ResearchItem, SourceError } from "@/lib/integrations/research/types";
import type { ArtDirection, TrendBrief } from "@/agents/research/schema";

/** Phase 4 persistence: research runs, saved references, moodboards and art directions. All user-scoped. */

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const json = <T>(v: unknown, fb: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
};
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface ResearchQuery {
  topic: string;
  industry: string;
  direction: string;
}
export interface ResearchRun {
  id: string;
  projectId: string;
  query: ResearchQuery;
  items: ResearchItem[];
  brief: TrendBrief | null;
  sourceErrors: SourceError[];
  createdAt: string;
}
export interface Reference {
  id: string;
  projectId: string;
  kind: ResearchItem["kind"];
  source: string;
  title: string;
  url: string;
  publishedAt: string | null;
  creator: string | null;
  summary: string;
  rights: string | null;
  fileId: string | null;
  palette: string[];
  notes: string;
  researchRunId: string | null;
  createdAt: string;
}
export interface Moodboard {
  id: string;
  projectId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  items: { ref: Reference; position: number; size: "s" | "m" | "l"; note: string }[];
}
export interface DirectionRecord {
  id: string;
  projectId: string;
  moodboardId: string | null;
  data: ArtDirection;
  createdAt: string;
}

const toRun = (r: Row): ResearchRun => ({
  id: String(r.id),
  projectId: String(r.project_id),
  query: json(r.query, { topic: "", industry: "", direction: "" }),
  items: json(r.items, []),
  brief: json(r.brief, null),
  sourceErrors: json(r.source_errors, []),
  createdAt: String(r.created_at),
});

export async function saveResearchRun(userId: string, input: { projectId: string; query: ResearchQuery; items: ResearchItem[]; brief: TrendBrief | null; sourceErrors: SourceError[] }): Promise<ResearchRun> {
  await getProject(userId, input.projectId);
  const id = newId("rsr");
  await getDb()
    .prepare("INSERT INTO research_runs (id, user_id, project_id, query, items, brief, source_errors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, userId, input.projectId, JSON.stringify(input.query), JSON.stringify(input.items), input.brief ? JSON.stringify(input.brief) : null, JSON.stringify(input.sourceErrors), now());
  return await getResearchRun(userId, id);
}

export async function getResearchRun(userId: string, id: string): Promise<ResearchRun> {
  const r = await getDb().prepare("SELECT * FROM research_runs WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Research run");
  return toRun(r);
}

export async function listResearchRuns(userId: string, projectId: string): Promise<ResearchRun[]> {
  return (await getDb().prepare("SELECT * FROM research_runs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 20").all(userId, projectId) as Row[]).map(toRun);
}

const toRef = (r: Row): Reference => ({
  id: String(r.id),
  projectId: String(r.project_id),
  kind: String(r.kind) as Reference["kind"],
  source: String(r.source),
  title: String(r.title),
  url: String(r.url),
  publishedAt: str(r.published_at),
  creator: str(r.creator),
  summary: String(r.summary ?? ""),
  rights: str(r.rights),
  fileId: str(r.file_id),
  palette: json(r.palette, []),
  notes: String(r.notes ?? ""),
  researchRunId: str(r.research_run_id),
  createdAt: String(r.created_at),
});

export async function insertReference(userId: string, input: Omit<Reference, "id" | "createdAt" | "notes"> & { notes?: string }): Promise<Reference> {
  await getProject(userId, input.projectId);
  const existing = await getDb().prepare("SELECT * FROM refs WHERE user_id = ? AND project_id = ? AND url = ?").get(userId, input.projectId, input.url) as Row | undefined;
  if (existing) return toRef(existing);
  const id = newId("ref");
  await getDb()
    .prepare(
      `INSERT INTO refs (id, user_id, project_id, kind, source, title, url, published_at, creator, summary, rights, file_id, palette, notes, research_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, input.projectId, input.kind, input.source, input.title, input.url, input.publishedAt, input.creator, input.summary, input.rights, input.fileId, JSON.stringify(input.palette), input.notes ?? "", input.researchRunId, now());
  return await getReference(userId, id);
}

export async function getReference(userId: string, id: string): Promise<Reference> {
  const r = await getDb().prepare("SELECT * FROM refs WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Reference");
  return toRef(r);
}

export async function listReferences(userId: string, projectId: string): Promise<Reference[]> {
  return (await getDb().prepare("SELECT * FROM refs WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC").all(userId, projectId) as Row[]).map(toRef);
}

export async function updateReferenceNotes(userId: string, id: string, notes: string): Promise<Reference> {
  await getReference(userId, id);
  await getDb().prepare("UPDATE refs SET notes = ? WHERE id = ? AND user_id = ?").run(notes, id, userId);
  return await getReference(userId, id);
}

/** Deletes a reference; returns its thumbnail file id (caller removes the file). */
export async function deleteReference(userId: string, id: string): Promise<string | null> {
  const ref = await getReference(userId, id);
  await getDb().prepare("DELETE FROM refs WHERE id = ? AND user_id = ?").run(id, userId);
  return ref.fileId;
}

/* ── Moodboards ── */

export async function createMoodboard(userId: string, input: { projectId: string; name: string; refIds?: string[] }): Promise<Moodboard> {
  await getProject(userId, input.projectId);
  const id = newId("mbd");
  const t = now();
  await transaction(async () => {
    await getDb().prepare("INSERT INTO moodboards (id, user_id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, input.projectId, input.name, t, t);
    for (const [i, refId] of (input.refIds ?? []).entries()) {
      const ref = await getReference(userId, refId);
      if (ref.projectId !== input.projectId) throw new ConflictError("A reference belongs to another project.");
      await getDb().prepare("INSERT OR IGNORE INTO moodboard_items (moodboard_id, ref_id, position) VALUES (?, ?, ?)").run(id, refId, i);
    }
  });
  return await getMoodboard(userId, id);
}

export async function getMoodboard(userId: string, id: string): Promise<Moodboard> {
  const r = await getDb().prepare("SELECT * FROM moodboards WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Moodboard");
  const items = (await getDb()
    .prepare("SELECT i.position, i.size, i.note, f.* FROM moodboard_items i JOIN refs f ON f.id = i.ref_id WHERE i.moodboard_id = ? ORDER BY i.position")
    .all(id) as Row[]).map((x) => ({ ref: toRef(x), position: Number(x.position), size: String(x.size) as "s" | "m" | "l", note: String(x.note ?? "") }));
  return { id: String(r.id), projectId: String(r.project_id), name: String(r.name), notes: String(r.notes ?? ""), createdAt: String(r.created_at), updatedAt: String(r.updated_at), items };
}

export async function listMoodboards(userId: string, projectId: string): Promise<Moodboard[]> {
  const rows = (await getDb().prepare("SELECT id FROM moodboards WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC").all(userId, projectId) as Row[]);
  return Promise.all(rows.map((r) => getMoodboard(userId, String(r.id))));
}

/** Replace the board's name/notes and its ordered items in one go (the UI saves the whole board). */
export async function saveMoodboard(userId: string, id: string, input: { name?: string; notes?: string; items?: { refId: string; size: "s" | "m" | "l"; note: string }[] }): Promise<Moodboard> {
  const board = await getMoodboard(userId, id);
  await transaction(async () => {
    await getDb().prepare("UPDATE moodboards SET name = ?, notes = ?, updated_at = ? WHERE id = ?").run(input.name ?? board.name, input.notes ?? board.notes, now(), id);
    if (input.items) {
      await getDb().prepare("DELETE FROM moodboard_items WHERE moodboard_id = ?").run(id);
      for (const [i, it] of input.items.entries()) {
        const ref = await getReference(userId, it.refId);
        if (ref.projectId !== board.projectId) throw new ConflictError("A reference belongs to another project.");
        await getDb().prepare("INSERT INTO moodboard_items (moodboard_id, ref_id, position, size, note) VALUES (?, ?, ?, ?, ?)").run(id, it.refId, i, it.size, it.note);
      }
    }
  });
  return await getMoodboard(userId, id);
}

export async function deleteMoodboard(userId: string, id: string) {
  await getMoodboard(userId, id);
  await getDb().prepare("DELETE FROM moodboards WHERE id = ? AND user_id = ?").run(id, userId);
}

/* ── Directions ── */

export async function saveDirections(userId: string, input: { projectId: string; moodboardId: string | null; directions: ArtDirection[] }): Promise<DirectionRecord[]> {
  const out: DirectionRecord[] = [];
  for (const d of input.directions) {
    const id = newId("dir");
    await getDb().prepare("INSERT INTO directions (id, user_id, project_id, moodboard_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, input.projectId, input.moodboardId, JSON.stringify(d), now());
    out.push(await getDirection(userId, id));
  }
  return out;
}

export async function getDirection(userId: string, id: string): Promise<DirectionRecord> {
  const r = await getDb().prepare("SELECT * FROM directions WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  if (!r) throw new NotFoundError("Direction");
  return { id: String(r.id), projectId: String(r.project_id), moodboardId: str(r.moodboard_id), data: json(r.data, null as unknown as ArtDirection), createdAt: String(r.created_at) };
}

export async function listDirections(userId: string, projectId: string, moodboardId?: string): Promise<DirectionRecord[]> {
  const rows = moodboardId
    ? (await getDb().prepare("SELECT id FROM directions WHERE user_id = ? AND project_id = ? AND moodboard_id = ? ORDER BY created_at DESC").all(userId, projectId, moodboardId) as Row[])
    : (await getDb().prepare("SELECT id FROM directions WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC").all(userId, projectId) as Row[]);
  return Promise.all(rows.map((r) => getDirection(userId, String(r.id))));
}
