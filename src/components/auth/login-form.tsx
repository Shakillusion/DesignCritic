"use client";

import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Logo } from "@/components/shell/app-shell";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/hooks/use-api";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { password } });
      // Full navigation so every server component re-renders with the new cookie.
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="animate-in w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="size-11" />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight">DesignCritic AI</h1>
          <p className="mt-1 text-[13.5px] text-muted">This studio is private. Enter the access password to continue.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <Field label="Password" htmlFor="password" error={error}>
            <Input id="password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!password} icon={<LockKeyhole className="size-4" />} className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
