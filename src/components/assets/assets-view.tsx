"use client";

import { Check, CheckCircle2, Copy, Download, ExternalLink, Images, Lock, Plus, Search, ShieldAlert, ShieldCheck, ShieldX, Trash2, Unlock, Upload, X } from "lucide-react";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, cx, Dialog, EmptyState, ErrorNote, Input, PageHeader, Segmented, Select, Skeleton, timeAgo } from "@/components/ui";
import { Dropzone } from "@/components/ui/dropzone";
import { useToast } from "@/components/ui/toast";
import { api, uploadFile, useFetch } from "@/hooks/use-api";
import type { AssetCandidate, LicenseVerdict } from "@/lib/integrations/assets/types";
import type { Asset, ProjectSummary } from "@/types/domain";

type Row = Asset & { projectName: string };
type Candidate = AssetCandidate & { verdict: LicenseVerdict };

const VERDICT = {
  "auto-ok": { label: "Commercial use OK", tone: "success" as const, icon: ShieldCheck },
  "needs-review": { label: "Review licence", tone: "major" as const, icon: ShieldAlert },
  blocked: { label: "Not allowed", tone: "critical" as const, icon: ShieldX },
};

export function AssetsView({ initialProjectId }: { initialProjectId?: string }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams({ ...(projectId && { projectId }), ...(type && { type }), ...(status && { status }) }).toString();
  const { data, error, loading, reload } = useFetch<{ assets: Row[] }>(`/api/assets${qs ? `?${qs}` : ""}`);
  const { data: projects } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.assets.find((a) => a.id === openId) ?? null;
  const [searching, setSearching] = useState(false);

  const upload = async (f: File) => {
    if (!projectId) return toast("Choose a project to upload into", "error");
    try {
      await uploadFile(f, { purpose: "asset", projectId });
      toast("Uploaded to the library");
      void reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Library"
        title="Assets"
        description="Every image the agents downloaded or you uploaded, with its source, creator and licence. Originals are never modified; edits use prepared copies."
        actions={
          <>
            <Button icon={<Search className="size-4" />} onClick={() => setSearching(true)} disabled={!projectId} title={!projectId ? "Choose a project first" : undefined}>
              Find assets
            </Button>
            <Dropzone onFile={upload} accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={!projectId} className="!rounded-[10px] !border-0 bg-accent px-3.5 py-2 text-accent-ink shadow-sm hover:!bg-accent-hover">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Upload className="size-4" /> Upload
              </span>
            </Dropzone>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-56">
          <option value="">All projects</option>
          {projects?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40">
          <option value="">All types</option>
          {["photo", "illustration", "vector", "icon"].map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">Any status</option>
          <option value="approved">Approved</option>
          <option value="pending">Needs review</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-[4/3.6] rounded-2xl" />
          ))}
        </div>
      ) : data && !data.assets.length ? (
        <EmptyState icon={<Images className="size-5" />} title="No assets here yet" description={projectId ? "Upload your own images or search the licensed libraries." : "Assets appear as you create designs. Pick a project to upload or search."} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data?.assets.map((a) => (
            <button key={a.id} onClick={() => setOpenId(a.id)} className={cx("group overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", a.status === "rejected" && "opacity-60")}>
              <div className="canvas-grid relative aspect-[4/3]">
                {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                <img src={`/api/files/${a.fileId}?thumb=480`} alt={a.title} className={cx("h-full w-full", a.type === "icon" || a.type === "vector" ? "object-contain p-6" : "object-cover")} />
                <div className="absolute top-2 left-2 flex gap-1">
                  {a.locked && <Badge icon={<Lock className="size-3" />}>Locked</Badge>}
                  {a.status === "pending" && <Badge tone="major">Review</Badge>}
                  {a.status === "rejected" && <Badge tone="critical">Rejected</Badge>}
                </div>
                {a.usageCount > 0 && <span className="absolute right-2 bottom-2 rounded-md bg-ink/70 px-1.5 py-0.5 text-[11px] font-medium text-white">in {a.usageCount} version{a.usageCount === 1 ? "" : "s"}</span>}
              </div>
              <div className="p-3">
                <div className="truncate text-[13px] font-medium">{a.title || "Untitled"}</div>
                <div className="truncate text-[11.5px] text-muted">
                  {a.provider ? `${a.provider} · ` : "Uploaded · "}
                  {a.license.name}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && <AssetDrawer asset={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
      {searching && projectId && <SearchDialog projectId={projectId} onClose={() => setSearching(false)} onImported={() => void reload()} />}
    </div>
  );
}

function AssetDrawer({ asset: a, onClose, onChanged }: { asset: Row; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const patch = async (body: { status?: Asset["status"]; locked?: boolean }) => {
    try {
      await api(`/api/assets/${a.id}`, { method: "PATCH", json: body });
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const lic = a.license;
  const yesNo = (v: boolean | null) => (v === null ? "Not documented" : v ? "Yes" : "No");
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <aside className="animate-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="truncate text-[15px] font-semibold">{a.title || "Untitled asset"}</h2>
          <button aria-label="Close" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="canvas-grid flex aspect-[4/3] items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
            <img src={`/api/files/${a.fileId}?thumb=1000`} alt={a.title} className="max-h-full max-w-full rounded object-contain shadow-md" />
          </div>
          <div className="space-y-5 p-5 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={a.status === "approved" ? "subtle" : "secondary"} icon={<CheckCircle2 className="size-3.5" />} onClick={() => patch({ status: "approved" })} disabled={a.status === "approved"}>
                {a.status === "approved" ? "Approved" : "Approve"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => patch({ status: a.status === "rejected" ? "pending" : "rejected" })}>
                {a.status === "rejected" ? "Un-reject" : "Reject"}
              </Button>
              <Button size="sm" icon={a.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />} onClick={() => patch({ locked: !a.locked })}>
                {a.locked ? "Unlock" : "Lock"}
              </Button>
              <a href={`/api/files/${a.fileId}?download=1`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium shadow-sm hover:bg-surface-2">
                <Download className="size-3.5" /> Original
              </a>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted">Project</dt>
              <dd>{a.projectName}</dd>
              <dt className="text-muted">Size</dt>
              <dd>{a.width && a.height ? `${a.width} × ${a.height}px` : "Vector"}</dd>
              <dt className="text-muted">Source</dt>
              <dd>
                {a.sourceUrl ? (
                  <a href={a.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">
                    {a.provider} <ExternalLink className="size-3" />
                  </a>
                ) : (
                  "Uploaded by you"
                )}
              </dd>
              <dt className="text-muted">Creator</dt>
              <dd>{a.creatorUrl ? <a href={a.creatorUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{a.creator}</a> : a.creator ?? "—"}</dd>
              <dt className="text-muted">Retrieved</dt>
              <dd>{a.retrievedAt ? new Date(a.retrievedAt).toLocaleString("en-GB") : timeAgo(a.createdAt)}</dd>
              <dt className="text-muted">Used in</dt>
              <dd>{a.usageCount} design version{a.usageCount === 1 ? "" : "s"}</dd>
            </dl>
            <div className="rounded-xl border border-line p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">{lic.name}</span>
                {lic.url && (
                  <a href={lic.url} target="_blank" rel="noreferrer noopener" className="text-[12px] text-accent hover:underline">
                    Licence terms
                  </a>
                )}
              </div>
              <dl className="grid grid-cols-[150px_1fr] gap-y-1 text-[12.5px]">
                <dt className="text-muted">Commercial use</dt>
                <dd>{yesNo(lic.commercialUse)}</dd>
                <dt className="text-muted">Modification</dt>
                <dd>{yesNo(lic.modificationAllowed)}</dd>
                <dt className="text-muted">Attribution required</dt>
                <dd>{lic.attributionRequired ? "Yes" : "No"}</dd>
                <dt className="text-muted">Share-alike</dt>
                <dd>{lic.shareAlike ? "Yes" : "No"}</dd>
              </dl>
              {lic.notes && <p className="mt-2 text-[12px] text-muted">{lic.notes}</p>}
              {a.attribution && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-[12px]">
                  <span className="flex-1">{a.attribution}</span>
                  <button aria-label="Copy attribution" onClick={() => (navigator.clipboard.writeText(a.attribution!), toast("Attribution copied"))} className="text-muted hover:text-ink">
                    <Copy className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
            {a.analysis.selectionReason && (
              <div>
                <div className="mb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">Why the agent chose it</div>
                <p className="text-ink-2">{a.analysis.selectionReason}</p>
              </div>
            )}
            {a.analysis.dominantColors && (
              <div className="flex gap-1.5">
                {a.analysis.dominantColors.map((c) => (
                  <span key={c} title={c} className="size-6 rounded-md ring-1 ring-line" style={{ background: c }} />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-line p-4">
          <Button variant="ghost" className="w-full text-critical hover:bg-critical-soft" icon={<Trash2 className="size-4" />} disabled={a.locked || a.usageCount > 0} title={a.locked ? "Unlock first" : a.usageCount ? "Used in a design version" : undefined} onClick={() => setRemoving(true)}>
            {a.usageCount > 0 ? "In use — can’t remove" : a.locked ? "Locked — can’t remove" : "Remove from library"}
          </Button>
        </div>
      </aside>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={async () => {
          try {
            await api(`/api/assets/${a.id}`, { method: "DELETE" });
            toast("Asset removed");
            onClose();
            onChanged();
          } catch (e) {
            toast(e instanceof Error ? e.message : String(e), "error");
          }
        }}
        title="Remove this asset?"
        description="The original file and its prepared copy are deleted from the project."
        confirmLabel="Remove"
      />
    </div>
  );
}

function SearchDialog({ projectId, onClose, onImported }: { projectId: string; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"photo" | "icon">("photo");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ candidates: Candidate[]; errors: { provider: string; message: string }[] } | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      setResults(await api("/api/assets/search", { method: "POST", json: { query, kinds: [kind] } }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const add = async (c: Candidate) => {
    const key = `${c.provider}:${c.providerId}`;
    setImporting(key);
    try {
      await api("/api/assets/import", { method: "POST", json: { projectId, query, candidate: { provider: c.provider, providerId: c.providerId } } });
      setDone((d) => new Set(d).add(key));
      toast(c.verdict === "needs-review" ? "Downloaded — marked for licence review" : "Downloaded to the library");
      onImported();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Find licensed assets" description="Results come straight from the providers. Downloading stores the original file and its licence in this project." width="max-w-4xl">
      <form onSubmit={(e) => (e.preventDefault(), void search())} className="flex flex-wrap gap-2">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Matterhorn sunrise, espresso close-up" className="min-w-0 flex-1" />
        <Segmented value={kind} onChange={setKind} options={[{ value: "photo", label: "Photos" }, { value: "icon", label: "Icons" }]} />
        <Button type="submit" variant="primary" loading={busy} icon={<Search className="size-4" />}>
          Search
        </Button>
      </form>
      {results?.errors.length ? <p className="mt-3 text-[12px] text-major">Some providers didn’t respond: {results.errors.map((e) => `${e.provider} (${e.message})`).join(", ")}</p> : null}
      <div className="mt-4 max-h-[60vh] overflow-y-auto">
        {results && !results.candidates.length && <p className="py-10 text-center text-sm text-muted">No results.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results?.candidates.map((c) => {
            const v = VERDICT[c.verdict];
            const key = `${c.provider}:${c.providerId}`;
            return (
              <div key={key} className="overflow-hidden rounded-xl border border-line">
                <div className="canvas-grid aspect-[4/3]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- provider thumbnails */}
                  <img src={c.thumbnailUrl} alt={c.title} referrerPolicy="no-referrer" loading="lazy" className={cx("h-full w-full", c.type === "icon" ? "object-contain p-6" : "object-cover")} />
                </div>
                <div className="space-y-1.5 p-2.5">
                  <div className="truncate text-[12px] font-medium" title={c.title}>{c.title}</div>
                  <div className="truncate text-[11px] text-muted">
                    {c.provider} · {c.width && c.height ? `${c.width}×${c.height}` : c.type} · {c.license.name}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <Badge tone={v.tone} icon={<v.icon className="size-3" />}>{v.label}</Badge>
                    {done.has(key) ? (
                      <span className="flex items-center gap-1 text-[11.5px] font-medium text-success">
                        <Check className="size-3.5" /> Added
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" className="!h-7 !px-2" disabled={c.verdict === "blocked"} loading={importing === key} onClick={() => add(c)} icon={<Plus className="size-3.5" />} aria-label="Add to project" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
