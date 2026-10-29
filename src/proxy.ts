import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health"]);

/** Password gate: open when DESIGNCRITIC_PASSWORD is unset, otherwise every page and API needs a session cookie. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
