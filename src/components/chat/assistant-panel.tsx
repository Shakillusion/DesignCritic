"use client";

import { ArrowRight, Loader2, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, cx, scoreTone } from "@/components/ui";
import { JobProgress } from "@/components/ui/job-progress";
import { api, useFetch, useJob } from "@/hooks/use-api";
import type { ChatMessage } from "@/types/domain";

const SUGGESTIONS = ["Make the headline stronger", "The composition feels too generic — what would you change?", "Give me 2 more experimental variations", "Is this ready for print?"];

/** Persistent, project-aware assistant. Design changes always arrive as new, reviewable versions. */
export function AssistantPanel({ projectId, designId, onVersionCreated }: { projectId: string; designId: string | null; onVersionCreated?: () => void }) {
  const url = `/api/chat?projectId=${projectId}${designId ? `&designId=${designId}` : ""}`;
  const { data, setData } = useFetch<{ messages: ChatMessage[] }>(url);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = data?.messages ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  const send = async (message: string) => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    setText("");
    const optimistic: ChatMessage = { id: "pending", projectId, designId, role: "user", content: message, action: null, createdAt: new Date().toISOString() };
    setData((d) => ({ messages: [...(d?.messages ?? []), optimistic] }));
    try {
      const res = await api<{ user: ChatMessage; assistant: ChatMessage }>("/api/chat", { method: "POST", json: { projectId, designId, message } });
      setData((d) => ({ messages: [...(d?.messages ?? []).filter((m) => m.id !== "pending"), res.user, res.assistant] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData((d) => ({ messages: (d?.messages ?? []).filter((m) => m.id !== "pending") }));
      setText(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length && !sending && (
          <div className="py-4">
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="size-5" />
            </div>
            <p className="text-[13px] leading-relaxed text-muted">Ask about this {designId ? "design" : "project"} or request a change. Changes become new versions you review — nothing is overwritten.</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {(designId ? SUGGESTIONS : SUGGESTIONS.slice(1, 2)).map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-lg border border-line px-3 py-2 text-left text-[12.5px] text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-soft/30">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} onVersionCreated={onVersionCreated} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Thinking…
          </div>
        )}
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
        className="flex-none border-t border-line p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={Math.min(4, Math.max(1, text.split("\n").length))}
            placeholder={designId ? "Ask or request a change…" : "Ask about this project…"}
            maxLength={2000}
            className="min-h-6 flex-1 resize-none bg-transparent text-[13px] text-ink outline-none placeholder:text-subtle"
          />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send" className="flex size-7 flex-none items-center justify-center rounded-lg bg-accent text-accent-ink disabled:opacity-40">
            <Send className="size-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { edit: "Editing the design", critique: "Re-critiquing", apply_fixes: "Applying critique fixes", variations: "Creating variations" };

function Bubble({ m, onVersionCreated }: { m: ChatMessage; onVersionCreated?: () => void }) {
  const mine = m.role === "user";
  return (
    <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap", mine ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-surface-2 text-ink")}>
        {m.content}
        {m.action && <ActionStatus action={m.action} onVersionCreated={onVersionCreated} />}
      </div>
    </div>
  );
}

function ActionStatus({ action, onVersionCreated }: { action: NonNullable<ChatMessage["action"]>; onVersionCreated?: () => void }) {
  const job = useJob(action.jobId ?? null, (j) => j.status === "succeeded" && onVersionCreated?.());
  if (action.status === "failed") return <div className="mt-2 rounded-lg bg-critical-soft px-2.5 py-1.5 text-[12px] text-critical">Couldn’t start: {action.detail}</div>;
  if (!action.jobId) return null;
  const r = job?.status === "succeeded" ? (job.result as { designId?: string; versionId?: string; versionNumber?: number; scoreBefore?: number | null; scoreAfter?: number | null; critiqueId?: string; overall?: number; designs?: { designId: string }[] }) : null;
  return (
    <div className="mt-2.5 rounded-xl border border-line bg-surface p-3 text-ink">
      <div className="mb-2 text-[11.5px] font-semibold tracking-wide text-muted uppercase">{ACTION_LABEL[action.type] ?? action.type}</div>
      {job && job.status !== "succeeded" && <JobProgress job={job} />}
      {job?.status === "failed" && <p className="mt-2 text-[12px] text-critical">{job.error}</p>}
      {r?.versionId && r.designId && (
        <Link href={`/designs/${r.designId}?version=${r.versionId}&compare=1`} className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-accent hover:underline">
          <span>Review v{r.versionNumber}</span>
          {r.scoreAfter != null && (
            <span className="flex items-center gap-1">
              <Badge tone={scoreTone(r.scoreBefore ?? null)}>{r.scoreBefore ?? "–"}</Badge>→<Badge tone={scoreTone(r.scoreAfter)}>{r.scoreAfter}</Badge>
            </span>
          )}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
      {r?.critiqueId && !r.versionId && (
        <Link href={`/critiques/${r.critiqueId}`} className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
          Open critique {r.overall != null && <Badge tone={scoreTone(r.overall)}>{r.overall}</Badge>} <ArrowRight className="size-3.5" />
        </Link>
      )}
      {r?.designs && (
        <div className="flex flex-wrap gap-2">
          {r.designs.map((d, i) => (
            <Link key={d.designId} href={`/designs/${d.designId}`} className="text-[12.5px] font-medium text-accent hover:underline">
              Variation {i + 1} →
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
