import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkPassword, createSessionToken, isValidSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { proxy } from "@/proxy";
import { POST as login } from "@/app/api/auth/login/route";

const setPassword = (p: string | undefined) => (p === undefined ? delete process.env.DESIGNCRITIC_PASSWORD : (process.env.DESIGNCRITIC_PASSWORD = p));
afterEach(() => setPassword(undefined));

describe("session tokens", () => {
  it("is open when no password is configured", () => {
    expect(isValidSession(undefined)).toBe(true);
  });

  it("accepts its own token and rejects tampered, expired or stale ones", () => {
    setPassword("correct horse");
    const now = Date.now();
    const token = createSessionToken(now);
    expect(isValidSession(token, now)).toBe(true);
    expect(isValidSession(undefined, now)).toBe(false);
    expect(isValidSession(token.replace(/.$/, (c) => (c === "0" ? "1" : "0")), now)).toBe(false);
    const [exp, mac] = token.split(".");
    expect(isValidSession(`${Number(exp) + 999}.${mac}`, now)).toBe(false);
    expect(isValidSession(token, now + (SESSION_MAX_AGE + 1) * 1000)).toBe(false);
    setPassword("new password");
    expect(isValidSession(token, now)).toBe(false);
  });

  it("checks the password", () => {
    setPassword("s3cret");
    expect(checkPassword("s3cret")).toBe(true);
    expect(checkPassword("s3cre")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
});

describe("proxy gate", () => {
  const req = (path: string, cookie?: string) => new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

  it("lets everything through without a password", () => {
    expect(proxy(req("/projects")).headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects pages, 401s APIs and keeps public paths open", async () => {
    setPassword("pw");
    const page = proxy(req("/projects?x=1"));
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).searchParams.get("next")).toBe("/projects?x=1");
    expect(proxy(req("/api/projects")).status).toBe(401);
    for (const open of ["/login", "/api/health", "/api/auth/login"]) expect(proxy(req(open)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/api/projects", createSessionToken())).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("login route", () => {
  const post = (password: string, ip: string) => login(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ password }) }));

  it("sets an httpOnly session cookie on the right password", async () => {
    setPassword("pw");
    const res = await post("pw", "10.0.0.1");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(isValidSession(cookie.match(/dc_session=([^;]+)/)![1])).toBe(true);
  });

  it("rejects wrong passwords and rate-limits repeated attempts", async () => {
    setPassword("pw");
    for (let i = 0; i < 10; i++) expect((await post("nope", "10.0.0.2")).status).toBe(401);
    expect((await post("pw", "10.0.0.2")).status).toBe(429);
    expect((await post("pw", "10.0.0.3")).status).toBe(200);
  });
});
