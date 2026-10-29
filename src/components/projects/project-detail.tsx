"use client";

import { ArrowLeft, Images, Layers, Palette, Pencil, PenTool, ScanSearch, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ButtonLink, ConfirmDialog, cx, EmptyState, ErrorNote, scoreTone, Skeleton, timeAgo } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, useFetch } from "@/hooks/use-api";
import type { Asset, Brand, Critique, Design, Project, StoredFile } from "@/types/domain";
import { ProjectDialog } from "./project-dialog";

interface Data {
  project: Project;
  brand: Brand | null;
  critiques: (Omit<Critique, "result"> & { findingCount: number })[];
  designs: (Design & { renderFileId: string | null; versionCount: number })[];
  assets: Asset[];
  uploads: StoredFile[];
}

export function ProjectDetail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload } = useFetch<Data>(`/api/projects/${id}`);
  const [tab, setTab] = useState<"designs" | "critiques" | "assets">("critiques");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Skeleton className="h-64 rounded-2xl" />;
  const { project, brand } = data;

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      toast(`Deleted “${project.name}”`);
      router.push("/projects");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      setBusy(false);
    }
  };

  const tabs = [
    { key: "critiques" as const, label: "Critiques", count: data.critiques.length },
    { key: "designs" as const, label: "Designs", count: data.designs.length },
    { key: "assets" as const, label: "Assets", count: data.assets.length },
  ];

  return (
    <div className="animate-in">
      <Link href="/projects" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Projects
      </Link>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <h1 className="font-display text-[32px] leading-tight font-semibold">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            {brand ? (
              <Link href={`/brands/${brand.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 font-medium text-ink ring-1 ring-line hover:ring-line-strong">
                <span className="flex -space-x-1">
                  {brand.colors.slice(0, 4).map((c) => (
                    <span key={c.hex + c.name} className="size-3 rounded-full ring-2 ring-surface" style={{ background: c.hex }} />
                  ))}
                </span>
                {brand.name}
              </Link>
            ) : (
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ring-line ring-dashed hover:text-ink">
                <Palette className="size-3.5" /> Attach a brand
              </button>
            )}
            <span>Updated {timeAgo(project.updatedAt)}</span>
          </div>
          {project.description && <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{project.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} aria-label="Delete project" />
          <ButtonLink href={`/create?projectId=${id}`} icon={<PenTool className="size-4" />}>
            Create design
          </ButtonLink>
          <ButtonLink href={`/critique?projectId=${id}`} variant="primary" icon={<ScanSearch className="size-4" />}>
            Critique a design
          </ButtonLink>
        </div>
      </header>

      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("relative flex h-10 items-center gap-2 px-3 text-sm font-medium", tab === t.key ? "text-ink" : "text-muted hover:text-ink")}>
            {t.label}
            <span className="rounded-md bg-surface-2 px-1.5 text-[11.5px] text-muted tabular-nums">{t.count}</span>
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === "critiques" &&
        (data.critiques.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.critiques.map((c) => (
              <Link key={c.id} href={`/critiques/${c.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="canvas-grid relative flex aspect-square items-center justify-center p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                  <img src={`/api/files/${c.fileId}?thumb=480`} alt="" className="max-h-full max-w-full rounded object-contain shadow-md" />
                  <span className="absolute top-3 right-3">
                    {c.status === "succeeded" ? <Badge tone={scoreTone(c.overallScore)} className="text-[13px]">{c.overallScore}</Badge> : <Badge tone={c.status === "failed" ? "critical" : "neutral"}>{c.status === "failed" ? "Failed" : "Running"}</Badge>}
                  </span>
                </div>
                <div className="border-t border-line p-3.5">
                  <div className="truncate text-[13.5px] font-medium">{c.title}</div>
                  <div className="text-[12px] text-muted">
                    {c.findingCount} findings · {timeAgo(c.createdAt)}
                    {c.designVersionId && " · generated design"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<ScanSearch className="size-5" />} title="No critiques yet" description="Upload a design to get a scored, annotated review." action={<ButtonLink href={`/critique?projectId=${id}`} variant="primary">Critique a design</ButtonLink>} />
        ))}

      {tab === "designs" &&
        (data.designs.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.designs.map((d) => (
              <Link key={d.id} href={`/designs/${d.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="canvas-grid flex aspect-square items-center justify-center p-5">
                  {d.renderFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private files
                    <img src={`/api/files/${d.renderFileId}?thumb=480`} alt="" className="max-h-full max-w-full rounded object-contain shadow-md" />
                  ) : (
                    <Layers className="size-6 text-subtle" />
                  )}
                </div>
                <div className="border-t border-line p-3.5">
                  <div className="truncate text-[13.5px] font-medium">{d.name}</div>
                  <div className="text-[12px] text-muted">
                    {d.versionCount} version{d.versionCount === 1 ? "" : "s"} · {timeAgo(d.updatedAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<PenTool className="size-5" />} title="No designs yet" description="Describe what you need and the agents build editable layouts with licensed imagery." action={<ButtonLink href={`/create?projectId=${id}`} variant="primary">Create a design</ButtonLink>} />
        ))}

      {tab === "assets" &&
        (data.assets.length ? (
          <div>
            <div className="mb-4 flex justify-end">
              <ButtonLink href={`/assets?projectId=${id}`} size="sm" icon={<Images className="size-4" />}>
                Open in Asset Library
              </ButtonLink>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {data.assets.map((a) => (
                <div key={a.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                  <img src={`/api/files/${a.fileId}?thumb=320`} alt={a.title} className="aspect-[4/3] w-full bg-surface-2 object-cover" />
                  <div className="p-2.5">
                    <div className="truncate text-[12.5px] font-medium">{a.title || "Untitled"}</div>
                    <div className="truncate text-[11.5px] text-muted">{a.provider ?? "Uploaded"} · {a.license.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState icon={<Images className="size-5" />} title="No assets yet" description="Assets appear here when the agents download licensed imagery for a design, or when you upload your own." action={<ButtonLink href={`/assets?projectId=${id}`}>Open Asset Library</ButtonLink>} />
        ))}

      <ProjectDialog open={editing} project={project} onClose={() => setEditing(false)} onSaved={() => void reload()} />
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={remove} loading={busy} title="Delete this project?" description={<>This permanently deletes <b className="text-ink">{project.name}</b> and everything in it.</>} confirmText={project.name} confirmLabel="Delete project" />
    </div>
  );
}
