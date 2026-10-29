"use client";

import { ArrowLeft, FileText, History, Lock, Plus, ScanText, Sparkles, Trash2, Unlock, X, Lightbulb, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ExtractedBrand } from "@/agents/brand-guardian";
import { Badge, Button, ConfirmDialog, cx, ErrorNote, Field, IconButton, Input, Panel, Select, Skeleton, Textarea, timeAgo } from "@/components/ui";
import { Dropzone } from "@/components/ui/dropzone";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, uploadFile, useFetch, useJob } from "@/hooks/use-api";
import type { Brand, BrandChange, Job, RuleLock, StoredFile } from "@/types/domain";

interface Data {
  brand: Brand;
  files: StoredFile[];
  history: BrandChange[];
}

const LOCKS: { value: RuleLock; label: string; icon: typeof Lock }[] = [
  { value: "locked", label: "Locked", icon: Lock },
  { value: "flexible", label: "Flexible", icon: Unlock },
  { value: "inspirational", label: "Inspiration", icon: Lightbulb },
];

function LockSelect({ value, onChange }: { value: RuleLock; onChange: (v: RuleLock) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as RuleLock)} className="w-[118px] flex-none" aria-label="Rule strictness">
      {LOCKS.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </Select>
  );
}

type Form = Omit<Brand, "id" | "createdAt" | "updatedAt">;

function toForm(b: Brand): Form {
  return {
    name: b.name,
    description: b.description,
    industry: b.industry,
    audience: b.audience,
    personality: b.personality,
    photographyStyle: b.photographyStyle,
    graphicElements: b.graphicElements,
    colors: b.colors,
    typography: b.typography,
    restrictions: b.restrictions,
    logoFileIds: b.logoFileIds,
    referenceFileIds: b.referenceFileIds,
    guidelineFileIds: b.guidelineFileIds,
  };
}

