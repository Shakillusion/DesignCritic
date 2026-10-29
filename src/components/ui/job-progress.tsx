"use client";

import { Check, Circle, Loader2, Minus, X } from "lucide-react";
import type { Job } from "@/types/domain";
import { cx } from "./index";

export function JobProgress({ job, title }: { job: Job | null; title?: string }) {
  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Starting…
      </div>
    );
  }
  return (
    <div>
      {title && <div className="mb-3 text-[13px] font-semibold text-ink">{title}</div>}
      <ol className="space-y-2.5">
        {job.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-3">
            <span
              className={cx(
                "mt-px flex size-5 flex-none items-center justify-center rounded-full",
                s.status === "done" && "bg-success-soft text-success",
                s.status === "running" && "bg-accent-soft text-accent",
                s.status === "failed" && "bg-critical-soft text-critical",
                (s.status === "pending" || s.status === "skipped") && "bg-surface-2 text-subtle",
              )}
            >
              {s.status === "done" && <Check className="size-3" strokeWidth={3} />}
              {s.status === "running" && <Loader2 className="size-3 animate-spin" strokeWidth={3} />}
              {s.status === "failed" && <X className="size-3" strokeWidth={3} />}
              {s.status === "pending" && <Circle className="size-2" />}
              {s.status === "skipped" && <Minus className="size-3" />}
            </span>
            <div className="min-w-0">
              <div className={cx("text-[13.5px]", s.status === "pending" ? "text-subtle" : "text-ink", s.status === "running" && "font-medium")}>{s.label}</div>
              {s.detail && <div className={cx("mt-0.5 text-[12px] break-words", s.status === "failed" ? "text-critical" : "text-muted")}>{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
