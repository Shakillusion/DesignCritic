"use client";

import { Bookmark, BookmarkCheck, ExternalLink, Globe, ImageIcon, LayoutGrid, Link2, Newspaper, Plus, Search, Telescope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TrendBrief } from "@/agents/research/schema";
import { Badge, Button, cx, EmptyState, Field, Input, PageHeader, Panel, SectionTitle, Select, Skeleton, timeAgo } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { ResearchItem, SourceError } from "@/lib/integrations/research/types";
import type { Job, ProjectSummary } from "@/types/domain";

interface Run {
  id: string;
  query: { topic: string; industry: string; direction: string };
  items: ResearchItem[];
  brief: TrendBrief | null;
  sourceErrors: SourceError[];
  createdAt: string;
}
interface RunSummary {
  id: string;
  query: Run["query"];
  itemCount: number;
  insightCount: number;
  createdAt: string;
}
interface Reference {
  id: string;
  kind: ResearchItem["kind"];
  source: string;
  title: string;
  url: string;
  publishedAt: string | null;
  fileId: string | null;
  palette: string[];
  rights: string | null;
}
interface Board {
  id: string;
  name: string;
  items: { ref: Reference }[];
  updatedAt: string;
}

const CATEGORY = {
  emerging: { label: "Emerging", tone: "accent" as const },
  established: { label: "Established", tone: "success" as const },
  cliche: { label: "Overused cliché", tone: "major" as const },
};

