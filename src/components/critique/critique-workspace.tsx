"use client";

import { ArrowLeft, Check, ChevronDown, Download, FileJson, FileText, Globe, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_META, type Finding } from "@/agents/design-critic/schema";
import { Badge, Button, ConfirmDialog, cx, ErrorNote, ScoreRing, Skeleton, Spinner } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { Brand, Critique, FindingDecision, Job, Project, StoredFile } from "@/types/domain";
import { AnnotatedCanvas, type Marker } from "./annotated-canvas";
import { ImprovePanel } from "./improve-panel";
import { AssistantPanel } from "@/components/chat/assistant-panel";

interface Data {
  critique: Critique;
  designId: string | null;
  file: StoredFile;
  project: Project;
  brand: Brand | null;
}

const SEVERITY = {
  critical: { label: "Critical", tone: "critical" as const },
  major: { label: "Major", tone: "major" as const },
  minor: { label: "Minor", tone: "minor" as const },
  suggestion: { label: "Suggestion", tone: "neutral" as const },
};
const KIND = { objective: "Objective error", contextual: "Contextual", subjective: "Art direction" };

type Tab = "findings" | "scores" | "plan" | "ask";

export function CritiqueWorkspace({ id, initialJobId }: { id: string; initialJobId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { data, error, reload, setData } = useFetch<Data>(`/api/critiques/${id}`);
  const jobId = initialJobId ?? null;
  const job = useJob(jobId, () => void reload());
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  const planJob = useJob(planJobId, (j) => {
    if (j.status === "failed") toast(j.error ?? "Plan failed", "error");
    setPlanJobId(null);
    void reload();
  });
  const [tab, setTab] = useState<Tab>("findings");
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Finding["severity"]>("all");
  const [showStrengths, setShowStrengths] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const critique = data?.critique;
  const running = critique && (critique.status === "queued" || critique.status === "running");

  // Without a job id (page reload), poll the critique itself while it runs.
  useEffect(() => {
    if (!running || jobId) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [running, jobId, reload]);

  const findings = useMemo(() => critique?.result?.findings ?? [], [critique]);
  const numbered = useMemo(() => new Map(findings.map((f, i) => [f.id, i + 1])), [findings]);
  const visible = filter === "all" ? findings : findings.filter((f) => f.severity === filter);

  const markers: Marker[] = useMemo(() => {
    const m: Marker[] = findings.filter((f) => f.region && (filter === "all" || f.severity === filter)).map((f) => ({ id: f.id, label: String(numbered.get(f.id)), region: f.region!, tone: f.severity }));
    if (showStrengths) critique?.result?.strengths.forEach((s, i) => s.region && m.push({ id: `s${i}`, label: "✓", region: s.region, tone: "strength" }));
    return m;
  }, [findings, filter, numbered, showStrengths, critique]);

  const select = (fid: string) => {
    setActive(fid);
    if (fid.startsWith("s")) return;
    setTab("findings");
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-finding="${fid}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const decide = async (fid: string, d: FindingDecision) => {
    if (!critique) return;
    const next = critique.decisions[fid] === d ? "pending" : d;
    setData((prev) => (prev ? { ...prev, critique: { ...prev.critique, decisions: { ...prev.critique.decisions, [fid]: next } } } : prev));
    try {
      await api(`/api/critiques/${id}`, { method: "PATCH", json: { decisions: { [fid]: next } } });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
      void reload();
    }
  };

  const buildPlan = async () => {
    try {
      const { job: j } = await api<{ job: Job }>(`/api/critiques/${id}/plan`, { method: "POST" });
      setPlanJobId(j.id);
      setTab("plan");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const retry = async () => {
    if (!critique) return;
    try {
      const res = await api<{ critique: Critique; job: Job }>("/api/critiques", { method: "POST", json: { projectId: critique.projectId, fileId: critique.fileId, title: critique.title, context: critique.context } });
      router.replace(`/critiques/${res.critique.id}?job=${res.job.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const remove = async () => {
    await api(`/api/critiques/${id}`, { method: "DELETE" });
    toast("Critique deleted");
    router.push(`/projects/${critique?.projectId}`);
  };

  if (error) return <div className="p-8"><ErrorNote>{error}</ErrorNote></div>;
  if (!data || !critique) {
    return (
      <div className="grid h-dvh grid-cols-[1fr_440px]">
        <Skeleton className="m-6 rounded-2xl" />
        <div className="space-y-3 border-l border-line p-6">
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  const r = critique.result;
  const counts = { critical: 0, major: 0, minor: 0, suggestion: 0 };
  findings.forEach((f) => counts[f.severity]++);

  return (
    <div className="flex flex-col lg:h-dvh">
      {/* Top bar */}
      <div className="flex h-14 flex-none items-center gap-3 border-b border-line bg-bg px-4">
        <Link href={`/projects/${data.project.id}`} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to project">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{critique.title}</div>
          <div className="truncate text-[12px] text-muted">
            {data.project.name}
            {data.brand ? ` · ${data.brand.name}` : ""} · {data.file.width}×{data.file.height}px · {critique.model}
          </div>
        </div>
        {r && <ExportMenu id={id} />}
        <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} aria-label="Delete critique" />
      </div>

      <div className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="h-[60vh] border-b border-line lg:h-auto lg:min-h-0 lg:border-r lg:border-b-0">
          <AnnotatedCanvas src={`/api/files/${data.file.id}`} width={data.file.width ?? 1000} height={data.file.height ?? 1000} markers={markers} activeId={hover ?? active} onSelect={select} onHover={setHover} alt={critique.title} />
        </div>

        {/* Right panel */}
        <aside className="flex flex-col bg-surface lg:min-h-0">
          {running && (
            <div className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <div className="text-[15px] font-semibold">Reviewing your design</div>
                  <div className="text-[12.5px] text-muted">Usually 20–90 seconds, depending on the provider.</div>
                </div>
              </div>
              {jobId ? <JobProgress job={job} /> : <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Working…</div>}
              <div className="mt-8 space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
          )}

          {critique.status === "failed" && (
            <div className="space-y-4 p-6">
              <ErrorNote>{critique.error ?? "The critique failed."}</ErrorNote>
              <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={retry}>
                Try again
              </Button>
            </div>
          )}

          {r && critique.status === "succeeded" && (
            <>
              <div className="flex-none border-b border-line p-5">
                <div className="flex gap-4">
                  <ScoreRing score={critique.overallScore} size={92} stroke={8} label="of 100" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {counts.critical > 0 && <Badge tone="critical">{counts.critical} critical</Badge>}
                      {counts.major > 0 && <Badge tone="major">{counts.major} major</Badge>}
                      {counts.minor > 0 && <Badge tone="minor">{counts.minor} minor</Badge>}
                      {counts.suggestion > 0 && <Badge>{counts.suggestion} ideas</Badge>}
                    </div>
                    <p className="line-clamp-4 text-[13px] leading-relaxed text-ink-2">{r.summary}</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-none gap-1 border-b border-line px-3 pt-2">
                {(
                  [
                    ["findings", `Findings · ${findings.length}`],
                    ["scores", "Scores"],
                    ["plan", "Improve"],
                    ["ask", "Ask"],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={cx("relative h-9 px-3 text-[13px] font-medium transition-colors", tab === k ? "text-ink" : "text-muted hover:text-ink")}>
                    {label}
                    {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
                  </button>
                ))}
              </div>

              {tab === "ask" && (
                <div className="h-[60vh] lg:h-auto lg:min-h-0 lg:flex-1">
                  <AssistantPanel projectId={data.project.id} designId={data.designId} />
                </div>
              )}
              <div ref={listRef} className={cx("lg:min-h-0 lg:flex-1 lg:overflow-y-auto", tab === "ask" && "hidden")}>
                {tab === "findings" && (
                  <div className="p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {(["all", "critical", "major", "minor", "suggestion"] as const).map((s) => (
                        <button key={s} onClick={() => setFilter(s)} className={cx("h-7 rounded-lg px-2.5 text-[12px] font-medium transition-colors", filter === s ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink")}>
                          {s === "all" ? "All" : SEVERITY[s].label}
                        </button>
                      ))}
                      <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
                        <input type="checkbox" checked={showStrengths} onChange={(e) => setShowStrengths(e.target.checked)} className="accent-[var(--success)]" /> Show strengths
                      </label>
                    </div>
                    <div className="space-y-2">
                      {visible.map((f) => (
                        <FindingCard key={f.id} f={f} n={numbered.get(f.id)!} decision={critique.decisions[f.id] ?? "pending"} active={active === f.id || hover === f.id} onSelect={() => setActive(active === f.id ? null : f.id)} onHover={setHover} onDecide={(d) => decide(f.id, d)} />
                      ))}
                      {!visible.length && <p className="py-8 text-center text-sm text-muted">No findings at this level.</p>}
                    </div>
                    <h3 className="mt-6 mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Strengths to preserve</h3>
                    <ul className="space-y-2">
                      {r.strengths.map((s, i) => (
                        <li key={i} className="rounded-xl bg-success-soft/60 px-3.5 py-3 text-[13px]" onMouseEnter={() => (setShowStrengths(true), setHover(`s${i}`))} onMouseLeave={() => setHover(null)}>
                          <div className="flex items-center gap-1.5 font-medium text-ink">
                            <Check className="size-3.5 text-success" strokeWidth={3} /> {s.title}
                          </div>
                          <p className="mt-1 text-ink-2">{s.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {tab === "scores" && <ScoresTab critique={critique} />}

                {tab === "plan" && (
                  <ImprovePanel
                    critique={critique}
                    file={data.file}
                    designId={data.designId}
                    onBuildPlan={buildPlan}
                    planJob={planJobId ? <div className="mt-3"><JobProgress job={planJob} title="Building the correction plan" /></div> : null}
                    planView={critique.improvementPlan ? <div className="mt-3"><PlanView critique={critique} onRebuild={buildPlan} /></div> : null}
                  />
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={remove} title="Delete this critique?" description="The report is removed. The uploaded image stays in the project." confirmLabel="Delete critique" />
    </div>
  );
}

function FindingCard({ f, n, decision, active, onSelect, onHover, onDecide }: { f: Finding; n: number; decision: FindingDecision; active: boolean; onSelect: () => void; onHover: (id: string | null) => void; onDecide: (d: FindingDecision) => void }) {
  const sev = SEVERITY[f.severity];
  return (
    <div
      data-finding={f.id}
      onMouseEnter={() => onHover(f.id)}
      onMouseLeave={() => onHover(null)}
      className={cx("rounded-xl border transition-all", active ? "border-accent-line bg-accent-soft/40 shadow-sm" : "border-line bg-surface hover:border-line-strong", decision === "rejected" && "opacity-55")}
    >
      <button onClick={onSelect} className="flex w-full items-start gap-3 px-3.5 pt-3 pb-2 text-left">
        <span className={cx("mt-0.5 flex size-5 flex-none items-center justify-center rounded-full text-[10.5px] font-bold text-white", { critical: "bg-critical", major: "bg-major", minor: "bg-minor", suggestion: "bg-muted" }[f.severity])}>{n}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-snug font-semibold text-ink">{f.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={sev.tone}>{sev.label}</Badge>
            <Badge>{CATEGORY_META[f.category].label}</Badge>
            <span className="text-[11.5px] text-subtle">
              {KIND[f.kind]} · {f.confidence} confidence{!f.region && " · whole design"}
            </span>
          </div>
        </div>
        <ChevronDown className={cx("mt-1 size-4 flex-none text-subtle transition-transform", active && "rotate-180")} />
      </button>
      {active && (
        <div className="animate-in space-y-2.5 px-3.5 pb-1 pl-[46px] text-[13px] leading-relaxed">
          <p className="text-[12px] text-muted">{f.affectedElement}</p>
          <p className="text-ink-2">{f.description}</p>
          <p className="text-muted">
            <span className="font-medium text-ink-2">Why it matters — </span>
            {f.whyItMatters}
          </p>
          <div className="rounded-lg bg-accent-soft/70 px-3 py-2.5 text-ink">
            <span className="font-medium">Fix — </span>
            {f.recommendation}
          </div>
          {f.intentionalPossibility && (
            <p className="text-[12.5px] text-muted italic">
              <span className="font-medium not-italic">If deliberate: </span>
              {f.intentionalPossibility}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-end gap-1 px-2.5 pt-1 pb-2">
        <DecisionButton on={decision === "accepted"} tone="accept" onClick={() => onDecide("accepted")} />
        <DecisionButton on={decision === "rejected"} tone="reject" onClick={() => onDecide("rejected")} />
      </div>
    </div>
  );
}

function DecisionButton({ on, tone, onClick }: { on: boolean; tone: "accept" | "reject"; onClick: () => void }) {
  const Icon = tone === "accept" ? ThumbsUp : ThumbsDown;
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition-colors",
        on ? (tone === "accept" ? "bg-success-soft text-success" : "bg-critical-soft text-critical") : "text-subtle hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className="size-3.5" />
      {tone === "accept" ? (on ? "Accepted" : "Accept") : on ? "Rejected" : "Reject"}
    </button>
  );
}

function ScoresTab({ critique }: { critique: Critique }) {
  const r = critique.result!;
  const t = critique.technical;
  return (
    <div className="space-y-6 p-5">
      <div className="space-y-4">
        {r.categoryScores.map((s) => (
          <div key={s.category}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-medium text-ink">
                {CATEGORY_META[s.category].label} <span className="text-[11.5px] font-normal text-subtle">×{CATEGORY_META[s.category].weight}</span>
              </span>
              <span className="font-semibold tabular-nums">{s.score ?? "n/a"}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${s.score ?? 0}%`, opacity: s.score === null ? 0 : 1 }} />
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{s.rationale}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-surface-2 p-3.5 text-[12.5px] leading-relaxed text-muted">
        <b className="text-ink-2">How the score works.</b> Each category is scored 0–100 against a published rubric; the overall score is their weighted mean (weights shown as ×n). Brand alignment drops out when no brand is attached. Scores are an expert heuristic, not an objective measurement.
      </div>
      <div>
        <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">What the critic assumed</h3>
        <dl className="space-y-2 text-[13px]">
          {(
            [
              ["Purpose", r.inferredContext.purpose],
              ["Audience", r.inferredContext.audience],
              ["Medium", r.inferredContext.medium],
              ["Creative intent", r.inferredContext.creativeIntent],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11.5px] font-medium text-subtle">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {t && (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Measured from the file</h3>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[12.5px]">
            {[
              ["Dimensions", `${t.width} × ${t.height}px`],
              ["Aspect", t.aspectRatio],
              ["Format", t.format.toUpperCase()],
              ["Size", `${(t.sizeBytes / 1024).toFixed(0)} KB`],
              ["Colour space", t.colorSpace ?? "—"],
              ["At 300 dpi", `${t.printSizeAt300.widthMm}×${t.printSizeAt300.heightMm} mm`],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-3 py-2">
                <div className="text-[11px] text-subtle">{k}</div>
                <div className="font-medium text-ink">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {r.productionNotes.length > 0 && (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Production notes</h3>
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-ink-2">
            {r.productionNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {r.observedContent.visibleText.length > 0 && (
        <div>
          <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Text the critic read</h3>
          <div className="flex flex-wrap gap-1.5">
            {r.observedContent.visibleText.map((t, i) => (
              <span key={i} className="rounded-md bg-surface-2 px-2 py-1 text-[12px] text-ink-2">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanView({ critique, onRebuild }: { critique: Critique; onRebuild: () => void }) {
  const p = critique.improvementPlan!;
  const IMPACT = { high: "critical", medium: "major", low: "neutral" } as const;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold">Correction plan</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{p.goal}</p>
      </div>
      <ol className="space-y-2.5">
        {[...p.steps]
          .sort((a, b) => a.order - b.order)
          .map((s) => (
            <li key={s.order} className="rounded-xl border border-line p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex size-6 flex-none items-center justify-center rounded-lg bg-ink text-[12px] font-semibold text-bg">{s.order}</span>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{s.title}</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.action}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge tone={IMPACT[s.impact]}>{s.impact} impact</Badge>
                    <Badge>{s.effort} effort</Badge>
                    {!s.feasibleOnRaster && <Badge tone="minor">needs editable source</Badge>}
                    {s.findingIds.length > 0 && <span className="text-[11.5px] text-subtle">fixes {s.findingIds.join(", ")}</span>}
                  </div>
                </div>
              </div>
            </li>
          ))}
      </ol>
      <div>
        <h4 className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Preserve</h4>
        <ul className="space-y-1 text-[13px] text-ink-2">
          {p.preserve.map((x, i) => (
            <li key={i} className="flex gap-2">
              <Check className="mt-0.5 size-3.5 flex-none text-success" strokeWidth={3} />
              {x}
            </li>
          ))}
        </ul>
      </div>
      {p.notes && <p className="rounded-xl bg-surface-2 p-3.5 text-[12.5px] text-muted">{p.notes}</p>}
      {p.rebuildRecommended && (
        <div className="rounded-xl border border-accent-line bg-accent-soft/50 p-3.5 text-[13px]">
          <b>Rebuild recommended.</b> The Creative Director thinks these fixes are best done on an editable layout. Start one in{" "}
          <Link href="/create" className="font-medium text-accent hover:underline">
            Create
          </Link>
          .
        </div>
      )}
      <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={onRebuild}>
        Rebuild plan from current decisions
      </Button>
    </div>
  );
}

function ExportMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const items = [
    { format: "html", label: "HTML report", hint: "Standalone, printable, with annotations", icon: Globe },
    { format: "md", label: "Markdown", hint: "For docs, tickets, Notion", icon: FileText },
    { format: "json", label: "JSON", hint: "Full structured data", icon: FileJson },
  ];
  return (
    <div ref={ref} className="relative">
      <Button size="sm" icon={<Download className="size-4" />} onClick={() => setOpen((o) => !o)}>
        Export report
      </Button>
      {open && (
        <div className="animate-in absolute top-10 right-0 z-30 w-64 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {items.map((i) => (
            <a key={i.format} href={`/api/critiques/${id}/report?format=${i.format}`} onClick={() => setOpen(false)} className="flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-2">
              <i.icon className="mt-0.5 size-4 text-muted" />
              <span>
                <span className="block text-[13px] font-medium">{i.label}</span>
                <span className="block text-[11.5px] text-muted">{i.hint}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
