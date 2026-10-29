import "server-only";
import { after } from "next/server";
import { createJob, failInterruptedWork, updateJob } from "@/lib/database/repo";
import { env } from "@/lib/env";
import { errorFields, logger } from "@/lib/logger";
import type { Job, JobStep } from "@/types/domain";

/**
 * Background jobs for long AI operations. The request returns a job id
 * immediately and the client polls /api/jobs/:id; progress lives in the
 * database, so any server instance can answer the poll. The work itself runs
 * in the instance that started it, kept alive after the response by `after()`
 * (on Vercel, for up to the function's max duration).
 */

/** On serverless, a job untouched for this long has been cut off by the platform's time limit. */
export const STALE_JOB_MS = 6 * 60 * 1000;
/** Work budget per job: Vercel stops a function at 300 s, so jobs plan to finish well before. */
export const JOB_BUDGET_MS = env.onVercel ? 280_000 : Number.POSITIVE_INFINITY;

const g = globalThis as unknown as { __dcJobsBooted?: boolean };
async function boot() {
  if (g.__dcJobsBooted) return;
  g.__dcJobsBooted = true;
  // A single local server owns every job, so anything still "running" at startup was interrupted.
  // Serverless instances share the database with live siblings, so only stale work is failed there.
  await failInterruptedWork(env.onVercel ? new Date(Date.now() - STALE_JOB_MS).toISOString() : null);
}

export interface JobContext {
  jobId: string;
  /** Run one named step; its status is persisted so the UI can show progress. */
  step<T>(key: string, fn: (setDetail: (d: string) => void) => Promise<T>): Promise<T>;
  skip(key: string, detail: string): void;
  addSteps(steps: { key: string; label: string }[]): void;
  /** Milliseconds left in this job's time budget (Infinity when there is no platform limit). */
  timeLeft(): number;
}

export async function startJob(
  userId: string,
  input: { type: Job["type"]; projectId: string | null; steps: { key: string; label: string }[] },
  work: (ctx: JobContext) => Promise<Record<string, unknown>>,
): Promise<Job> {
  await boot();
  const job = await createJob(userId, {
    type: input.type,
    projectId: input.projectId,
    steps: input.steps.map((s) => ({ ...s, status: "pending" })),
  });
  const id = job.id;
  const deadline = Date.now() + JOB_BUDGET_MS;

  // This instance owns the job, so its copy of the steps is authoritative. Writes are
  // chained so a slow detail update can never land after (and undo) a later status change.
  let steps: JobStep[] = job.steps;
  let writes: Promise<unknown> = Promise.resolve();
  const persist = (patch: Partial<Pick<Job, "status" | "result" | "error">> = {}) => {
    const snapshot = steps;
    writes = writes.then(() => updateJob(userId, id, { ...patch, steps: snapshot })).catch((err) => logger.warn("job.persist_failed", { jobId: id, error: String(err) }));
    return writes;
  };
  const patchStep = (key: string, patch: Partial<JobStep>) => {
    steps = steps.map((s) => (s.key === key ? { ...s, ...patch } : s));
    return persist();
  };

  const ctx: JobContext = {
    jobId: id,
    async step(key, fn) {
      await patchStep(key, { status: "running" });
      try {
        const out = await fn((detail) => void patchStep(key, { detail }));
        await patchStep(key, { status: "done" });
        return out;
      } catch (err) {
        await patchStep(key, { status: "failed", detail: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
    skip(key, detail) {
      void patchStep(key, { status: "skipped", detail });
    },
    timeLeft: () => deadline - Date.now(),
    addSteps(more) {
      steps = [...steps, ...more.map((s) => ({ ...s, status: "pending" as const }))];
      void persist();
    },
  };

  const running = (async () => {
    await persist({ status: "running" });
    try {
      const result = await work(ctx);
      await persist({ status: "succeeded", result });
      logger.info("job.succeeded", { jobId: id, type: input.type });
    } catch (err) {
      logger.error("job.failed", { jobId: id, type: input.type, ...errorFields(err) });
      await persist({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();
  try {
    after(() => running); // keep a serverless instance alive until the job settles
  } catch {
    /* outside a request (tests, scripts): the promise simply runs on */
  }

  return job;
}
