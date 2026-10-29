"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@/types/domain";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** fetch + JSON with the server's error message surfaced. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: body !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; issues?: string[] };
  if (!res.ok) {
    const detail = data.issues?.length ? ` (${data.issues.join("; ")})` : "";
    throw new ApiError((data.error ?? `Request failed (${res.status})`) + detail, res.status, data.code);
  }
  return data as T;
}

export async function uploadFile<T = unknown>(file: File, fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return api<T>("/api/uploads", { method: "POST", body: form });
}

export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the network
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Poll a background job until it finishes. */
export function useJob(jobId: string | null, onFinish?: (job: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const finishRef = useRef(onFinish);
  useEffect(() => {
    finishRef.current = onFinish;
  });

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job: j } = await api<{ job: Job }>(`/api/jobs/${jobId}`);
        if (stop) return;
        setJob(j);
        if (j.status === "succeeded" || j.status === "failed") {
          finishRef.current?.(j);
          return;
        }
      } catch {
        /* transient: keep polling */
      }
      timer = setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return job;
}
