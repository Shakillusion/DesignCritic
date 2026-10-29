"use client";

import { FolderKanban, Images, LayoutGrid, Menu, Moon, PenTool, ScanSearch, Settings, Sun, Telescope, Wand2, X, Palette } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { useFetch } from "@/hooks/use-api";

interface Status {
  ai: { configured: boolean; activeLabel: string | null; activeFree: boolean };
}

const NAV: { group: string; items: { href: string; label: string; icon: typeof LayoutGrid; soon?: boolean }[] }[] = [
  {
    group: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutGrid },
      { href: "/projects", label: "Projects", icon: FolderKanban },
    ],
  },
  {
    group: "Modes",
    items: [
      { href: "/create", label: "Create", icon: PenTool },
      { href: "/critique", label: "Critique", icon: ScanSearch },
      { href: "/improve", label: "Improve", icon: Wand2 },
      { href: "/research", label: "Research", icon: Telescope },
    ],
  },
  {
    group: "Library",
    items: [
      { href: "/brands", label: "Brand Library", icon: Palette },
      { href: "/assets", label: "Assets", icon: Images },
    ],
  },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      {/* crop marks around a focal point: the critic's eye */}
      <path d="M9 13V9h4M23 13V9h-4M9 19v4h4M23 19v4h-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16" cy="16" r="2.6" fill="white" />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the attribute set before hydration
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("dc-theme", next);
    } catch {
      /* storage unavailable: theme lasts for this page only */
    }
  };
  return { theme, toggle };
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data: status } = useFetch<Status>("/api/status");
  const { theme, toggle } = useTheme();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/") || (href === "/critique" && pathname.startsWith("/critiques")) || (href === "/create" && pathname.startsWith("/designs")));

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <Logo className="size-8" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-ink">DesignCritic</div>
          <div className="text-[11px] font-medium text-subtle">AI creative director</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">{g.group}</div>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cx(
                        "group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] font-medium transition-colors",
                        active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      <item.icon className={cx("size-[17px]", active ? "text-accent" : "text-subtle group-hover:text-ink-2")} strokeWidth={1.9} />
                      <span className="flex-1">{item.label}</span>
                      {item.soon && <span className="rounded px-1.5 py-px text-[10px] font-semibold text-subtle ring-1 ring-line">Soon</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="block rounded-xl border border-line bg-surface p-3 shadow-sm transition-colors hover:border-line-strong"
        >
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <span className={cx("size-2 rounded-full", !status ? "bg-surface-3" : status.ai.configured ? "bg-success" : "bg-major")} />
            {!status ? "Checking setup…" : status.ai.configured ? status.ai.activeLabel : "No AI key yet"}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted">{status && !status.ai.configured ? "Add a free Gemini, Groq or OpenRouter key" : status?.ai.activeFree ? "AI engine · free tier" : "AI engine · paid"}</div>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            onClick={onNavigate}
            className={cx(
              "flex h-9 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] font-medium transition-colors",
              pathname.startsWith("/settings") ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Settings className="size-[17px] text-subtle" strokeWidth={1.9} /> Settings
          </Link>
          <button onClick={toggle} aria-label="Toggle dark mode" title="Toggle dark mode" className="flex size-9 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-ink">
            {theme === "dark" ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Full-bleed workspaces manage their own padding.
  const fullBleed = /^\/(critiques|designs)\//.test(pathname);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[248px] flex-none border-r border-line bg-bg lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold">DesignCritic</span>
        </Link>
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="flex size-9 items-center justify-center rounded-lg hover:bg-surface-2">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-[272px] border-r border-line bg-bg shadow-lg">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute top-4 right-3 flex size-8 items-center justify-center rounded-lg hover:bg-surface-2">
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className={cx("min-w-0 flex-1 pt-14 lg:pt-0", !fullBleed && "px-4 py-8 sm:px-8 lg:px-12 lg:py-10")}>
        {fullBleed ? children : <div className="mx-auto max-w-[1240px]">{children}</div>}
      </main>
    </div>
  );
}
