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
  const send = (f: File) => {
    const form = new FormData();
    form.append("file", f);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return api<T>("/api/uploads", { method: "POST", body: form });
  };
  try {
    return await send(file);
  } catch (err) {
    // Hosted servers cap request size (about 4 MB on Vercel). Retry a large photo re-encoded to fit.
    if (!(err instanceof ApiError && err.status === 413) || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw err;
    const smaller = await shrinkImage(file, 3.8 * 1024 * 1024);
    if (!smaller) throw err;
    return send(smaller);
  }
}

/** Re-encode an image as WebP, stepping the size down until it fits under maxBytes. */
async function shrinkImage(file: File, maxBytes: number): Promise<File | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  try {
    for (const scale of [1, 0.85, 0.7, 0.55, 0.4]) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
      if (out && out.size <= maxBytes) return new File([out], file.name.replace(/\.\w+$/, "") + ".webp", { type: "image/webp" });
    }
    return null;
  } finally {
    bitmap.close();
  }
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
