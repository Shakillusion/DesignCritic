import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-password access gate for deployments. When DESIGNCRITIC_PASSWORD is
 * unset the app stays open, exactly as it runs locally. No "server-only" here:
 * proxy.ts imports this too.
 */
export const SESSION_COOKIE = "dc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // seconds

export const accessPassword = () => process.env.DESIGNCRITIC_PASSWORD?.trim() || null;

const sign = (password: string, payload: string) => createHmac("sha256", password).update(`designcritic-session-v1:${payload}`).digest("hex");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Token is "<expiry>.<hmac>", keyed by the password, so changing the password signs everyone out. */
export function createSessionToken(now = Date.now()): string {
  const password = accessPassword();
  if (!password) throw new Error("DESIGNCRITIC_PASSWORD is not set.");
  const exp = String(Math.floor(now / 1000) + SESSION_MAX_AGE);
  return `${exp}.${sign(password, exp)}`;
}

export function isValidSession(token: string | undefined, now = Date.now()): boolean {
  const password = accessPassword();
  if (!password) return true;
  const [exp, mac] = (token ?? "").split(".");
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;
  return safeEqual(mac, sign(password, exp));
}

export function checkPassword(input: string): boolean {
  const password = accessPassword();
  // Compare digests so the timing doesn't depend on where the strings differ.
  return Boolean(password) && safeEqual(sign(input, "check"), sign(password!, "check"));
}
