"use client";

import { Palette, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, EmptyState, ErrorNote, Field, Input, PageHeader, Skeleton, timeAgo } from "@/components/ui";
import { api, useFetch } from "@/hooks/use-api";
import type { Brand } from "@/types/domain";

export function BrandsView() {
  const router = useRouter();
  const { data, error, loading } = useFetch<{ brands: (Brand & { projectCount: number })[] }>("/api/brands");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return setErr("Name the brand.");
    setBusy(true);
    try {
      const { brand } = await api<{ brand: Brand }>("/api/brands", { method: "POST", json: { name } });
      router.push(`/brands/${brand.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Library"
        title="Brand Library"
        description="Colours, typography, logo rules and restrictions. Mark each rule locked, flexible or inspirational — the agents treat them accordingly and never invent what isn’t here."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            New brand
          </Button>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : data && !data.brands.length ? (
        <EmptyState icon={<Palette className="size-5" />} title="No brands yet" description="Create a brand profile by hand, or upload guidelines and let the Brand Guardian propose the rules for you to confirm." action={<Button variant="primary" onClick={() => setOpen(true)}>Create a brand</Button>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {data?.brands.map((b) => {
            const display = b.typography.find((t) => /display|head/i.test(t.role)) ?? b.typography[0];
            return (
              <Link key={b.id} href={`/brands/${b.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex h-24">
                  {b.colors.length ? (
                    b.colors.slice(0, 6).map((c, i) => <div key={i} className="flex-1 first:flex-[2]" style={{ background: c.hex }} />)
                  ) : (
                    <div className="canvas-grid flex flex-1 items-center justify-center text-[12px] text-subtle">No colours yet</div>
                  )}
                </div>
                <div className="p-5">
                  <div className="font-display text-[22px] leading-tight font-semibold">{b.name}</div>
                  <div className="mt-1 line-clamp-2 min-h-[2.6em] text-[13px] text-muted">{b.description || b.industry || "No description yet."}</div>
                  <div className="mt-4 flex items-center justify-between text-[12px] text-subtle">
                    <span>{display ? `${display.family}` : "No typography"}</span>
                    <span>
                      {b.projectCount} project{b.projectCount === 1 ? "" : "s"} · {timeAgo(b.updatedAt)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New brand"
        description="Start with a name. You’ll add colours, type and rules next — or extract them from guidelines."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={create}>
              Create brand
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), void create())}>
          <Field label="Brand name" error={err}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Alpine Rail" />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
