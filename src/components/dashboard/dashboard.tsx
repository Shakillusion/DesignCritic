"use client";

import { ArrowRight, ArrowUpRight, Check, CircleAlert, KeyRound, Palette, Plus, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ButtonLink, cx, EmptyState, Panel, scoreTone, SectionTitle, Skeleton, timeAgo } from "@/components/ui";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { useFetch } from "@/hooks/use-api";
import type { Critique, ProjectSummary } from "@/types/domain";

interface Status {
  ai: { configured: boolean; activeLabel: string | null };
  renderer: { available: boolean; detail: string };
  assetProviders: { id: string; label: string; configured: boolean }[];
}
type CritiqueRow = Critique & { projectName: string; findingCount: number; summary: string | null };

/* Miniature compositions: each mode tile shows what the mode does. */
function CritiqueArt() {
  return (
    <div className="relative h-full w-full">
      <div className="absolute top-[14%] left-[22%] h-[72%] w-[46%] rounded-md bg-[#1f2b3a] shadow-md">
        <div className="absolute top-[12%] left-[10%] h-[9%] w-[70%] rounded-sm bg-[#f4efe6]" />
        <div className="absolute top-[25%] left-[10%] h-[5%] w-[44%] rounded-sm bg-[#f4efe6]/60" />
        <div className="absolute right-[10%] bottom-[10%] left-[10%] h-[38%] rounded-sm bg-gradient-to-br from-[#e98a5a] to-[#c2462d]" />
      </div>
      <div className="absolute top-[18%] left-[19%] h-[18%] w-[54%] rounded border-2 border-critical" />
      <span className="absolute top-[12%] left-[16%] flex size-5 items-center justify-center rounded-full bg-critical text-[10px] font-bold text-white">1</span>
      <div className="absolute right-[29%] bottom-[11%] h-[42%] w-[18%] rounded border-2 border-major" />
      <span className="absolute right-[26%] bottom-[48%] flex size-5 items-center justify-center rounded-full bg-major text-[10px] font-bold text-white">2</span>
      <div className="absolute top-[16%] right-[6%] flex flex-col items-center rounded-xl bg-surface px-2.5 py-2 shadow-md ring-1 ring-line">
        <span className="text-[17px] leading-none font-semibold tabular-nums">74</span>
        <span className="mt-0.5 text-[8px] font-medium text-muted">SCORE</span>
      </div>
    </div>
  );
}

function CreateArt() {
  return (
    <div className="relative h-full w-full">
      <div className="absolute top-[10%] left-[14%] h-[80%] w-[40%] -rotate-3 overflow-hidden rounded-md bg-gradient-to-b from-[#9fb8cf] via-[#dfe7ec] to-[#5f7a62] shadow-md">
        <div className="absolute inset-x-0 bottom-[34%] h-[30%] bg-[linear-gradient(135deg,transparent_45%,#f7f7f7_46%,#f7f7f7_54%,transparent_55%)] opacity-90" />
        <div className="absolute top-[10%] left-[10%] font-display text-[15px] leading-none font-bold text-white">ALPS</div>
      </div>
      <div className="absolute top-[18%] right-[12%] h-[70%] w-[36%] rotate-3 rounded-md bg-[#f2ede4] p-2 shadow-md">
        <div className="h-[46%] rounded-sm bg-gradient-to-br from-[#2f4b3a] to-[#7d9a73]" />
        <div className="mt-[10%] h-[9%] w-[80%] rounded-sm bg-[#1a1816]" />
        <div className="mt-[6%] h-[5%] w-[55%] rounded-sm bg-[#1a1816]/40" />
      </div>
      <div className="absolute bottom-[8%] left-[44%] rounded-full bg-accent px-2 py-0.5 text-[9px] font-semibold text-white shadow-md">3 concepts</div>
    </div>
  );
}

function ImproveArt() {
  return (
    <div className="relative flex h-full w-full items-center justify-center gap-3">
      <div className="h-[70%] w-[34%] rounded-md bg-[#e8e2d8] p-2 opacity-80 shadow-sm">
        <div className="h-[12%] w-[92%] rounded-sm bg-[#d45d3c]" />
        <div className="mt-[8%] h-[8%] w-[60%] rounded-sm bg-[#d45d3c]/50" />
        <div className="mt-[8%] ml-[14%] h-[40%] w-[60%] rounded-sm bg-[#8a8178]" />
        <div className="mt-[8%] ml-[30%] h-[7%] w-[50%] rounded-sm bg-[#d45d3c]/40" />
      </div>
      <ArrowRight className="size-4 text-subtle" />
      <div className="h-[70%] w-[34%] rounded-md bg-[#151a22] p-2 shadow-md">
        <div className="h-[46%] rounded-sm bg-gradient-to-br from-[#d45d3c] to-[#f0a868]" />
        <div className="mt-[10%] h-[11%] w-[85%] rounded-sm bg-[#f5f1ea]" />
        <div className="mt-[6%] h-[6%] w-[50%] rounded-sm bg-[#f5f1ea]/50" />
        <div className="mt-[10%] h-[8%] w-[36%] rounded-sm bg-[#f0a868]" />
      </div>
    </div>
  );
}

