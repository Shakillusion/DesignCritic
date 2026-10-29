"use client";

import { ArrowRight, Info, Layers, ListChecks, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge, Button, cx, ErrorNote, scoreTone } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useJob } from "@/hooks/use-api";
import type { Critique, Job, StoredFile } from "@/types/domain";
import { QuickAdjustDialog } from "./quick-adjust-dialog";

interface FixResult {
  designId: string;
  versionId: string;
  versionNumber: number;
  madeCurrent: boolean;
  applied: number;
  rejected: string[];
  notFixable: { findingId: string; why: string }[];
  qaErrorsBefore: number;
  qaErrorsAfter: number;
  scoreBefore: number | null;
  scoreAfter: number | null;
  regressed: boolean;
}

/** Improve tab: apply fixes (editable designs), rebuild or quick-adjust (uploads), and the correction plan. */
export function ImprovePanel({ critique, file, designId, planView, onBuildPlan, planJob }: { critique: Critique; file: StoredFile; designId: string | null; planView: ReactNode; onBuildPlan: () => void; planJob: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [kind, setKind] = useState<"apply" | "rebuild" | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const job = useJob(jobId, (j) => {
    if (j.status === "failed") toast(j.error ?? "That didn't work", "error");
    else if (kind === "rebuild") {
      toast("Editable design ready");
      router.push(`/designs/${(j.result as { designId: string }).designId}`);
    }
  });
  const editable = Boolean(critique.designVersionId);
  const accepted = Object.values(critique.decisions).filter((d) => d === "accepted").length;
  const result = kind === "apply" && job?.status === "succeeded" ? (job.result as unknown as FixResult) : null;

  const start = async (k: "apply" | "rebuild") => {
    try {
      const { job: j } = await api<{ job: Job }>(`/api/critiques/${critique.id}/${k}`, { method: "POST" });
      setKind(k);
      setJobId(j.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="space-y-6 p-5">
      {editable ? (
        <section>
          <Heading icon={<Wand2 className="size-5" />} title="Apply fixes to the design" />
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            The Design Fixer turns {accepted ? `your ${accepted} accepted finding${accepted === 1 ? "" : "s"}` : "every finding you haven’t rejected"} into precise layer edits, renders and checks them, then the critic scores the result. It’s saved as a new version; this one stays untouched.
          </p>
          {!jobId || job?.status === "failed" ? (
            <Button variant="primary" className="mt-4" icon={<Sparkles className="size-4" />} onClick={() => start("apply")}>
              Apply {accepted ? "accepted" : ""} fixes
            </Button>
          ) : null}
          {jobId && <div className="mt-4 rounded-xl border border-line p-4"><JobProgress job={job} /></div>}
          {job?.status === "failed" && <div className="mt-3"><ErrorNote>{job.error}</ErrorNote></div>}
          {result && <FixResultCard r={result} />}
        </section>
      ) : (
        <section>
          <Heading icon={<Layers className="size-5" />} title="Make it editable" />
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            This is a flattened image, so its text and shapes can’t be changed directly. Rebuild it as an editable design: the AI reads the layout, text, colours and image regions; image areas are cut from your original file. Fonts are matched to the closest available ones and effects are simplified — you’ll compare it with the original before applying fixes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon={<Layers className="size-4" />} loading={Boolean(running && kind === "rebuild")} onClick={() => start("rebuild")}>
              Rebuild as editable design
            </Button>
            <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjustOpen(true)}>
              Quick adjust
            </Button>
          </div>
          {jobId && kind === "rebuild" && <div className="mt-4 rounded-xl border border-line p-4"><JobProgress job={job} /></div>}
          {job?.status === "failed" && <div className="mt-3"><ErrorNote>{job.error}</ErrorNote></div>}
          <p className="mt-3 flex gap-2 text-[12px] text-subtle">
            <Info className="mt-px size-3.5 flex-none" /> Quick adjust handles crop, brightness, contrast and resizing as a new image; your original is never changed.
          </p>
        </section>
      )}

      <section className="border-t border-line pt-5">
        <Heading icon={<ListChecks className="size-5" />} title="Correction plan" />
        {planJob ?? (planView ?? (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">A ranked, written plan of what to fix and what to preserve — useful for briefing a designer or working by hand.</p>
            <Button className="mt-3" icon={<ListChecks className="size-4" />} onClick={onBuildPlan}>
              Build improvement plan
            </Button>
          </>
        ))}
      </section>

      {designId && editable && (
        <Link href={`/designs/${designId}`} className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
          Open this design in the studio <ArrowRight className="size-3.5" />
        </Link>
      )}

      <QuickAdjustDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} file={file} projectId={critique.projectId} />
    </div>
  );
}

function Heading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <h3 className="text-[15px] font-semibold">{title}</h3>
    </div>
  );
}

function FixResultCard({ r }: { r: FixResult }) {
  return (
    <div className={cx("animate-in mt-4 rounded-xl border p-4", r.regressed ? "border-major/40 bg-major-soft/40" : "border-accent-line bg-accent-soft/40")}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[14px] font-semibold">Version {r.versionNumber} is ready</div>
        <div className="flex items-center gap-1.5 text-[13px]">
          <Badge tone={scoreTone(r.scoreBefore)}>{r.scoreBefore ?? "–"}</Badge>
          <ArrowRight className="size-3.5 text-subtle" />
          <Badge tone={scoreTone(r.scoreAfter)}>{r.scoreAfter ?? "–"}</Badge>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">
        <li>{r.applied} change{r.applied === 1 ? "" : "s"} applied{r.rejected.length ? ` · ${r.rejected.length} skipped for safety` : ""}</li>
        <li>QA errors {r.qaErrorsBefore} → {r.qaErrorsAfter}</li>
        {r.regressed && <li className="font-medium text-major">The critic scored this version lower. We recommend keeping the current version; compare them before deciding.</li>}
        {r.notFixable.map((n) => (
          <li key={n.findingId} className="text-muted">
            {n.findingId}: {n.why}
          </li>
        ))}
        <li className="text-muted">{r.madeCurrent ? "It is now the current version." : "Waiting for your review — the previous version is still current."}</li>
      </ul>
      <Link href={`/designs/${r.designId}?version=${r.versionId}&compare=1`} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover">
        Review changes <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
