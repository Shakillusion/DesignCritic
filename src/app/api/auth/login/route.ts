import { z } from "zod";
import { accessPassword, checkPassword, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { handle, HttpError, json, parseBody } from "@/lib/http";

const Body = z.object({ password: z.string().max(500) });

// Brute-force brake: 10 attempts per client per 15 minutes (in-process; one server).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const g = globalThis as unknown as { __dcLoginAttempts?: Map<string, { count: number; resetAt: number }> };
const attempts = (g.__dcLoginAttempts ??= new Map());

function clientKey(req: Request) {
  // Behind Caddy the last X-Forwarded-For entry is the address Caddy saw.
  const fwd = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

export const POST = handle(async (req: Request) => {
  if (!accessPassword()) throw new HttpError(400, "Sign-in is turned off on this server.");
  const key = clientKey(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((entry.resetAt - now) / 60000)} min.`);
  }
  const { password } = await parseBody(req, Body);
  if (!checkPassword(password)) {
    const fresh = !entry || entry.resetAt <= now;
    attempts.set(key, { count: fresh ? 1 : entry.count + 1, resetAt: fresh ? now + WINDOW_MS : entry.resetAt });
    throw new HttpError(401, "Wrong password.");
  }
  attempts.delete(key);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(now), {
    httpOnly: true,
    sameSite: "lax",
    secure: (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
});
