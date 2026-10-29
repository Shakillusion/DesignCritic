import "server-only";
import { createJob, failOrphanedJobs, getJob, updateJob } from "@/lib/database/repo";
import { errorFields, logger } from "@/lib/logger";
import type { Job, JobStep } from "@/types/domain";

/**
 * In-process background jobs for long AI operations. The request returns a job
 * id immediately; the client polls /api/jobs/:id. Good for a single local
 * server; a hosted deployment would move `run` onto a queue worker.
 */

const g = globalThis as unknown as { __dcJobsBooted?: boolean };
function boot() {
  if (g.__dcJobsBooted) return;
  g.__dcJobsBooted = true;
  failOrphanedJobs();
}

export interface JobContext {
  jobId: string;
  /** Run one named step; its status is persisted so the UI can show progress. */
  step<T>(key: string, fn: (setDetail: (d: string) => void) => Promise<T>): Promise<T>;
  skip(key: string, detail: string): void;
  addSteps(steps: { key: string; label: string }[]): void;
}

export function startJob(
  userId: string,
  input: { type: Job["type"]; projectId: string | null; steps: { key: string; label: string }[] },
  work: (ctx: JobContext) => Promise<Record<string, unknown>>,
): Job {
  boot();
  const job = createJob(userId, {
    type: input.type,
    projectId: input.projectId,
    steps: input.steps.map((s) => ({ ...s, status: "pending" })),
  });
  const id = job.id;

  const patchStep = (key: string, patch: Partial<JobStep>) => {
    const steps = getJob(userId, id).steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
    updateJob(userId, id, { steps });
  };

  const ctx: JobContext = {
    jobId: id,
    async step(key, fn) {
      patchStep(key, { status: "running" });
      try {
        const out = await fn((detail) => patchStep(key, { detail }));
        patchStep(key, { status: "done" });
        return out;
      } catch (err) {
        patchStep(key, { status: "failed", detail: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    skip(key, detail) {
      patchStep(key, { status: "skipped", detail });
    },
    addSteps(steps) {
      const current = getJob(userId, id).steps;
      updateJob(userId, id, { steps: [...current, ...steps.map((s) => ({ ...s, status: "pending" as const }))] });
    },
  };

  void (async () => {
    updateJob(userId, id, { status: "running" });
    try {
      const result = await work(ctx);
      updateJob(userId, id, { status: "succeeded", result });
      logger.info("job.succeeded", { jobId: id, type: input.type });
    } catch (err) {
      logger.error("job.failed", { jobId: id, type: input.type, ...errorFields(err) });
      updateJob(userId, id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return job;
}
