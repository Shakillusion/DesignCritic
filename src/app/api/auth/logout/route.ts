import { SESSION_COOKIE } from "@/lib/auth/session";
import { handle, json } from "@/lib/http";

export const POST = handle(async () => {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});