export function BrandEditor({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload } = useFetch<Data>(`/api/brands/${id}`);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [extractJobId, setExtractJobId] = useState<string | null>(null);
  const [extractText, setExtractText] = useState("");
  const [extractFiles, setExtractFiles] = useState<string[]>([]);
  const [proposal, setProposal] = useState<ExtractedBrand | null>(null);
  const extractJob = useJob(extractJobId, (j) => {
    setExtractJobId(null);
    if (j.status === "failed") toast(j.error ?? "Extraction failed", "error");
    else setProposal((j.result as { proposal: ExtractedBrand }).proposal);
  });

  useEffect(() => {
    if (!data) return;
    const fresh = toForm(data.brand);
    // Seed once; afterwards only sync file lists (uploads save immediately) so unsaved edits survive.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the loaded brand
    setForm((prev) => (prev ? { ...prev, logoFileIds: fresh.logoFileIds, referenceFileIds: fresh.referenceFileIds, guidelineFileIds: fresh.guidelineFileIds } : fresh));
  }, [data]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !form) return <Skeleton className="h-96 rounded-2xl" />;

  const saved = toForm(data.brand);
  const dirty = JSON.stringify(saved) !== JSON.stringify(form);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const fileById = new Map(data.files.map((f) => [f.id, f]));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api<{ brand: Brand }>(`/api/brands/${id}`, { method: "PATCH", json: form });
      setForm(toForm(res.brand));
      toast("Brand saved");
      await reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File, purpose: "brand-logo" | "brand-reference" | "brand-guideline") => {
    try {
      await uploadFile(file, { purpose, brandId: id });
      toast("Uploaded");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const removeFile = async (key: "logoFileIds" | "referenceFileIds" | "guidelineFileIds", fileId: string) => {
    const next = form[key].filter((f) => f !== fileId);
    set(key, next);
    await api(`/api/brands/${id}`, { method: "PATCH", json: { [key]: next, changeSummary: `Removed ${fileById.get(fileId)?.originalName ?? "file"}` } });
    await reload();
  };

  const extract = async () => {
    try {
      const { job } = await api<{ job: Job }>(`/api/brands/${id}/extract`, { method: "POST", json: { fileIds: extractFiles, text: extractText } });
      setProposal(null);
      setExtractJobId(job.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const applyProposal = (p: ExtractedBrand, pick: Set<string>) => {
    setForm((f) => {
      if (!f) return f;
      const next = { ...f };
      for (const k of ["description", "industry", "audience", "personality", "photographyStyle", "graphicElements"] as const) {
        if (pick.has(k) && p[k]) next[k] = p[k]!;
      }
      p.colors.forEach((c, i) => pick.has(`c${i}`) && !next.colors.some((x) => x.hex === c.hex) && (next.colors = [...next.colors, { name: c.name, hex: c.hex, role: c.role, lock: "locked" }]));
      p.typography.forEach((t, i) => pick.has(`t${i}`) && (next.typography = [...next.typography, { role: t.role, family: t.family, weights: t.weights, notes: t.notes, lock: "locked" }]));
      p.restrictions.forEach((r, i) => pick.has(`r${i}`) && (next.restrictions = [...next.restrictions, { text: r.text, lock: "locked" }]));
      return next;
    });
    setProposal(null);
    toast("Added to the form. Review, then save.", "info");
  };

  return (
    <div className="animate-in pb-24">
      <Link href="/brands" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Brand Library
      </Link>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-14 overflow-hidden rounded-2xl ring-1 ring-line">
            {form.colors.length ? form.colors.slice(0, 4).map((c, i) => <div key={i} className="flex-1" style={{ background: c.hex }} />) : <div className="canvas-grid flex-1" />}
          </div>
          <div>
            <h1 className="font-display text-[30px] leading-tight font-semibold">{form.name || "Untitled brand"}</h1>
            <p className="text-[13px] text-muted">Updated {timeAgo(data.brand.updatedAt)}</p>
          </div>
        </div>
        <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
          Delete brand
        </Button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel>
            <SectionHead title="Identity" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
              </Field>
              <Field label="Industry">
                <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Rail travel & tourism" />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <Field label="Target audience">
                <Textarea rows={2} value={form.audience} onChange={(e) => set("audience", e.target.value)} />
              </Field>
              <Field label="Personality & tone">
                <Textarea rows={2} value={form.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Calm, precise, quietly premium" />
              </Field>
            </div>
          </Panel>

          <Panel>
            <SectionHead title="Colour palette" hint="Locked colours are the only ones the builder may use for brand elements." action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set("colors", [...form.colors, { name: "", hex: "#6D5BF6", role: "accent", lock: "locked" }])}>Add colour</Button>} />
            <div className="space-y-2">
              {form.colors.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <label className="relative size-9 flex-none cursor-pointer overflow-hidden rounded-[10px] ring-1 ring-line" style={{ background: c.hex }}>
                    <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#000000"} onChange={(e) => set("colors", form.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)))} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Pick colour" />
                  </label>
                  <Input value={c.hex} onChange={(e) => set("colors", form.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} className="w-[92px] flex-none font-mono text-[12.5px] uppercase" maxLength={7} />
                  <Input value={c.name} placeholder="Name" onChange={(e) => set("colors", form.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="min-w-0 flex-[1.4]" />
                  <Input value={c.role} placeholder="Role" onChange={(e) => set("colors", form.colors.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} className="min-w-0 flex-1" />
                  <LockSelect value={c.lock} onChange={(v) => set("colors", form.colors.map((x, j) => (j === i ? { ...x, lock: v } : x)))} />
                  <IconButton label="Remove colour" onClick={() => set("colors", form.colors.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
              {!form.colors.length && <Empty text="No colours yet." />}
            </div>
          </Panel>

          <Panel>
            <SectionHead title="Typography" action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set("typography", [...form.typography, { role: "display", family: "", weights: "", notes: "", lock: "locked" }])}>Add typeface</Button>} />
            <div className="space-y-3">
              {form.typography.map((t, i) => (
                <div key={i} className="rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <Input value={t.role} placeholder="Role (display, body…)" onChange={(e) => set("typography", form.typography.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} className="min-w-0 flex-1" />
                    <Input value={t.family} placeholder="Family" onChange={(e) => set("typography", form.typography.map((x, j) => (j === i ? { ...x, family: e.target.value } : x)))} className="min-w-0 flex-[1.4]" />
                    <Input value={t.weights} placeholder="Weights" onChange={(e) => set("typography", form.typography.map((x, j) => (j === i ? { ...x, weights: e.target.value } : x)))} className="w-20 flex-none" />
                    <LockSelect value={t.lock} onChange={(v) => set("typography", form.typography.map((x, j) => (j === i ? { ...x, lock: v } : x)))} />
                    <IconButton label="Remove typeface" onClick={() => set("typography", form.typography.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </IconButton>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[22px] leading-none text-ink" style={{ fontFamily: `"${t.family}", var(--font-sans)` }}>
                      Aa Bb Cc 0123
                    </span>
                    <Input value={t.notes} placeholder="Usage notes" onChange={(e) => set("typography", form.typography.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} className="w-48 flex-none" />
                  </div>
                </div>
              ))}
              {!form.typography.length && <Empty text="No typography yet." />}
            </div>
          </Panel>

          <Panel>
            <SectionHead title="Imagery & graphic language" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Photography style">
                <Textarea rows={3} value={form.photographyStyle} onChange={(e) => set("photographyStyle", e.target.value)} placeholder="Natural light, wide landscapes, people small in frame…" />
              </Field>
              <Field label="Graphic elements">
                <Textarea rows={3} value={form.graphicElements} onChange={(e) => set("graphicElements", e.target.value)} placeholder="Thin rule lines, route-map dots…" />
              </Field>
            </div>
          </Panel>

          <Panel>
            <SectionHead title="Rules & restrictions" action={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set("restrictions", [...form.restrictions, { text: "", lock: "locked" }])}>Add rule</Button>} />
            <div className="space-y-2">
              {form.restrictions.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={r.text} placeholder="e.g. Never place the logo on photography without the white panel" onChange={(e) => set("restrictions", form.restrictions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                  <LockSelect value={r.lock} onChange={(v) => set("restrictions", form.restrictions.map((x, j) => (j === i ? { ...x, lock: v } : x)))} />
                  <IconButton label="Remove rule" onClick={() => set("restrictions", form.restrictions.filter((_, j) => j !== i))}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
              {!form.restrictions.length && <Empty text="No rules yet." />}
            </div>
          </Panel>

          <Panel>
            <SectionHead title="Files" hint="Logos are always protected: agents never redraw, recolour or crop them." />
            <div className="grid gap-5 md:grid-cols-3">
              {(
                [
                  ["Logos", "logoFileIds", "brand-logo", "image/png,image/jpeg,image/webp,image/svg+xml"],
                  ["Reference imagery", "referenceFileIds", "brand-reference", "image/png,image/jpeg,image/webp"],
                  ["Guideline documents", "guidelineFileIds", "brand-guideline", "application/pdf,image/png,image/jpeg,image/webp"],
                ] as const
              ).map(([label, key, purpose, accept]) => (
                <div key={key}>
                  <div className="mb-2 text-[13px] font-medium text-ink-2">{label}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {form[key].map((fid) => {
                      const f = fileById.get(fid);
                      return (
                        <div key={fid} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line" title={f?.originalName}>
                          {f?.mime === "application/pdf" ? (
                            <div className="flex h-full flex-col items-center justify-center p-1 text-center">
                              <FileText className="size-5 text-muted" />
                              <span className="mt-1 line-clamp-2 text-[9.5px] text-muted">{f.originalName}</span>
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element -- private files
                            <img src={`/api/files/${fid}?thumb=200`} alt={f?.originalName ?? ""} className="h-full w-full object-contain p-1" />
                          )}
                          <button onClick={() => removeFile(key, fid)} aria-label="Remove file" className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full bg-ink/70 text-white group-hover:flex">
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                    <Dropzone onFile={(f) => upload(f, purpose)} accept={accept} className="aspect-square !rounded-lg !border">
                      <Plus className="size-4 text-muted" />
                    </Dropzone>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <ScanText className="size-4 text-accent" />
              <h2 className="text-[14px] font-semibold">Extract from guidelines</h2>
            </div>
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted">The Brand Guardian reads your PDFs, images or pasted text and proposes rules. Nothing is applied until you review it — and it won’t guess values that aren’t stated.</p>
            {data.files.filter((f) => f.kind === "guideline").length > 0 && (
              <div className="mb-3 space-y-1.5">
                {data.files
                  .filter((f) => f.kind === "guideline")
                  .map((f) => (
                    <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2">
                      <input type="checkbox" className="accent-[var(--accent)]" checked={extractFiles.includes(f.id)} onChange={(e) => setExtractFiles((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))} />
                      <FileText className="size-3.5 text-muted" />
                      <span className="truncate">{f.originalName}</span>
                    </label>
                  ))}
              </div>
            )}
            <Textarea rows={4} value={extractText} onChange={(e) => setExtractText(e.target.value)} placeholder="…or paste written guidelines here" className="mb-3 text-[13px]" />
            {extractJobId ? (
              <JobProgress job={extractJob} />
            ) : (
              <Button className="w-full" icon={<Sparkles className="size-4" />} onClick={extract} disabled={!extractFiles.length && !extractText.trim()}>
                Propose brand rules
              </Button>
            )}
          </Panel>

          {proposal && <ProposalReview proposal={proposal} onApply={applyProposal} onDismiss={() => setProposal(null)} />}

          <Panel>
            <div className="mb-3 flex items-center gap-2">
              <History className="size-4 text-muted" />
              <h2 className="text-[14px] font-semibold">History</h2>
            </div>
            <ol className="space-y-2.5">
              {data.history.slice(0, 12).map((h) => (
                <li key={h.id} className="flex gap-2.5 text-[12.5px]">
                  <span className="mt-1.5 size-1.5 flex-none rounded-full bg-line-strong" />
                  <div>
                    <div className="text-ink-2">{h.summary}</div>
                    <div className="text-subtle">{timeAgo(h.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>

      {/* Sticky save bar */}
      <div className={cx("fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-surface/95 backdrop-blur transition-transform lg:left-[248px]", dirty ? "translate-y-0" : "translate-y-full")}>
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-3 sm:px-8 lg:px-12">
          <span className="text-[13px] text-muted">{saveError ? <span className="text-critical">{saveError}</span> : "You have unsaved changes."}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setForm(saved)}>
              Discard
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Save brand
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await api(`/api/brands/${id}`, { method: "DELETE" });
          toast("Brand deleted");
          router.push("/brands");
        }}
        title="Delete this brand?"
        description="Projects using it keep their work but lose the brand rules. Logos and guideline files are deleted."
        confirmText={form.name}
        confirmLabel="Delete brand"
      />
    </div>
  );
}

function SectionHead({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] text-subtle">{text}</p>;
}

function ProposalReview({ proposal, onApply, onDismiss }: { proposal: ExtractedBrand; onApply: (p: ExtractedBrand, pick: Set<string>) => void; onDismiss: () => void }) {
  const textKeys = (["description", "industry", "audience", "personality", "photographyStyle", "graphicElements"] as const).filter((k) => proposal[k]);
  const all = [...textKeys, ...proposal.colors.map((_, i) => `c${i}`), ...proposal.typography.map((_, i) => `t${i}`), ...proposal.restrictions.map((_, i) => `r${i}`)];
  const [pick, setPick] = useState(new Set<string>(all));
  const toggle = (k: string) => setPick((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const Row = ({ k, children, evidence }: { k: string; children: React.ReactNode; evidence?: string }) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <input type="checkbox" checked={pick.has(k)} onChange={() => toggle(k)} className="mt-1 accent-[var(--accent)]" />
      <div className="min-w-0 text-[12.5px]">
        {children}
        {evidence && <div className="truncate text-[11px] text-subtle">{evidence}</div>}
      </div>
    </label>
  );
  return (
    <Panel className="animate-in border-accent-line">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Proposed rules</h2>
        <Badge tone="accent">{all.length} items</Badge>
      </div>
      <div className="max-h-[420px] space-y-0.5 overflow-y-auto">
        {textKeys.map((k) => (
          <Row key={k} k={k}>
            <span className="font-medium capitalize">{k.replace(/([A-Z])/g, " $1")}: </span>
            {proposal[k]}
          </Row>
        ))}
        {proposal.colors.map((c, i) => (
          <Row key={`c${i}`} k={`c${i}`} evidence={c.evidence}>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded ring-1 ring-line" style={{ background: c.hex }} /> <b>{c.name}</b> <span className="font-mono">{c.hex}</span> · {c.role}
            </span>
          </Row>
        ))}
        {proposal.typography.map((t, i) => (
          <Row key={`t${i}`} k={`t${i}`} evidence={t.evidence}>
            <b>{t.role}:</b> {t.family} {t.weights && `(${t.weights})`}
          </Row>
        ))}
        {proposal.restrictions.map((r, i) => (
          <Row key={`r${i}`} k={`r${i}`} evidence={r.evidence}>
            {r.text}
          </Row>
        ))}
      </div>
      {proposal.missing.length > 0 && (
        <div className="mt-3 rounded-lg bg-major-soft/60 p-2.5 text-[12px] text-ink-2">
          <b>Not stated in the source:</b> {proposal.missing.join("; ")}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button variant="primary" size="sm" icon={<Check className="size-3.5" />} onClick={() => onApply(proposal, pick)} disabled={!pick.size}>
          Add {pick.size} to form
        </Button>
      </div>
    </Panel>
  );
}
