"use client";

import { ArrowLeft, ArrowDown, ArrowUp, CheckCircle2, ChevronsLeftRight, Download, Eye, EyeOff, Image as ImageIcon, Lock, RotateCcw, ScanSearch, Square, Star, Trash2, Type, Undo2, Redo2, Unlock, AlertTriangle, XCircle, Info } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QaIssue } from "@/agents/qa-inspector/types";
import { normalizeDocument, type DesignDocument, type Layer } from "@/lib/design-engine/schema";
import type { ResolvedAsset } from "@/lib/design-engine/render-html";
import { Badge, Button, cx, Dialog, ErrorNote, Input, scoreTone, Skeleton, timeAgo } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { AppliedChange, Asset, Brand, Critique, Design, DesignVersion, Job, Project } from "@/types/domain";
import { DesignCanvas } from "./design-canvas";
import { PropertiesPanel } from "./properties-panel";
import { AssistantPanel } from "@/components/chat/assistant-panel";

interface Data {
  design: Design;
  project: Project;
  brand: Brand | null;
  versions: DesignVersion[];
  assets: Asset[];
  critiques: (Omit<Critique, "result"> & { findingCount: number })[];
}

const LAYER_ICON = { text: Type, image: ImageIcon, shape: Square };

export function DesignStudio({ id, initialVersionId, openCompare }: { id: string; initialVersionId?: string; openCompare?: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Data>(`/api/designs/${id}`);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [hist, setHist] = useState<{ past: DesignDocument[]; present: DesignDocument | null; future: DesignDocument[] }>({ past: [], present: null, future: [] });
  const { past, present: doc, future } = hist;
  /** Replace the document without recording history (opening a version). */
  const setDoc = useCallback((d: DesignDocument) => setHist({ past: [], present: d, future: [] }), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"design" | "qa" | "history" | "assistant">("design");
  const [originalOpen, setOriginalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [compare, setCompare] = useState<DesignVersion | null>(null);
  const [critiqueJobId, setCritiqueJobId] = useState<string | null>(null);
  const critiqueJob = useJob(critiqueJobId, (j) => {
    setCritiqueJobId(null);
    if (j.status === "failed") toast(j.error ?? "Critique failed", "error");
    else toast("Critique ready");
    void reload();
  });
  const dragBase = useRef<DesignDocument | null>(null);

  const version = data?.versions.find((v) => v.id === versionId) ?? null;
  const current = data?.versions.find((v) => v.id === data.design.currentVersionId) ?? data?.versions[0] ?? null;

  useEffect(() => {
    if (!data || versionId) return;
    const v = data.versions.find((x) => x.id === initialVersionId) ?? data.versions.find((x) => x.id === data.design.currentVersionId) ?? data.versions[0];
    if (!v) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the requested (or current) version once data loads
    setVersionId(v.id);
    setDoc(v.document);
    // Arriving from "Review changes": show the before/after against the parent version straight away.
    const parent = openCompare ? data.versions.find((x) => x.id === v.parentVersionId) : null;
    if (parent?.renderFileId) {
      setCompare(parent);
      setTab("history");
    }
  }, [data, versionId, setDoc, initialVersionId, openCompare]);

  const dirty = Boolean(version && doc && JSON.stringify(version.document) !== JSON.stringify(doc));

  const resolveAsset = useMemo(() => {
    const map = new Map((data?.assets ?? []).map((a) => [a.id, a]));
    return (assetId: string): ResolvedAsset | null => {
      const a = map.get(assetId);
      return a ? { src: `/api/files/${a.preparedFileId ?? a.fileId}`, width: a.width, height: a.height } : null;
    };
  }, [data?.assets]);

  const commit = useCallback((next: DesignDocument) => {
    setHist((h) => ({ past: h.present ? [...h.past.slice(-49), h.present] : h.past, present: next, future: [] }));
  }, []);

  /** Live (non-commit) patches during a drag don't create history; the final commit records the pre-drag state once. */
  const patchLayer = useCallback((layerId: string, patch: Partial<Layer>, isCommit = true) => {
    const base = isCommit ? dragBase.current : null;
    if (isCommit) dragBase.current = null;
    setHist((h) => {
      if (!h.present) return h;
      const next = { ...h.present, layers: h.present.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)) };
      if (!isCommit) {
        dragBase.current ??= h.present;
        return { ...h, present: next };
      }
      return { past: [...h.past.slice(-49), base ?? h.present], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => setHist((h) => (h.past.length && h.present ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length && h.present ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);

  const layer = doc?.layers.find((l) => l.id === selected) ?? null;

  // Keyboard: undo/redo, delete, nudge.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|textarea|select/i.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!layer || layer.locked || !doc) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        commit({ ...doc, layers: doc.layers.filter((l) => l.id !== layer.id) });
        setSelected(null);
      }
      const d = e.shiftKey ? 10 : 1;
      const moves: Record<string, Partial<Layer>> = { ArrowLeft: { x: layer.x - d }, ArrowRight: { x: layer.x + d }, ArrowUp: { y: layer.y - d }, ArrowDown: { y: layer.y + d } };
      if (moves[e.key]) {
        e.preventDefault();
        patchLayer(layer.id, moves[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layer, doc, undo, redo, commit, patchLayer]);

  if (error) return <div className="p-8"><ErrorNote>{error}</ErrorNote></div>;
  if (!data || !doc || !version) {
    return (
      <div className="grid h-dvh grid-cols-[260px_1fr_320px]">
        <Skeleton className="m-4 rounded-xl" />
        <Skeleton className="m-4 rounded-xl" />
        <Skeleton className="m-4 rounded-xl" />
      </div>
    );
  }

  const openVersion = (v: DesignVersion) => {
    if (dirty && !confirm("Discard unsaved changes and open this version?")) return;
    setVersionId(v.id);
    setDoc(v.document);
    setSelected(null);
  };

  const save = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      const { version: v } = await api<{ version: DesignVersion }>(`/api/designs/${id}/versions`, { method: "POST", json: { document: normalizeDocument(doc), changeSummary: summary, baseVersionId: version.id } });
      toast(`Saved as version ${v.number}`);
      setSaveOpen(false);
      setSummary("");
      await reload();
      setVersionId(v.id);
      setDoc(v.document);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const versionAction = async (v: DesignVersion, action: "approve" | "restore" | "critique" | "view", approved?: boolean) => {
    try {
      const res = await api<{ version?: DesignVersion; job?: Job }>(`/api/designs/${id}/versions/${v.id}`, { method: "POST", json: action === "approve" ? { action, approved } : { action } });
      if (action === "view") toast(`Version ${v.number} is now the current version`);
      if (action === "critique" && res.job) setCritiqueJobId(res.job.id);
      if (action === "restore" && res.version) {
        toast(`Restored as version ${res.version.number}`);
        await reload();
        setVersionId(res.version.id);
        setDoc(res.version.document);
        return;
      }
      if (action === "approve") toast(approved ? `Version ${v.number} approved` : "Approval removed");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const addLayer = (type: "text" | "shape" | "image") => {
    const { width: W, height: H } = doc.artboard;
    const base = { id: `${type}-${Date.now().toString(36)}`, x: Math.round(W * 0.1), y: Math.round(H * 0.1), rotation: 0, opacity: 1, locked: false, visible: true };
    let l: Layer;
    if (type === "text") l = { ...base, type, name: "Text", role: "body", text: "New text", width: Math.round(W * 0.5), height: Math.round(H * 0.08), fontFamily: "Inter", fontWeight: 500, fontSize: Math.round(H * 0.03), lineHeight: 1.2, letterSpacing: 0, color: "#1A1816", align: "left", verticalAlign: "top", textTransform: "none", italic: false };
    else if (type === "shape") l = { ...base, type, name: "Rectangle", width: Math.round(W * 0.3), height: Math.round(H * 0.15), shape: "rect", fill: { type: "solid", color: "#6D5BF6" }, stroke: null, strokeWidth: 0, borderRadius: 0, blendMode: "normal" };
    else {
      const a = data.assets.find((x) => x.status !== "rejected" && x.type !== "icon");
      if (!a) return toast("No images in this project's Asset Library yet.", "info");
      l = { ...base, type, name: a.title || "Image", assetId: a.id, width: Math.round(W * 0.4), height: Math.round(H * 0.3), fit: "cover", focalX: 0.5, focalY: 0.5, brightness: 1, contrast: 1, saturation: 1, borderRadius: 0 };
    }
    commit({ ...doc, layers: [...doc.layers, l] });
    setSelected(l.id);
  };

  const move = (layerId: string, dir: 1 | -1) => {
    const i = doc.layers.findIndex((l) => l.id === layerId);
    const j = i + dir;
    if (j < 0 || j >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    commit({ ...doc, layers });
  };

  const qaIssues = version.qa?.issues ?? [];
  const errors = qaIssues.filter((i) => i.severity === "error").length;
  const versionCritique = data.critiques.find((c) => c.designVersionId === version.id);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      {/* Top bar */}
      <div className="flex h-14 flex-none items-center gap-2 border-b border-line bg-bg px-3">
        <Link href={`/projects/${data.project.id}`} aria-label="Back to project" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{data.design.name}</div>
          <div className="flex items-center gap-1.5 truncate text-[12px] text-muted">
            {data.project.name} · v{version.number}
            {version.id === current?.id ? " · current" : ""}
            {version.approved && <Badge tone="success" className="!h-[18px]">Approved</Badge>}
            {dirty && <span className="font-medium text-major">· unsaved changes</span>}
          </div>
        </div>
        <button aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30">
          <Undo2 className="size-4" />
        </button>
        <button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 disabled:opacity-30">
          <Redo2 className="size-4" />
        </button>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        {versionCritique ? (
          <Link href={`/critiques/${versionCritique.id}`} className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] font-medium hover:bg-surface-2 sm:flex">
            Critique <Badge tone={scoreTone(versionCritique.overallScore)}>{versionCritique.overallScore ?? "…"}</Badge>
          </Link>
        ) : (
          <Button size="sm" variant="ghost" icon={<ScanSearch className="size-4" />} loading={Boolean(critiqueJobId)} disabled={dirty} title={dirty ? "Save first" : undefined} onClick={() => versionAction(version, "critique")}>
            Critique
          </Button>
        )}
        {data.design.sourceFileId && (
          <Button size="sm" variant="ghost" icon={<ChevronsLeftRight className="size-4" />} onClick={() => setOriginalOpen(true)}>
            Original
          </Button>
        )}
        <ExportMenu designId={id} versionId={version.id} disabled={dirty} />
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => setSaveOpen(true)}>
          Save version
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* Layers */}
        <aside className="hidden min-h-0 flex-col border-r border-line bg-surface md:flex">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <span className="text-[12px] font-semibold tracking-wider text-subtle uppercase">Layers</span>
            <div className="flex">
              <button aria-label="Add text" title="Add text" onClick={() => addLayer("text")} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><Type className="size-3.5" /></button>
              <button aria-label="Add shape" title="Add rectangle" onClick={() => addLayer("shape")} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><Square className="size-3.5" /></button>
              <button aria-label="Add image" title="Add image from library" onClick={() => addLayer("image")} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"><ImageIcon className="size-3.5" /></button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {[...doc.layers].reverse().map((l) => {
              const Icon = LAYER_ICON[l.type];
              const on = selected === l.id;
              const issue = qaIssues.some((i) => i.layerId === l.id && i.severity === "error");
              return (
                <li key={l.id} className={cx("group flex h-8 items-center gap-1.5 rounded-lg pr-1 pl-2 text-[12.5px]", on ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2", !l.visible && "opacity-50")}>
                  <button onClick={() => setSelected(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Icon className="size-3.5 flex-none text-muted" />
                    <span className="truncate">{l.name}</span>
                    {issue && <span className="size-1.5 flex-none rounded-full bg-critical" title="QA error" />}
                  </button>
                  <span className={cx("flex", on ? "" : "opacity-0 group-hover:opacity-100")}>
                    <button aria-label="Move up" onClick={() => move(l.id, 1)} className="flex size-6 items-center justify-center rounded text-subtle hover:text-ink"><ArrowUp className="size-3" /></button>
                    <button aria-label="Move down" onClick={() => move(l.id, -1)} className="flex size-6 items-center justify-center rounded text-subtle hover:text-ink"><ArrowDown className="size-3" /></button>
                    <button aria-label={l.visible ? "Hide" : "Show"} onClick={() => patchLayer(l.id, { visible: !l.visible })} className="flex size-6 items-center justify-center rounded text-subtle hover:text-ink">{l.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</button>
                  </span>
                  <button aria-label={l.locked ? "Unlock" : "Lock"} onClick={() => patchLayer(l.id, { locked: !l.locked })} className={cx("flex size-6 items-center justify-center rounded hover:text-ink", l.locked ? "text-ink" : "text-subtle opacity-0 group-hover:opacity-100")}>
                    {l.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {layer && !layer.locked && (
            <div className="border-t border-line p-2">
              <button onClick={() => (commit({ ...doc, layers: doc.layers.filter((l) => l.id !== layer.id) }), setSelected(null))} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12.5px] text-critical hover:bg-critical-soft">
                <Trash2 className="size-3.5" /> Delete layer
              </button>
            </div>
          )}
        </aside>

        <div className="min-h-0">
          <DesignCanvas doc={doc} resolveAsset={resolveAsset} selectedId={selected} onSelect={setSelected} onChange={patchLayer} />
        </div>

        {/* Right panel */}
        <aside className="hidden min-h-0 flex-col border-l border-line bg-surface xl:flex">
          <div className="flex flex-none gap-1 border-b border-line px-2 pt-2">
            {(
              [
                ["design", "Design"],
                ["qa", `QA${errors ? ` · ${errors}` : ""}`],
                ["history", `Versions · ${data.versions.length}`],
                ["assistant", "Assistant"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={cx("relative h-9 px-3 text-[13px] font-medium", tab === k ? "text-ink" : "text-muted hover:text-ink")}>
                {label}
                {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
          <div className={cx("min-h-0 flex-1", tab === "assistant" ? "overflow-hidden" : "overflow-y-auto")}>
            {tab === "assistant" && <AssistantPanel projectId={data.project.id} designId={id} onVersionCreated={() => void reload()} />}
            {tab === "design" && <PropertiesPanel doc={doc} layer={layer} assets={data.assets} onLayer={(p) => layer && patchLayer(layer.id, p)} onDoc={(d) => commit(d)} />}
            {tab === "qa" && <QaPanel issues={qaIssues} checks={version.qa?.checksRun ?? []} dirty={dirty} onSelect={(lid) => (setSelected(lid), setTab("design"))} />}
            {tab === "history" && (
              <div className="space-y-2 p-3">
                {critiqueJobId && (
                  <div className="rounded-xl border border-line p-3">
                    <JobProgress job={critiqueJob} />
                  </div>
                )}
                {data.versions.map((v) => {
                  const c = data.critiques.find((x) => x.designVersionId === v.id);
                  return (
                    <div key={v.id} className={cx("rounded-xl border p-2.5", v.id === version.id ? "border-accent-line bg-accent-soft/30" : "border-line")}>
                      <div className="flex gap-2.5">
                        <button onClick={() => openVersion(v)} className="size-14 flex-none overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
                          {v.renderFileId && (
                            // eslint-disable-next-line @next/next/no-img-element -- private files
                            <img src={`/api/files/${v.renderFileId}?thumb=160`} alt="" className="h-full w-full object-contain" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                            v{v.number}
                            {v.id === current?.id && <Badge>current</Badge>}
                            {v.approved && <Badge tone="success">approved</Badge>}
                            {c?.overallScore != null && <Badge tone={scoreTone(c.overallScore)}>{c.overallScore}</Badge>}
                          </div>
                          <div className="line-clamp-2 text-[12px] text-ink-2">{v.changeSummary}</div>
                          <div className="text-[11px] text-subtle">
                            {v.createdBy === "agent" ? "Agent" : "You"} · {timeAgo(v.createdAt)}
                            {v.id !== current?.id && v.number > (current?.number ?? 0) && <span className="font-medium text-major"> · awaiting review</span>}
                          </div>
                        </div>
                      </div>
                      {v.changes.length > 0 && <ChangeList changes={v.changes} compact />}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {v.id !== version.id && <SmallBtn onClick={() => openVersion(v)}>Open</SmallBtn>}
                        {v.id !== version.id && v.renderFileId && version.renderFileId && (
                          <SmallBtn onClick={() => setCompare(v)}>
                            <ChevronsLeftRight className="size-3" /> Compare
                          </SmallBtn>
                        )}
                        {v.id !== current?.id && v.number > (current?.number ?? 0) && (
                          <SmallBtn onClick={() => versionAction(v, "view")}>
                            <CheckCircle2 className="size-3" /> Make current
                          </SmallBtn>
                        )}
                        {v.id !== current?.id && v.number < (current?.number ?? 0) && (
                          <SmallBtn onClick={() => versionAction(v, "restore")}>
                            <RotateCcw className="size-3" /> Restore
                          </SmallBtn>
                        )}
                        <SmallBtn onClick={() => versionAction(v, "approve", !v.approved)}>
                          <Star className={cx("size-3", v.approved && "fill-current text-success")} /> {v.approved ? "Unapprove" : "Approve"}
                        </SmallBtn>
                        {c && <SmallBtn href={`/critiques/${c.id}`}>Critique</SmallBtn>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <AssetCredits doc={doc} assets={data.assets} />
        </aside>
      </div>

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title={`Save as version ${Math.max(...data.versions.map((v) => v.number)) + 1}`}
        description="Every save creates a reviewable version. It's rendered and re-checked by QA; earlier versions stay untouched."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} disabled={!summary.trim()} onClick={save}>
              Save version
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), void save())}>
          <Input autoFocus value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What changed? e.g. Larger headline, tighter tracking" maxLength={300} />
        </form>
      </Dialog>

      <Dialog open={originalOpen} onClose={() => setOriginalOpen(false)} title="Your upload → editable rebuild" description="Drag to compare. Fonts are the closest available matches and effects are simplified; adjust anything in the studio." width="max-w-4xl">
        {data.design.sourceFileId && version.renderFileId && <CompareSlider before={`/api/files/${data.design.sourceFileId}`} after={`/api/files/${version.renderFileId}`} ratio={doc.artboard.width / doc.artboard.height} />}
      </Dialog>

      <Dialog open={Boolean(compare)} onClose={() => setCompare(null)} title={compare ? `v${compare.number} → v${version.number}` : ""} description="Drag to compare before and after." width="max-w-4xl">
        {compare?.renderFileId && version.renderFileId && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <CompareSlider before={`/api/files/${compare.renderFileId}`} after={`/api/files/${version.renderFileId}`} ratio={doc.artboard.width / doc.artboard.height} />
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">What changed</div>
              {version.changes.length ? <ChangeList changes={version.changes} /> : <p className="text-[13px] text-muted">{version.changeSummary}</p>}
              <ScoreDelta before={data.critiques.find((c) => c.designVersionId === compare.id)?.overallScore ?? null} after={data.critiques.find((c) => c.designVersionId === version.id)?.overallScore ?? null} />
              {version.id !== current?.id && version.number > (current?.number ?? 0) && (
                <Button variant="primary" size="sm" className="mt-4 w-full" icon={<CheckCircle2 className="size-4" />} onClick={() => (setCompare(null), void versionAction(version, "view"))}>
                  Accept: make v{version.number} current
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

const OP_LABEL = { update: "Changed", add: "Added", remove: "Removed", reorder: "Moved" } as const;

function ChangeList({ changes, compact }: { changes: AppliedChange[]; compact?: boolean }) {
  return (
    <ul className={cx("space-y-1.5", compact ? "mt-2 border-t border-line pt-2" : "")}>
      {changes.slice(0, compact ? 4 : undefined).map((c, i) => (
        <li key={i} className="text-[12px] leading-snug">
          <span className="font-medium text-ink">
            {OP_LABEL[c.op]} {c.layerId}
          </span>
          {c.fields.length > 0 && <span className="text-subtle"> · {c.fields.join(", ")}</span>}
          {c.findingId && <Badge className="ml-1 !h-[18px]">{c.findingId}</Badge>}
          {!compact && <div className="text-muted">{c.reason}</div>}
        </li>
      ))}
      {compact && changes.length > 4 && <li className="text-[11.5px] text-subtle">+{changes.length - 4} more</li>}
    </ul>
  );
}

function ScoreDelta({ before, after }: { before: number | null; after: number | null }) {
  if (before === null && after === null) return null;
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px]">
      Critique score <Badge tone={scoreTone(before)}>{before ?? "–"}</Badge> → <Badge tone={scoreTone(after)}>{after ?? "–"}</Badge>
    </div>
  );
}

function SmallBtn({ children, onClick, href }: { children: React.ReactNode; onClick?: () => void; href?: string }) {
  const cls = "inline-flex h-6 items-center gap-1 rounded-md bg-surface-2 px-2 text-[11.5px] font-medium text-ink-2 hover:bg-surface-3";
  return href ? <Link href={href} className={cls}>{children}</Link> : <button onClick={onClick} className={cls}>{children}</button>;
}

function QaPanel({ issues, checks, dirty, onSelect }: { issues: QaIssue[]; checks: string[]; dirty: boolean; onSelect: (layerId: string) => void }) {
  const Icon = { error: XCircle, warning: AlertTriangle, info: Info };
  const color = { error: "text-critical", warning: "text-major", info: "text-minor" };
  return (
    <div className="p-4">
      {dirty && <p className="mb-3 rounded-lg bg-major-soft/60 px-3 py-2 text-[12px] text-ink-2">These results are for the saved version. Save to re-run the checks on your edits.</p>}
      <p className="mb-3 text-[12px] text-muted">Objective checks measured on the rendered artwork — not opinions.</p>
      {!issues.length ? (
        <div className="flex items-center gap-2 rounded-xl bg-success-soft/60 px-3 py-3 text-[13px] text-ink">
          <CheckCircle2 className="size-4 text-success" /> All checks passed.
        </div>
      ) : (
        <ul className="space-y-2">
          {issues.map((i, n) => {
            const I = Icon[i.severity];
            return (
              <li key={n}>
                <button disabled={!i.layerId} onClick={() => i.layerId && onSelect(i.layerId)} className="flex w-full gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left hover:border-line-strong disabled:cursor-default">
                  <I className={cx("mt-0.5 size-4 flex-none", color[i.severity])} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-ink">{i.check.replace(/-/g, " ")}</span>
                    <span className="block text-[12px] text-ink-2">{i.message}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {checks.length > 0 && <p className="mt-4 text-[11.5px] text-subtle">Checks run: {checks.join(", ")}</p>}
    </div>
  );
}

function AssetCredits({ doc, assets }: { doc: DesignDocument; assets: Asset[] }) {
  const used = assets.filter((a) => doc.layers.some((l) => l.type === "image" && l.assetId === a.id));
  if (!used.length) return null;
  return (
    <div className="flex-none border-t border-line p-3">
      <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">Images in this design</div>
      {used.map((a) => (
        <div key={a.id} className="text-[11.5px] leading-relaxed text-muted">
          <span className="font-medium text-ink-2">{a.title || "Image"}</span> · {a.provider ?? "your upload"} · {a.license.name}
          {a.sourceUrl && (
            <>
              {" · "}
              <a href={a.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                source
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ExportMenu({ designId, versionId, disabled }: { designId: string; versionId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const opts = [
    { f: "png", s: 1, label: "PNG", hint: "Artboard size" },
    { f: "png", s: 2, label: "PNG @2x", hint: "Retina / high-density screens" },
    { f: "jpg", s: 1, label: "JPG", hint: "Smaller file, no transparency" },
    { f: "pdf", s: 1, label: "PDF", hint: "Vector text; screen RGB, not CMYK-verified" },
    { f: "html", s: 1, label: "HTML/CSS", hint: "Editable code with embedded images" },
  ];
  return (
    <div ref={ref} className="relative">
      <Button size="sm" icon={<Download className="size-4" />} disabled={disabled} title={disabled ? "Save your changes first" : undefined} onClick={() => setOpen((o) => !o)}>
        Export
      </Button>
      {open && (
        <div className="animate-in absolute top-10 right-0 z-30 w-64 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {opts.map((o) => (
            <a key={o.label} href={`/api/designs/${designId}/export?format=${o.f}&scale=${o.s}&version=${versionId}`} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
              <span className="block text-[13px] font-medium">{o.label}</span>
              <span className="block text-[11.5px] text-muted">{o.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareSlider({ before, after, ratio }: { before: string; after: string; ratio: number }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative mx-auto max-h-[70vh] overflow-hidden rounded-lg bg-surface-2 select-none" style={{ aspectRatio: ratio, maxWidth: `min(100%, calc(70vh * ${ratio}))` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
      <img src={after} alt="After" className="absolute inset-0 h-full w-full object-contain" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
        <img src={before} alt="Before" className="absolute inset-0 h-full w-full object-contain" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} />
      <span className="absolute top-2 left-2 rounded bg-ink/70 px-1.5 py-0.5 text-[11px] text-white">Before</span>
      <span className="absolute top-2 right-2 rounded bg-ink/70 px-1.5 py-0.5 text-[11px] text-white">After</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Compare position" className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </div>
  );
}