const MODES = [
  { href: "/critique", title: "Critique", line: "Upload artwork. Get a senior art director’s review with scored, located findings.", Art: CritiqueArt, tag: "Ready" },
  { href: "/create", title: "Create", line: "Turn a rough brief into editable layouts with licensed photography.", Art: CreateArt, tag: "Ready" },
  { href: "/improve", title: "Improve", line: "Rank what to fix, keep what works, and build a precise correction plan.", Art: ImproveArt, tag: "Plan ready · auto-fix next" },
];

export function Dashboard() {
  const router = useRouter();
  const { data: status } = useFetch<Status>("/api/status");
  const { data: projects, loading } = useFetch<{ projects: ProjectSummary[] }>("/api/projects");
  const { data: critiques } = useFetch<{ critiques: CritiqueRow[] }>("/api/critiques");
  const [creating, setCreating] = useState(false);

  const needsSetup = status && (!status.ai.configured || !status.renderer.available);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="animate-in">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">{greeting}</p>
          <h1 className="font-display max-w-2xl text-[40px] leading-[1.05] font-semibold text-ink sm:text-[46px]">
            What are we <span className="text-accent">making better</span> today?
          </h1>
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New project
          </Button>
          <ButtonLink href="/critique" variant="primary" icon={<ScanSearch className="size-4" />}>
            Critique a design
          </ButtonLink>
        </div>
      </header>

      {needsSetup && (
        <Panel className="mb-10 border-major/25 bg-major-soft/50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <KeyRound className="mt-0.5 size-5 flex-none text-major" />
              <div>
                <h2 className="text-[15px] font-semibold">Finish setup to run the AI agents</h2>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <SetupItem ok={status.ai.configured} label="A free AI key (Gemini, Groq or OpenRouter)" hint="Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to designcritic-ai/.env.local, then restart the dev server. All three have free tiers." />
                  <SetupItem ok={status.renderer.available} label="Rendering browser" hint={status.renderer.detail} />
                  <SetupItem ok label="Free asset libraries (Openverse, Wikimedia, Iconify)" />
                </ul>
              </div>
            </div>
            <ButtonLink href="/settings" size="sm">
              Open settings
            </ButtonLink>
          </div>
        </Panel>
      )}

      <section className="mb-12 grid gap-5 md:grid-cols-3">
        {MODES.map(({ href, title, line, Art, tag }) => (
          <Link key={href} href={href} className="group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
            <div className="canvas-grid h-44 border-b border-line">
              <Art />
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-[20px] font-semibold">{title}</h2>
                <ArrowUpRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{line}</p>
              <p className="mt-3 text-[11.5px] font-medium text-subtle">{tag}</p>
            </div>
          </Link>
        ))}
      </section>

      <div className="grid gap-10 xl:grid-cols-[1fr_380px]">
        <section>
          <SectionTitle action={<Link href="/projects" className="text-[13px] font-medium text-accent hover:underline">All projects</Link>}>Recent projects</SectionTitle>
          {loading && !projects ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Skeleton className="aspect-[4/3.9] rounded-2xl" />
              <Skeleton className="aspect-[4/3.9] rounded-2xl" />
            </div>
          ) : projects && !projects.projects.length ? (
            <EmptyState icon={<Plus className="size-5" />} title="Start a project" description="Projects hold briefs, brand rules, critiques, designs and assets." action={<Button variant="primary" onClick={() => setCreating(true)}>New project</Button>} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {projects?.projects.slice(0, 4).map((p) => <ProjectCard key={p.id} project={p} />)}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Latest critiques</SectionTitle>
          <Panel padded={false} className="divide-y divide-line">
            {critiques?.critiques.length ? (
              critiques.critiques.slice(0, 6).map((c) => (
                <Link key={c.id} href={`/critiques/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private files */}
                  <img src={`/api/files/${c.fileId}?thumb=96`} alt="" className="size-11 flex-none rounded-lg bg-surface-2 object-cover ring-1 ring-line" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-ink">{c.title}</div>
                    <div className="truncate text-[12px] text-muted">
                      {c.projectName} · {timeAgo(c.createdAt)}
                    </div>
                  </div>
                  {c.status === "succeeded" ? (
                    <Badge tone={scoreTone(c.overallScore)} className="tabular-nums">
                      {c.overallScore}
                    </Badge>
                  ) : (
                    <Badge tone={c.status === "failed" ? "critical" : "neutral"}>{c.status === "failed" ? "Failed" : "Running"}</Badge>
                  )}
                </Link>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted">
                No critiques yet.{" "}
                <Link href="/critique" className="font-medium text-accent hover:underline">
                  Review your first design
                </Link>
              </div>
            )}
          </Panel>
          <Link href="/brands" className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-line-strong">
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Palette className="size-5" />
            </div>
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold">Brand Library</div>
              <div className="text-[12.5px] text-muted">Colours, type and rules the agents respect</div>
            </div>
            <ArrowRight className="size-4 text-subtle" />
          </Link>
        </section>
      </div>

      <ProjectDialog open={creating} onClose={() => setCreating(false)} onSaved={(p) => router.push(`/projects/${p.id}`)} />
    </div>
  );
}

function SetupItem({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check className="mt-0.5 size-4 flex-none text-success" /> : <CircleAlert className="mt-0.5 size-4 flex-none text-major" />}
      <span>
        <span className={cx("font-medium", ok ? "text-muted line-through decoration-subtle/50" : "text-ink")}>{label}</span>
        {!ok && hint && <span className="block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </li>
  );
}
