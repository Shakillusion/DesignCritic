"use client";

import { ArrowRight, Check, ImagePlus, Mountain, Plus, Sparkles, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ArtDirection } from "@/agents/research/schema";
import { FORMAT_PRESETS } from "@/lib/design-engine/schema";
import { Badge, Button, cx, ErrorNote, Field, Input, PageHeader, Panel, Segmented, Select, Textarea } from "@/components/ui";
import { Dropzone } from "@/components/ui/dropzone";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { api, uploadFile, useFetch, useJob } from "@/hooks/use-api";
import type { Asset, Job, Preferences, ProjectSummary, StoredFile } from "@/types/domain";

const EXAMPLES = [
  { label: "Swiss tourism poster", brief: "Create a premium tourism poster promoting Switzerland using professional landscape photography. Calm, majestic, quietly luxurious — for travellers planning a summer trip.", preset: "poster-digital", headline: "", style: "Editorial, generous negative space, refined serif headline" },
  { label: "Running brand launch", brief: "A premium social media post launching a new running shoe brand. Energetic, cinematic and a little experimental.", preset: "instagram-post", headline: "", style: "Bold condensed type, motion, high contrast" },
  { label: "Italian restaurant", brief: "A campaign visual for an authentic Italian restaurant opening in the city: warm, crafted, family recipes, evening dinners.", preset: "instagram-post", headline: "", style: "Warm light, classic serif, appetite appeal" },
];

type FormatKey = keyof typeof FORMAT_PRESETS | "custom";

function RatioIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const s = 22 / Math.max(w, h);
  return <span className={cx("block rounded-[3px] border-[1.5px]", active ? "border-accent bg-accent-soft" : "border-line-strong")} style={{ width: Math.max(8, w * s), height: Math.max(8, h * s) }} />;
}

