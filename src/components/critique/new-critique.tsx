"use client";

import { ArrowRight, ImageIcon, Plus, RefreshCw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorNote, Field, Input, PageHeader, Panel, scoreTone, SectionTitle, Select, Textarea, timeAgo } from "@/components/ui";
import { Dropzone } from "@/components/ui/dropzone";
import { useToast } from "@/components/ui/toast";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { api, uploadFile, useFetch } from "@/hooks/use-api";
import type { Critique, ProjectSummary, StoredFile } from "@/types/domain";

const MEDIA = ["Social media post", "Poster (print)", "Poster (digital)", "Web page / landing section", "Mobile UI", "Display advertisement", "Packaging", "Presentation slide", "Editorial / magazine", "Brand identity", "Signage / banner", "Infographic"];

type CritiqueRow = Critique & { projectName: string; summary: string | null };

export function NewCritique({ initialProjectId }: { initialProjectId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data: projects, reload: reloadProjects } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const { data: past } = useFetch<{ critiques: CritiqueRow[] }>("/api/critiques");
  const { data: status } = useFetch<{ ai: { configured: boolean } }>("/api/status");
  const [chosenProjectId, setChosenProjectId] = useState(initialProjectId ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [form, setForm] = useState({ title: "", purpose: "", audience: "", medium: "", creativeIntent: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);

  // Default to the most recent project until the user picks one.
  const projectId = chosenProjectId || projects?.projects[0]?.id || "";
  const setProjectId = setChosenProjectId;

  // Release the object URL when the preview changes or the page unmounts.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const project = useMemo(() => projects?.projects.find((p) => p.id === projectId), [projects, projectId]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pick = (f: File) => {
    setError(null);
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type)) return setError("Use a PNG, JPG, WebP, GIF or SVG image.");
    if (f.size > 20 * 1024 * 1024) return setError("That file is over 20 MB.");
    setFile(f);
    setDims(null);
    setPreview(URL.createObjectURL(f));
    if (!form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[a-z0-9]+$/i, "") }));
  };

  const submit = async () => {
    if (!file) return setError("Add an image to review.");
    if (!projectId) return setError("Choose or create a project first.");
    setSubmitting(true);
    setError(null);
    try {
      const { file: stored } = await uploadFile<{ file: StoredFile }>(file, { purpose: "critique", projectId });
      const { critique, job } = await api<{ critique: Critique; job: { id: string } }>("/api/critiques", {
        method: "POST",
        json: { projectId, fileId: stored.id, title: form.title, context: { purpose: form.purpose, audience: form.audience, medium: form.medium, creativeIntent: form.creativeIntent, notes: form.notes } },
      });
      router.push(`/critiques/${critique.id}?job=${job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader eyebrow="Critique mode" title="Get a senior design review" description="Upload a poster, ad, social graphic, UI screen or any visual. The critic reads the actual pixels and returns scored, located findings with concrete corrections." />

      {status && !status.ai.configured && (
        <div className="mb-6">
          <ErrorNote>
            No AI provider is connected yet, so critiques will fail. Add a free <code className="font-mono text-[12.5px]">GEMINI_API_KEY</code>, <code className="font-mono text-[12.5px]">GROQ_API_KEY</code> or <code className="font-mono text-[12.5px]">OPENROUTER_API_KEY</code> to <code className="font-mono text-[12.5px]">.env.local</code>, restart the dev server, and choose it in Settings.
          </ErrorNote>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel padded={false} className="overflow-hidden">
          {preview ? (
            <div className="canvas-grid relative flex min-h-[420px] items-center justify-center p-8">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
              <img src={preview} alt="Selected design" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="max-h-[560px] max-w-full rounded-md object-contain shadow-lg" />
              <div className="absolute right-4 bottom-4 left-4 flex items-center justify-between gap-3 rounded-xl bg-surface/95 px-3 py-2 shadow-md ring-1 ring-line backdrop-blur">
                <div className="min-w-0 text-[12.5px]">
                  <div className="truncate font-medium text-ink">{file?.name}</div>
                  <div className="text-muted">
                    {dims ? `${dims.w} × ${dims.h}px · ` : ""}
                    {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ""}
                  </div>
                </div>
                <Dropzone onFile={pick} accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="!rounded-lg !border !border-solid !border-line px-3 py-1.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                    <RefreshCw className="size-3.5" /> Replace
                  </span>
                </Dropzone>
              </div>
            </div>
          ) : (
            <Dropzone onFile={pick} accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="m-4 min-h-[420px] !rounded-xl">
              <div className="px-6">
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <ImageIcon className="size-6" />
                </div>
                <div className="text-[15px] font-semibold text-ink">Drop your design here</div>
                <div className="mt-1 text-sm text-muted">PNG, JPG, WebP, GIF or SVG · up to 20 MB</div>
                <div className="mt-5 inline-flex h-9 items-center rounded-[10px] border border-line bg-surface px-3.5 text-sm font-medium shadow-sm">Browse files</div>
              </div>
            </Dropzone>
          )}
        </Panel>

        <Panel className="space-y-4">
          <Field label="Project" hint={project?.brandName ? `Brand rules from “${project.brandName}” will be applied.` : "No brand attached — brand alignment won’t be scored."}>
            <div className="flex gap-2">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {!projects?.projects.length && <option value="">No projects yet</option>}
                {projects?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button icon={<Plus className="size-4" />} onClick={() => setNewProject(true)} aria-label="New project" title="New project" />
            </div>
          </Field>
          <Field label="Title">
            <Input value={form.title} onChange={set("title")} placeholder="e.g. Summer poster v2" maxLength={160} />
          </Field>
          <div className="rounded-xl bg-surface-2/70 p-4">
            <p className="mb-3 text-[12.5px] text-muted">Context makes the critique fair. Leave blank and the critic will infer it — and tell you what it assumed.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Purpose">
                <Input value={form.purpose} onChange={set("purpose")} placeholder="Drive ticket sales for…" maxLength={500} />
              </Field>
              <Field label="Audience">
                <Input value={form.audience} onChange={set("audience")} placeholder="Urban runners, 25–40" maxLength={500} />
              </Field>
              <Field label="Medium" className="sm:col-span-2">
                <Input list="media" value={form.medium} onChange={set("medium")} placeholder="Instagram post, A2 poster, landing page hero…" maxLength={300} />
                <datalist id="media">
                  {MEDIA.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label="Creative intent" className="sm:col-span-2" hint="Tell the critic what’s deliberate (e.g. “intentionally broken grid”).">
                <Textarea rows={2} value={form.creativeIntent} onChange={set("creativeIntent")} maxLength={1000} />
              </Field>
            </div>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button variant="primary" size="lg" className="w-full" loading={submitting} onClick={submit} icon={<ScanSearch className="size-4" />}>
            {submitting ? "Uploading…" : "Run critique"}
          </Button>
        </Panel>
      </div>

      {past?.critiques.length ? (
        <section className="mt-12">
          <SectionTitle>Previous critiques</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.critiques.slice(0, 9).map((c) => (
              <Link key={c.id} href={`/critiques/${c.id}`} className="group flex gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm transition hover:border-line-strong hover:shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                <img src={`/api/files/${c.fileId}?thumb=160`} alt="" className="size-16 flex-none rounded-lg bg-surface-2 object-cover ring-1 ring-line" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-[13.5px] font-medium">{c.title}</div>
                    {c.status === "succeeded" && <Badge tone={scoreTone(c.overallScore)}>{c.overallScore}</Badge>}
                  </div>
                  <div className="truncate text-[12px] text-muted">
                    {c.projectName} · {timeAgo(c.createdAt)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] text-subtle">{c.summary ?? (c.status === "failed" ? "Failed — open to retry" : "In progress")}</div>
                </div>
                <ArrowRight className="mt-1 size-4 flex-none text-subtle opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <ProjectDialog
        open={newProject}
        onClose={() => setNewProject(false)}
        onSaved={(p) => {
          void reloadProjects();
          setProjectId(p.id);
          toast(`Using “${p.name}”`, "info");
        }}
      />
    </div>
  );
}
