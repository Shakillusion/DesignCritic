import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { ConflictError, NotFoundError } from "@/lib/database/repo";
import { LOCAL_USER_ID } from "@/lib/database/db";
import { UploadError } from "@/lib/image-processing/image";
import { AiError } from "@/lib/ai/client";
import { AssetSearchError } from "@/agents/asset-agent";
import { SafeFetchError } from "@/lib/net/safe-fetch";
import { RendererUnavailableError } from "@/lib/design-engine/renderer";
import { errorFields, logger } from "@/lib/logger";

/**
 * Authentication seam. Locally there is one user; with Supabase Auth this
 * reads the session and throws 401 when absent. Every handler calls it.
 */
export async function requireUser(): Promise<{ id: string }> {
  return { id: LOCAL_USER_ID };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Wrap a route handler: maps known errors to status codes and logs the rest. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) {
        return json({ error: "Invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      }
      if (err instanceof NotFoundError) return json({ error: err.message }, { status: 404 });
      if (err instanceof ConflictError) return json({ error: err.message }, { status: 409 });
      if (err instanceof UploadError) return json({ error: err.message }, { status: 400 });
      if (err instanceof AssetSearchError) return json({ error: err.message }, { status: 422 });
      if (err instanceof SafeFetchError) return json({ error: `Couldn't fetch the external file: ${err.message}` }, { status: 502 });
      if (err instanceof RendererUnavailableError) return json({ error: err.message }, { status: 503 });
      if (err instanceof AiError) {
        const status = err.code === "not-configured" ? 503 : err.code === "rate-limit" ? 429 : 502;
        return json({ error: err.message, code: err.code }, { status });
      }
      logger.error("http.unhandled", errorFields(err));
      return json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  return schema.parse(body);
}
