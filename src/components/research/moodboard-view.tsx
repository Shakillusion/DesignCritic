"use client";

import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, PenTool, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtDirection } from "@/agents/research/schema";
import { Badge, Button, ConfirmDialog, cx, Dialog, ErrorNote, Field, Panel, Segmented, Skeleton, Textarea } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { useToast } from "@/components/ui/toast";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { Job, Project } from "@/types/domain";

interface Ref {
  id: string;
  source: string;
  title: string;
  url: string;
  creator: string | null;
  fileId: string | null;
  palette: string[];
  rights: string | null;
}
interface Item {
  ref: Ref;
  size: "s" | "m" | "l";
  note: string;
}
interface Data {
  moodboard: { id: string; name: string; notes: string; projectId: string; items: Item[] };
  project: Project;
  directions: { id: string; data: ArtDirection; createdAt: string }[];
}

const SPAN = { s: "col-span-1 row-span-1", m: "col-span-1 row-span-2", l: "col-span-2 row-span-2" };

export function MoodboardView({ id }: { id: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data, error, reload } = useFetch<Data>(`/api/moodboards/${id}`);
  const refsQ = useFetch<{ references: Ref[] }>(data ? `/api/references?projectId=${data.moodboard.projectId}` : null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picker, setPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState<"2" | "3">("3");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, (j) => {
    setJobId(null);
    if (j.status === "failed") toast(j.error ?? "Couldn’t propose directions", "error");
    void reload();
  });
  const dragFrom = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable board once
    setName(data.moodboard.name);
    setNotes(data.moodboard.notes);
    setItems(data.moodboard.items);
    setBrief(data.project.description);
    setLoaded(true);
  }, [data, loaded]);

  // Autosave (debounced) whenever the board changes.
  const persist = (next: { name?: string; notes?: string; items?: Item[] }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api(`/api/moodboards/${id}`, { method: "PATCH", json: { name: next.name ?? name, notes: next.notes ?? notes, items: (next.items ?? items).map((i) => ({ refId: i.ref.id, size: i.size, note: i.note })) } }).catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
    }, 500);
  };
  const setAndSaveItems = (next: Item[]) => {
    setItems(next);
    persist({ items: next });
  };

  const palette = useMemo(() => [...new Set(items.flatMap((i) => i.ref.palette.slice(0, 3)))].slice(0, 12), [items]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !loaded) return <Skeleton className="h-96 rounded-2xl" />;

  const propose = async () => {
    try {
      const { job: j } = await api<{ job: Job }>(`/api/moodboards/${id}/directions`, { method: "POST", json: { brief, count: Number(count) } });
      setJobId(j.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const onBoard = new Set(items.map((i) => i.ref.id));
  const refById = new Map(items.map((i) => [i.ref.id, i.ref]));

  return (
    <div className="animate-in">
      <Link href={`/research?projectId=${data.moodboard.projectId}`} className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Research · {data.project.name}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <input value={name} onChange={(e) => (setName(e.target.value), persist({ name: e.target.value }))} className="font-display w-full max-w-xl bg-transparent text-[30px] font-semibold text-ink outline-none" aria-label="Moodboard name" maxLength={120} />
        <div className="flex gap-2">
          <Button icon={<Plus className="size-4" />} onClick={() => setPicker(true)}>
            Add references
          </Button>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)} aria-label="Delete moodboard" />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {palette.length > 0 && (
            <div className="flex h-10 overflow-hidden rounded-xl ring-1 ring-line" title="Colours drawn from the references">
              {palette.map((c) => (
                <div key={c} className="group relative flex-1" style={{ background: c }}>
                  <span className="absolute inset-x-0 bottom-0.5 hidden text-center font-mono text-[9.5px] text-white mix-blend-difference group-hover:block">{c}</span>
                </div>
              ))}
            </div>
          )}
          {items.length ? (
            <div className="grid auto-rows-[140px] grid-cols-2 gap-3 md:grid-cols-4" style={{ gridAutoFlow: "dense" }}>
              {items.map((it, i) => (
                <div
                  key={it.ref.id}
                  draggable
                  onDragStart={() => (dragFrom.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = dragFrom.current;
                    if (from === null || from === i) return;
                    const next = [...items];
                    const [m] = next.splice(from, 1);
                    next.splice(i, 0, m);
                    setAndSaveItems(next);
                  }}
                  className={cx("group relative cursor-grab overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line active:cursor-grabbing", SPAN[it.size])}
                >
                  {it.ref.fileId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview
                    <img src={`/api/files/${it.ref.fileId}`} alt={it.ref.title} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3 text-center text-[12px] text-muted">{it.ref.title}</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 opacity-0 transition group-hover:opacity-100">
                    <div className="truncate text-[11.5px] font-medium text-white">{it.ref.title}</div>
                    <input value={it.note} onChange={(e) => setAndSaveItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder="Why it’s here…" className="mt-1 w-full rounded bg-white/15 px-1.5 py-0.5 text-[11px] text-white placeholder:text-white/60 outline-none" maxLength={500} />
                  </div>
                  <div className="absolute top-1.5 right-1.5 hidden gap-1 group-hover:flex">
                    <button aria-label="Change size" onClick={() => setAndSaveItems(items.map((x, j) => (j === i ? { ...x, size: x.size === "s" ? "m" : x.size === "m" ? "l" : "s" } : x)))} className="flex size-6 items-center justify-center rounded-md bg-black/50 text-white">
                      {it.size === "l" ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
                    </button>
                    <a href={it.ref.url} target="_blank" rel="noreferrer noopener" aria-label="Open source" className="flex size-6 items-center justify-center rounded-md bg-black/50 text-white">
                      <ExternalLink className="size-3" />
                    </a>
                    <button aria-label="Remove from board" onClick={() => setAndSaveItems(items.filter((_, j) => j !== i))} className="flex size-6 items-center justify-center rounded-md bg-black/50 text-white">
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center text-[13px] text-muted">Add saved references to start the board. Drag to reorder; hover to resize, annotate or remove.</p>
          )}
          <Field label="Board notes" hint="What you’re after — the Creative Director reads these.">
            <Textarea rows={3} value={notes} onChange={(e) => (setNotes(e.target.value), persist({ notes: e.target.value }))} maxLength={4000} placeholder="e.g. Quiet confidence. Big skies, small type. Avoid the generic mountain-sunrise look." />
          </Field>
          <p className="text-[11.5px] text-subtle">References are for direction only and keep their sources and rights notes. They’re never placed in your artwork.</p>
        </div>

        <aside className="space-y-4">
          <Panel className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h2 className="text-[14.5px] font-semibold">Art directions from this board</h2>
            </div>
            <Field label="Brief">
              <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} placeholder="What is this for?" />
            </Field>
            <Field label="Directions">
              <Segmented value={count} onChange={setCount} options={[{ value: "2", label: "2" }, { value: "3", label: "3" }]} />
            </Field>
            {jobId ? <JobProgress job={job} /> : (
              <Button variant="primary" className="w-full" icon={<Sparkles className="size-4" />} onClick={propose} disabled={items.length < 2}>
                Propose original directions
              </Button>
            )}
            {items.length < 2 && <p className="text-[12px] text-muted">Add at least two references.</p>}
          </Panel>
          {data.directions.map((d) => (
            <DirectionCard key={d.id} id={d.id} d={d.data} refById={refById} onUse={() => router.push(`/create?projectId=${data.moodboard.projectId}&directionId=${d.id}`)} />
          ))}
        </aside>
      </div>

      <Dialog open={picker} onClose={() => setPicker(false)} title="Add references" description="From this project’s saved references." width="max-w-3xl">
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {refsQ.data?.references.map((r) => {
            const on = onBoard.has(r.id);
            return (
              <button key={r.id} disabled={on} onClick={() => setAndSaveItems([...items, { ref: r, size: "s", note: "" }])} className={cx("overflow-hidden rounded-lg text-left ring-1", on ? "opacity-40 ring-line" : "ring-line hover:ring-accent")}>
                {r.fileId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview
                  <img src={`/api/files/${r.fileId}?thumb=240`} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-surface-2 p-2 text-[11px] text-muted">{r.title}</div>
                )}
                <div className="truncate p-1.5 text-[11px]">{on ? "On the board" : r.title}</div>
              </button>
            );
          })}
          {!refsQ.data?.references.length && <p className="col-span-full py-6 text-center text-[13px] text-muted">No saved references yet — save some from Research.</p>}
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await api(`/api/moodboards/${id}`, { method: "DELETE" });
          router.push(`/research?projectId=${data.moodboard.projectId}`);
        }}
        title="Delete this moodboard?"
        description="The board and its directions are removed. Saved references stay in the project."
        confirmLabel="Delete board"
      />
    </div>
  );
}

function DirectionCard({ id, d, refById, onUse }: { id: string; d: ArtDirection; refById: Map<string, Ref>; onUse: () => void }) {
  return (
    <Panel className="animate-in space-y-3" key={id}>
      <div>
        <h3 className="font-display text-[18px] font-semibold">{d.name}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{d.idea}</p>
      </div>
      {d.palette.length > 0 && (
        <div className="flex h-7 overflow-hidden rounded-lg ring-1 ring-line">
          {d.palette.map((c) => <div key={c} className="flex-1" style={{ background: c }} title={c} />)}
        </div>
      )}
      <dl className="space-y-1.5 text-[12.5px]">
        {(
          [
            ["Composition", d.composition],
            ["Type", d.typography],
            ["Imagery", d.imagery],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{k}</dt>
            <dd className="text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
      {d.avoid.length > 0 && <p className="text-[12px] text-muted"><b className="text-ink-2">Avoid:</b> {d.avoid.join(" · ")}</p>}
      {d.inspiredBy.length > 0 && (
        <div className="space-y-1">
          {d.inspiredBy.map((x) => {
            const r = refById.get(x.refId);
            return (
              <div key={x.refId + x.principle} className="flex items-center gap-2 text-[12px]">
                {r?.fileId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview
                  <img src={`/api/files/${r.fileId}?thumb=80`} alt="" className="size-6 flex-none rounded object-cover" />
                ) : <Badge>ref</Badge>}
                <span className="text-ink-2">{x.principle}</span>
              </div>
            );
          })}
        </div>
      )}
      <Button size="sm" className="w-full" icon={<PenTool className="size-3.5" />} onClick={onUse}>
        Use in Create <ArrowRight className="size-3.5" />
      </Button>
    </Panel>
  );
}