export function CreateView({ initialProjectId, initialDirectionId }: { initialProjectId?: string; initialDirectionId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data: projects, reload: reloadProjects } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const { data: settings } = useFetch<{ preferences: Preferences }>("/api/settings");
  const { data: status } = useFetch<{ ai: { configured: boolean }; renderer: { available: boolean; detail: string } }>("/api/status");
  const [chosenProjectId, setProjectId] = useState(initialProjectId ?? "");
  const projectId = chosenProjectId || projects?.projects[0]?.id || "";
  const [brief, setBrief] = useState("");
  const [preset, setPreset] = useState<FormatKey>("poster-digital");
  const [custom, setCustom] = useState({ width: 1080, height: 1350 });
  const [copy, setCopy] = useState({ headline: "", supportingCopy: "", cta: "" });
  const [audience, setAudience] = useState("");
  const [style, setStyle] = useState("");
  const [freedomChoice, setFreedom] = useState<"conservative" | "balanced" | "experimental" | null>(null);
  const freedom = freedomChoice ?? settings?.preferences.creativityLevel ?? "balanced";
  const [variations, setVariations] = useState<"1" | "2" | "3">("1");
  const [assetModeChoice, setAssetMode] = useState<"automatic" | "uploaded" | null>(null);
  const assetMode = assetModeChoice ?? settings?.preferences.assetMode ?? "automatic";
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [references, setReferences] = useState<StoredFile[]>([]);
  const [direction, setDirection] = useState<ArtDirection | null>(null);

  // "Use in Create" from a moodboard: carry the chosen art direction and its references into the brief.
  useEffect(() => {
    if (!initialDirectionId) return;
    let cancelled = false;
    api<{ direction: { data: ArtDirection }; referenceFileIds: string[] }>(`/api/directions?id=${initialDirectionId}`)
      .then(({ direction: d, referenceFileIds }) => {
        if (cancelled) return;
        const dir = d.data;
        setDirection(dir);
        setStyle(`${dir.name}: ${dir.idea} Type: ${dir.typography} Palette: ${dir.palette.join(", ")}. Imagery: ${dir.imagery}`.slice(0, 500));
        setBrief((b) => b || `${dir.idea} Composition: ${dir.composition}. Avoid: ${dir.avoid.join(", ")}.`.slice(0, 4000));
        setReferences(referenceFileIds.map((id) => ({ id }) as StoredFile));
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
    return () => {
      cancelled = true;
    };
  }, [initialDirectionId, toast]);
  const [newProject, setNewProject] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: assetData, reload: reloadAssets } = useFetch<{ assets: Asset[] }>(projectId ? `/api/assets?projectId=${projectId}` : null);
  const job = useJob(jobId, (j) => {
    if (j.status === "succeeded") {
      const designs = (j.result as { designs: { designId: string }[] }).designs;
      toast(designs.length > 1 ? `${designs.length} concepts ready` : "Design ready");
      if (designs.length === 1) router.push(`/designs/${designs[0].designId}`);
    }
  });


  const ownAssets = useMemo(() => (assetData?.assets ?? []).filter((a) => a.source === "upload" && a.status !== "rejected" && a.type === "photo"), [assetData]);
  const project = projects?.projects.find((p) => p.id === projectId);

  const applyExample = (e: (typeof EXAMPLES)[number]) => {
    setBrief(e.brief);
    setPreset(e.preset as FormatKey);
    setStyle(e.style);
    setAssetMode("automatic");
  };

  const uploadOwn = async (f: File) => {
    if (!projectId) return toast("Choose a project first", "error");
    try {
      const { asset } = await uploadFile<{ asset: Asset }>(f, { purpose: "asset", projectId });
      await reloadAssets();
      setSelectedAssets((s) => [...s, asset.id]);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const uploadReference = async (f: File) => {
    if (!projectId) return toast("Choose a project first", "error");
    try {
      const { file } = await uploadFile<{ file: StoredFile }>(f, { purpose: "reference", projectId });
      setReferences((r) => [...r, file].slice(-4));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const submit = async () => {
    setError(null);
    if (!projectId) return setError("Choose or create a project.");
    if (brief.trim().length < 10) return setError("Describe what you need in at least a sentence.");
    if (assetMode === "uploaded" && !selectedAssets.length) return setError("Select or upload at least one image, or switch to automatic sourcing.");
    setSubmitting(true);
    try {
      const { job: j } = await api<{ job: Job }>("/api/designs", {
        method: "POST",
        json: {
          projectId,
          brief,
          preset: preset === "custom" ? "custom" : preset,
          customSize: preset === "custom" ? custom : null,
          headline: copy.headline || undefined,
          supportingCopy: copy.supportingCopy || undefined,
          cta: copy.cta || undefined,
          audience: audience || undefined,
          style: style || undefined,
          creativeFreedom: freedom,
          variations: Number(variations),
          assetMode,
          uploadedAssetIds: assetMode === "uploaded" ? selectedAssets : [],
          referenceFileIds: references.map((r) => r.id),
        },
      });
      setJobId(j.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (jobId) {
    const result = job?.status === "succeeded" ? (job.result as { designs: { designId: string; score?: number; qaErrors: number }[] }) : null;
    return (
      <div className="animate-in mx-auto max-w-2xl">
        <PageHeader eyebrow="Create mode" title={job?.status === "failed" ? "The build stopped" : result ? "Your designs are ready" : "Building your design"} description={result ? "Each concept is an editable layout with real text and vector layers, saved as version 1." : "The agents work in sequence. Every step is real: search, licence check, download, layout, render, inspection and critique."} />
        <Panel>
          <JobProgress job={job} />
          {job?.status === "failed" && (
            <div className="mt-5 space-y-3">
              <ErrorNote>{job.error}</ErrorNote>
              <Button onClick={() => setJobId(null)}>Back to the brief</Button>
            </div>
          )}
          {result && result.designs.length > 1 && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {result.designs.map((d, i) => (
                <Link key={d.designId} href={`/designs/${d.designId}`} className="flex items-center justify-between rounded-xl border border-line p-3 hover:border-accent-line hover:bg-accent-soft/30">
                  <span className="text-[13.5px] font-medium">Concept {i + 1}</span>
                  {d.score !== undefined && <Badge tone="accent">{d.score}</Badge>}
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <PageHeader eyebrow="Create mode" title="From a rough idea to an editable design" description="Describe it like you would to a creative director. The agents write the brief, source licensed photography, compose the layout, check it, and critique the result." />
      {direction && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-accent-line bg-accent-soft/40 px-4 py-3">
          <div className="flex h-8 w-20 flex-none overflow-hidden rounded-lg ring-1 ring-line">
            {direction.palette.map((c) => <div key={c} className="flex-1" style={{ background: c }} />)}
          </div>
          <div className="min-w-0 text-[13px]">
            <span className="font-semibold">Direction: {direction.name}.</span> <span className="text-ink-2">Brief, style and style references are prefilled from your moodboard — edit anything below.</span>
          </div>
        </div>
      )}
      {status && (!status.ai.configured || !status.renderer.available) && (
        <div className="mb-6">
          <ErrorNote>{!status.ai.configured ? "No AI provider is connected yet. Add a free GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to .env.local, restart the dev server, and choose it in Settings." : `Rendering is unavailable: ${status.renderer.detail}`}</ErrorNote>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Panel className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">The brief</h2>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button key={e.label} onClick={() => applyExample(e)} className="flex h-7 items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 text-[12px] font-medium text-muted hover:bg-surface-3 hover:text-ink">
                    {e.label === "Swiss tourism poster" && <Mountain className="size-3.5" />}
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <Textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Create a premium social campaign for a new running brand. Energetic, cinematic, experimental…" maxLength={4000} className="text-[15px]" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Audience">
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Visual style">
                <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Optional — e.g. Swiss editorial, warm film photography" />
              </Field>
            </div>
            <details className="group rounded-xl border border-line px-4 py-3 open:pb-4">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-3.5 transition-transform group-open:rotate-45" /> Exact copy (optional — otherwise the Creative Director writes it)
                </span>
              </summary>
              <div className="mt-3 grid gap-3">
                <Input value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} placeholder="Headline" maxLength={200} />
                <Textarea rows={2} value={copy.supportingCopy} onChange={(e) => setCopy({ ...copy, supportingCopy: e.target.value })} placeholder="Supporting copy" maxLength={1000} />
                <Input value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} placeholder="Call to action" maxLength={120} />
              </div>
            </details>
          </Panel>

          <Panel>
            <h2 className="mb-3 text-[15px] font-semibold">Format</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(Object.entries(FORMAT_PRESETS) as [keyof typeof FORMAT_PRESETS, (typeof FORMAT_PRESETS)[string]][]).map(([key, p]) => (
                <button key={key} onClick={() => setPreset(key)} className={cx("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors", preset === key ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}>
                  <span className="flex size-6 flex-none items-center justify-center">
                    <RatioIcon w={p.width} h={p.height} active={preset === key} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] leading-snug font-medium">{p.label.split(" · ")[0]}</span>
                    <span className="block truncate text-[11px] text-muted">{p.label.split(" · ")[1]}</span>
                  </span>
                </button>
              ))}
              <button onClick={() => setPreset("custom")} className={cx("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left", preset === "custom" ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}>
                <span className="flex size-6 flex-none items-center justify-center text-subtle">
                  <Plus className="size-4" />
                </span>
                <span className="text-[12.5px] font-medium">Custom size</span>
              </button>
            </div>
            {preset === "custom" && (
              <div className="mt-3 flex items-center gap-2">
                <Input type="number" min={100} max={8000} value={custom.width} onChange={(e) => setCustom({ ...custom, width: Number(e.target.value) })} className="w-28" aria-label="Width" />
                <X className="size-3.5 text-subtle" />
                <Input type="number" min={100} max={8000} value={custom.height} onChange={(e) => setCustom({ ...custom, height: Number(e.target.value) })} className="w-28" aria-label="Height" />
                <span className="text-[13px] text-muted">px</span>
              </div>
            )}
            {preset !== "custom" && FORMAT_PRESETS[preset]?.print && <p className="mt-3 text-[12.5px] text-muted">Print preset: designed at preview resolution with real trim size and 3 mm bleed metadata. Exports are screen-quality RGB — not verified for CMYK print.</p>}
          </Panel>

          <Panel>
            <h2 className="mb-1 text-[15px] font-semibold">Imagery</h2>
            <p className="mb-4 text-[13px] text-muted">Automatic mode only places photos whose licence clearly allows commercial use and modification, and records the source and attribution.</p>
            <Segmented
              value={assetMode}
              onChange={setAssetMode}
              options={[
                { value: "automatic", label: "Find licensed photos for me" },
                { value: "uploaded", label: "Use my own images" },
              ]}
            />
            {assetMode === "uploaded" && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {ownAssets.map((a) => {
                  const on = selectedAssets.includes(a.id);
                  return (
                    <button key={a.id} onClick={() => setSelectedAssets((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))} className={cx("relative aspect-square overflow-hidden rounded-xl ring-2 transition", on ? "ring-accent" : "ring-transparent hover:ring-line-strong")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                      <img src={`/api/files/${a.fileId}?thumb=240`} alt={a.title} className="h-full w-full object-cover" />
                      {on && (
                        <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-white">
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
                <Dropzone onFile={uploadOwn} accept="image/png,image/jpeg,image/webp" className="aspect-square !rounded-xl !border">
                  <span className="flex flex-col items-center gap-1 text-[11.5px] text-muted">
                    <Upload className="size-4" /> Upload
                  </span>
                </Dropzone>
              </div>
            )}
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink-2">Style references (optional)</span>
                <span className="text-[11.5px] text-subtle">Used for direction only — never copied or placed</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {references.map((r) => (
                  <div key={r.id} className="group relative size-16 overflow-hidden rounded-lg ring-1 ring-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                    <img src={`/api/files/${r.id}?thumb=160`} alt="" className="h-full w-full object-cover" />
                    <button onClick={() => setReferences((x) => x.filter((y) => y.id !== r.id))} aria-label="Remove reference" className="absolute top-1 right-1 hidden size-5 items-center justify-center rounded-full bg-ink/70 text-white group-hover:flex">
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {references.length < 4 && (
                  <Dropzone onFile={uploadReference} accept="image/png,image/jpeg,image/webp" className="size-16 !rounded-lg !border">
                    <ImagePlus className="size-4 text-muted" />
                  </Dropzone>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <Panel className="space-y-4">
            <Field label="Project" hint={project?.brandName ? `Brand: ${project.brandName}` : "No brand attached"}>
              <div className="flex gap-2">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {!projects?.projects.length && <option value="">No projects yet</option>}
                  {projects?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button icon={<Plus className="size-4" />} onClick={() => setNewProject(true)} aria-label="New project" />
              </div>
            </Field>
            <Field label="Creative freedom">
              <Segmented value={freedom} onChange={setFreedom} className="w-full [&>button]:flex-1" options={[{ value: "conservative", label: "Safe" }, { value: "balanced", label: "Balanced" }, { value: "experimental", label: "Bold" }]} />
            </Field>
            <Field label="Concepts" hint="Each is a genuinely different layout idea. More concepts take longer and cost more.">
              <Segmented value={variations} onChange={setVariations} className="w-full [&>button]:flex-1" options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }]} />
            </Field>
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button variant="primary" size="lg" className="w-full" loading={submitting} onClick={submit} icon={<Sparkles className="size-4" />}>
              Generate design
            </Button>
          </Panel>
          <Panel className="bg-surface-2/50">
            <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
              <Wand2 className="size-4 text-accent" /> What happens
            </h3>
            <ol className="space-y-2 text-[12.5px] text-muted">
              {["Creative Director writes the brief and concepts", assetMode === "automatic" ? "Asset Agent searches, compares and downloads a licensed photo" : "Your image is analysed for focal point and calm space", "Design Builder composes editable layers", "QA renders it and measures overflow, contrast, resolution", "Up to 2 automatic correction rounds", "Senior Critic scores the final render"].map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex size-4 flex-none items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-ink-2 ring-1 ring-line">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="mt-3 flex items-center gap-1 text-[11.5px] text-subtle">
              Typically 2–4 minutes per concept <ArrowRight className="size-3" />
            </p>
          </Panel>
        </aside>
      </div>
      <ProjectDialog
        open={newProject}
        onClose={() => setNewProject(false)}
        onSaved={(p) => {
          void reloadProjects();
          setProjectId(p.id);
        }}
      />
    </div>
  );
}
