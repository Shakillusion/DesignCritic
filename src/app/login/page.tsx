import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Only same-site paths, never "//host" or absolute URLs.
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <LoginForm next={target} />;
}