export function ResearchView({ initialProjectId }: { initialProjectId?: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data: projects } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const [chosenProject, setProjectId] = useState(initialProjectId ?? "");
  const projectId = chosenProject || projects?.projects[0]?.id || "";
  const runsQ = useFetch<{ runs: RunSummary[] }>(projectId ? `/api/research?projectId=${projectId}` : null);
  const refsQ = useFetch<{ references: Reference[] }>(projectId ? `/api/references?projectId=${projectId}` : null);
  const boardsQ = useFetch<{ moodboards: Board[] }>(projectId ? `/api/moodboards?projectId=${projectId}` : null);
  const [form, setForm] = useState({ topic: "", industry: "", direction: "" });
  const [runId, setRunId] = useState<string | null>(null);
  const activeRunId = runId ?? runsQ.data?.runs[0]?.id ?? null;
  const runQ = useFetch<{ run: Run }>(activeRunId ? `/api/research/${activeRunId}` : null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, (j) => {
    setJobId(null);
    if (j.status === "failed") return toast(j.error ?? "Research failed", "error");
    setRunId((j.result as { runId: string }).runId);
    void runsQ.reload();
  });
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const savedUrls = new Set(refsQ.data?.references.map((r) => r.url) ?? []);
  const run = runQ.data?.run;

  const start = async () => {
    if (form.topic.trim().length < 2) return toast("Describe what to research", "error");
    try {
      const { job: j } = await api<{ job: Job }>("/api/research", { method: "POST", json: { projectId, ...form } });
      setJobId(j.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const save = async (body: { runId?: string; itemId?: string; url?: string }, key: string) => {
    setSaving(key);
    try {
      await api("/api/references", { method: "POST", json: { projectId, ...body } });
      toast("Saved to references");
      await refsQ.reload();
      if (body.url) setLink("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(null);
    }
  };

  const createBoard = async () => {
    try {
      const { moodboard } = await api<{ moodboard: Board }>("/api/moodboards", { method: "POST", json: { projectId, name: `Moodboard ${(boardsQ.data?.moodboards.length ?? 0) + 1}`, refIds: [...selected] } });
      router.push(`/research/boards/${moodboard.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const byId = new Map(run?.items.map((i) => [i.id, i]) ?? []);

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Research mode"
        title="Research the direction before you design"
        description="Real, current sources only: design publications’ feeds, open museum and Commons collections, links you paste, and optional web search. Every insight cites what it’s based on; references guide direction and are never placed in your artwork."
      />

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <Panel className="space-y-4">
            <Field label="Project">
              <Select value={projectId} onChange={(e) => (setProjectId(e.target.value), setRunId(null))}>
                {projects?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Topic">
              <Input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. tourism poster" maxLength={200} />
            </Field>
            <Field label="Industry">
              <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="e.g. travel & hospitality" maxLength={120} />
            </Field>
            <Field label="Direction you’re exploring">
              <Input value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} placeholder="e.g. calm, editorial, premium" maxLength={300} />
            </Field>
            {jobId ? <JobProgress job={job} /> : (
              <Button variant="primary" className="w-full" icon={<Search className="size-4" />} onClick={start} disabled={!projectId}>
                Research
              </Button>
            )}
          </Panel>

          <Panel>
            <SectionTitle>Add a reference by link</SectionTitle>
            <p className="mb-2 text-[12px] text-muted">Behance, Dribbble, Pinterest, Awwwards, a studio’s case study… Only that page’s title and preview image are read.</p>
            <form onSubmit={(e) => (e.preventDefault(), link && void save({ url: link }, "link"))} className="flex gap-2">
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" type="url" />
              <Button type="submit" loading={saving === "link"} icon={<Link2 className="size-4" />} aria-label="Save link" />
            </form>
          </Panel>

          {runsQ.data?.runs.length ? (
            <Panel padded={false}>
              <div className="px-4 pt-4"><SectionTitle>Past research</SectionTitle></div>
              <ul className="pb-2">
                {runsQ.data.runs.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setRunId(r.id)} className={cx("w-full px-4 py-2 text-left hover:bg-surface-2", r.id === activeRunId && "bg-accent-soft/40")}>
                      <div className="truncate text-[13px] font-medium">{r.query.topic}</div>
                      <div className="text-[11.5px] text-muted">
                        {r.insightCount} insights · {r.itemCount} sources · {timeAgo(r.createdAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-8">
          {!run && !runQ.loading && !jobId && (
            <EmptyState icon={<Telescope className="size-5" />} title="No research yet" description="Describe a topic to gather current coverage and visual precedents, then save the useful ones to a moodboard." />
          )}
          {runQ.loading && !run && <Skeleton className="h-64 rounded-2xl" />}

          {run?.brief && (
            <Panel>
              <div className="mb-1 text-[12px] font-medium text-muted">
                {run.query.topic}
                {run.query.industry && ` · ${run.query.industry}`}
                {run.query.direction && ` · ${run.query.direction}`} · {timeAgo(run.createdAt)}
              </div>
              <p className="text-[15px] leading-relaxed text-ink">{run.brief.summary}</p>
              <div className="mt-5 space-y-4">
                {run.brief.insights.map((ins, i) => (
                  <div key={i} className="rounded-xl border border-line p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={CATEGORY[ins.category].tone}>{CATEGORY[ins.category].label}</Badge>
                      <h3 className="text-[14.5px] font-semibold">{ins.title}</h3>
                    </div>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{ins.explanation}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {ins.citations.map((c) => {
                        const it = byId.get(c);
                        return it ? (
                          <a key={c} href={it.url} target="_blank" rel="noreferrer noopener" title={it.title} className="inline-flex max-w-[260px] items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[11.5px] text-ink-2 hover:bg-surface-3">
                            <span className="font-semibold text-accent">{c}</span>
                            <span className="truncate">{it.source}{it.publishedAt ? ` · ${it.publishedAt.slice(0, 10)}` : ""}</span>
                            <ExternalLink className="size-3 flex-none text-subtle" />
                          </a>
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
                {!!run.brief.uncited?.length && (
                  <div className="rounded-xl border border-dashed border-line-strong p-4">
                    <div className="text-[12px] font-semibold text-muted uppercase">General knowledge — not backed by the sources above</div>
                    {run.brief.uncited.map((u, i) => (
                      <p key={i} className="mt-1.5 text-[13px] text-ink-2">
                        <b>{u.title}.</b> {u.explanation}
                      </p>
                    ))}
                  </div>
                )}
                <p className="rounded-xl bg-surface-2 px-4 py-3 text-[12.5px] text-muted">
                  <b className="text-ink-2">Limits of this research:</b> {run.brief.gaps}
                  {run.sourceErrors.length > 0 && ` Unavailable this time: ${run.sourceErrors.map((e) => e.source).join(", ")}.`}
                </p>
              </div>
            </Panel>
          )}

          {run && (
            <Evidence run={run} recommended={new Set(run.brief?.recommended.map((r) => r.itemId))} savedUrls={savedUrls} saving={saving} onSave={(itemId) => save({ runId: run.id, itemId }, itemId)} />
          )}

          <section>
            <SectionTitle
              action={
                <div className="flex items-center gap-2">
                  {selected.size > 0 && <span className="text-[12px] text-muted">{selected.size} selected</span>}
                  <Button size="sm" variant="primary" icon={<LayoutGrid className="size-3.5" />} onClick={createBoard} disabled={!projectId}>
                    {selected.size ? "Moodboard from selected" : "New moodboard"}
                  </Button>
                </div>
              }
            >
              Saved references
            </SectionTitle>
            {refsQ.data?.references.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {refsQ.data.references.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <button key={r.id} onClick={() => setSelected((s) => { const n = new Set(s); if (on) n.delete(r.id); else n.add(r.id); return n; })} className={cx("overflow-hidden rounded-xl border bg-surface text-left transition", on ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong")}>
                      <div className="canvas-grid aspect-[4/3]">
                        {r.fileId ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local preview
                          <img src={`/api/files/${r.fileId}`} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-subtle"><Newspaper className="size-5" /></div>
                        )}
                      </div>
                      <div className="p-2">
                        <div className="line-clamp-2 text-[12px] font-medium leading-snug">{r.title}</div>
                        <div className="truncate text-[11px] text-muted">{r.source}</div>
                        {r.palette.length > 0 && (
                          <div className="mt-1.5 flex gap-0.5">
                            {r.palette.slice(0, 5).map((c) => <span key={c} className="h-2 flex-1 rounded-sm" style={{ background: c }} />)}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-subtle">Save items from research or paste links to collect references.</p>
            )}
          </section>

          {boardsQ.data?.moodboards.length ? (
            <section>
              <SectionTitle>Moodboards</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {boardsQ.data.moodboards.map((b) => (
                  <Link key={b.id} href={`/research/boards/${b.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="grid h-28 grid-cols-3 gap-0.5 bg-surface-2">
                      {b.items.slice(0, 3).map((it) => (it.ref.fileId ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview
                        <img key={it.ref.id} src={`/api/files/${it.ref.fileId}?thumb=240`} alt="" className="h-full w-full object-cover" />
                      ) : <div key={it.ref.id} className="bg-surface-3" />))}
                    </div>
                    <div className="p-3">
                      <div className="text-[13.5px] font-semibold">{b.name}</div>
                      <div className="text-[12px] text-muted">{b.items.length} references · {timeAgo(b.updatedAt)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Evidence({ run, recommended, savedUrls, saving, onSave }: { run: Run; recommended: Set<string>; savedUrls: Set<string>; saving: string | null; onSave: (itemId: string) => void }) {
  const [tab, setTab] = useState<"visual" | "article" | "web">("visual");
  const groups = { visual: run.items.filter((i) => i.kind === "visual"), article: run.items.filter((i) => i.kind === "article"), web: run.items.filter((i) => i.kind === "web") };
  const tabs = [
    { key: "visual" as const, label: "Visual references", icon: ImageIcon },
    { key: "article" as const, label: "Design coverage", icon: Newspaper },
    ...(groups.web.length ? [{ key: "web" as const, label: "Web", icon: Globe }] : []),
  ];
  const SaveBtn = ({ i }: { i: ResearchItem }) =>
    savedUrls.has(i.url) ? (
      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success"><BookmarkCheck className="size-3.5" /> Saved</span>
    ) : (
      <Button size="sm" variant="ghost" className="!h-7 !px-2" loading={saving === i.id} icon={<Bookmark className="size-3.5" />} onClick={() => onSave(i.id)}>
        Save
      </Button>
    );
  return (
    <section>
      <div className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("relative flex h-9 items-center gap-1.5 px-3 text-[13px] font-medium", tab === t.key ? "text-ink" : "text-muted hover:text-ink")}>
            <t.icon className="size-3.5" /> {t.label}
            <span className="rounded bg-surface-2 px-1 text-[11px] text-muted">{groups[t.key].length}</span>
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {tab === "visual" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.visual.map((i) => (
            <div key={i.id} className={cx("overflow-hidden rounded-xl border bg-surface", recommended.has(i.id) ? "border-accent-line" : "border-line")}>
              <a href={i.url} target="_blank" rel="noreferrer noopener" className="canvas-grid block aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element -- source preview shown from its host */}
                {i.imageUrl && <img src={i.imageUrl} alt={i.title} referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-contain p-1" />}
              </a>
              <div className="space-y-1 p-2.5">
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug">{i.title}</span>
                  <span className="text-[10.5px] font-semibold text-accent">{i.id}</span>
                </div>
                <div className="truncate text-[11px] text-muted">{i.source}{i.creator ? ` · ${i.creator}` : ""}</div>
                <div className="truncate text-[10.5px] text-subtle">{i.rights}</div>
                <div className="flex items-center justify-between">
                  {recommended.has(i.id) ? <Badge tone="accent">Recommended</Badge> : <span />}
                  <SaveBtn i={i} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab !== "visual" && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {groups[tab].map((i) => (
            <li key={i.id} className="flex gap-3 p-3">
              {i.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- source preview shown from its host
                <img src={i.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-16 flex-none rounded-lg bg-surface-2 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <a href={i.url} target="_blank" rel="noreferrer noopener" className="line-clamp-1 text-[13.5px] font-medium hover:text-accent">
                  <span className="mr-1.5 text-[11px] font-semibold text-accent">{i.id}</span>
                  {i.title}
                </a>
                <div className="text-[11.5px] text-muted">
                  {i.source}{i.publishedAt ? ` · ${new Date(i.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}{i.creator ? ` · ${i.creator}` : ""}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{i.summary}</p>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                {recommended.has(i.id) && <Badge tone="accent">Recommended</Badge>}
                <SaveBtn i={i} />
              </div>
            </li>
          ))}
          {!groups[tab].length && <li className="p-6 text-center text-[13px] text-subtle">Nothing here this time.</li>}
        </ul>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-subtle">
        <Plus className="size-3" /> Saved references keep their source, creator, date and rights note, and are labelled “reference only”.
      </p>
    </section>
  );
}
