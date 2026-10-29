"use client";

import { ArrowRight, Eye, ImageIcon, Layers, ScanSearch, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ButtonLink, EmptyState, ErrorNote, PageHeader, Panel, scoreTone, SectionTitle, Skeleton, timeAgo } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { Job } from "@/types/domain";

interface DesignRow {
  id: string;
  name: string;
  projectName: string;
  renderFileId: string | null;
  currentNumber: number | null;
  awaitingReview: { id: string; number: number; summary: string }[];
  rebuilt: boolean;
  updatedAt: string;
  critique: { id: string; status: string; score: number | null; findings: number; accepted: number } | null;
}
interface UploadRow {
  critiqueId: string;
  fileId: string;
  title: string;
  projectName: string;
  score: number | null;
  findings: number;
  createdAt: string;
}

const STEPS = [
  { icon: ScanSearch, title: "Critique", text: "Scored, located findings with concrete fixes." },
  { icon: Eye, title: "Decide", text: "Accept what you agree with, reject the rest." },
  { icon: Wand2, title: "Apply or rebuild", text: "Targeted layer edits — each one rendered and measured; edits that make things worse are dropped." },
  { icon: Sparkles, title: "Compare & approve", text: "Before/after, change list and new score. Nothing replaces your version until you accept it." },
];

export function ImproveHub() {
  const { data, error, loading, reload } = useFetch<{ designs: DesignRow[]; uploads: UploadRow[] }>("/api/improve");

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Improve mode"
        title="Fix what’s weak, keep what works"
        description="Improvements are always new versions. The agents change only what a finding or your request asks for, check every edit, and leave the original untouched."
        actions={<ButtonLink href="/critique" variant="primary" icon={<ScanSearch className="size-4" />}>Critique something new</ButtonLink>}
      />

      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-[11px] font-bold text-accent">{i + 1}</span>
              <s.icon className="size-4 text-muted" />
            </div>
            <div className="mt-2 text-[14px] font-semibold">{s.title}</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.text}</p>
          </div>
        ))}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        data && (
          <div className="space-y-12">
            <section>
              <SectionTitle>Editable designs</SectionTitle>
              {data.designs.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.designs.map((d) => (
                    <DesignCard key={d.id} d={d} onChanged={reload} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Layers className="size-5" />} title="No editable designs yet" description="Create one from a brief, or rebuild an uploaded image below." action={<ButtonLink href="/create">Create a design</ButtonLink>} />
              )}
            </section>
            <section>
              <SectionTitle>Uploaded images</SectionTitle>
              {data.uploads.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.uploads.map((u) => (
                    <UploadCard key={u.critiqueId} u={u} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<ImageIcon className="size-5" />} title="No critiqued uploads" description="Critique an uploaded design; you can then rebuild it as an editable layout or quick-adjust it." />
              )}
            </section>
          </div>
        )
      )}
    </div>
  );
}

function Thumb({ fileId }: { fileId: string | null }) {
  return (
    <div className="canvas-grid flex size-28 flex-none items-center justify-center overflow-hidden rounded-xl p-2">
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private files
        <img src={`/api/files/${fileId}?thumb=240`} alt="" className="max-h-full max-w-full rounded object-contain shadow-sm" />
      ) : (
        <Layers className="size-5 text-subtle" />
      )}
    </div>
  );
}

function DesignCard({ d, onChanged }: { d: DesignRow; onChanged: () => void }) {
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, (j) => {
    if (j.status === "failed") toast(j.error ?? "Couldn’t apply fixes", "error");
    else toast("New version ready for review");
    onChanged();
  });
  const run = async (path: string) => {
    try {
      const { job: j } = await api<{ job: Job }>(path, { method: "POST", json: path.includes("/versions/") ? { action: "critique" } : undefined });
      setJobId(j.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const running = job && (job.status === "queued" || job.status === "running");
  const c = d.critique;

  return (
    <Panel className="flex gap-4">
      <Thumb fileId={d.renderFileId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/designs/${d.id}`} className="block truncate text-[14.5px] font-semibold hover:text-accent">
              {d.name}
            </Link>
            <div className="truncate text-[12px] text-muted">
              {d.projectName} · v{d.currentNumber} · {timeAgo(d.updatedAt)}
              {d.rebuilt && " · rebuilt from upload"}
            </div>
          </div>
          {c?.score != null && <Badge tone={scoreTone(c.score)}>{c.score}</Badge>}
        </div>
        {d.awaitingReview.length > 0 && (
          <Link href={`/designs/${d.id}?version=${d.awaitingReview[0].id}&compare=1`} className="mt-2 flex items-center gap-1.5 rounded-lg bg-major-soft/60 px-2.5 py-1.5 text-[12px] font-medium text-ink hover:bg-major-soft">
            v{d.awaitingReview[0].number} is waiting for your review <ArrowRight className="size-3" />
          </Link>
        )}
        <div className="mt-3">
          {running ? (
            <JobProgress job={job} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {c?.status === "succeeded" ? (
                <>
                  <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => run(`/api/critiques/${c.id}/apply`)}>
                    Apply {c.accepted ? `${c.accepted} accepted` : "all"} fixes
                  </Button>
                  <ButtonLink size="sm" href={`/critiques/${c.id}`}>
                    Review findings ({c.findings})
                  </ButtonLink>
                </>
              ) : (
                <Button size="sm" icon={<ScanSearch className="size-3.5" />} onClick={() => run(`/api/designs/${d.id}/versions/current`)}>
                  Critique current version
                </Button>
              )}
              <ButtonLink size="sm" variant="ghost" href={`/designs/${d.id}`}>
                Open studio
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function UploadCard({ u }: { u: UploadRow }) {
  const router = useRouter();
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, (j) => {
    if (j.status === "failed") toast(j.error ?? "Rebuild failed", "error");
    else router.push(`/designs/${(j.result as { designId: string }).designId}`);
  });
  const rebuild = async () => {
    try {
      const { job: j } = await api<{ job: Job }>(`/api/critiques/${u.critiqueId}/rebuild`, { method: "POST" });
      setJobId(j.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const running = job && (job.status === "queued" || job.status === "running");
  return (
    <Panel className="flex gap-4">
      <Thumb fileId={u.fileId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/critiques/${u.critiqueId}`} className="block truncate text-[14.5px] font-semibold hover:text-accent">
              {u.title}
            </Link>
            <div className="truncate text-[12px] text-muted">
              {u.projectName} · {u.findings} findings · {timeAgo(u.createdAt)}
            </div>
          </div>
          {u.score != null && <Badge tone={scoreTone(u.score)}>{u.score}</Badge>}
        </div>
        <div className="mt-3">
          {running ? (
            <JobProgress job={job} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<Layers className="size-3.5" />} onClick={rebuild}>
                Rebuild as editable
              </Button>
              <ButtonLink size="sm" href={`/critiques/${u.critiqueId}`}>
                Findings & quick adjust
              </ButtonLink>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
