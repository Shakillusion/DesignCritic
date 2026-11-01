"use client";

import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, cx, ErrorNote, Field, PageHeader, Panel, Segmented, Skeleton, Textarea, Toggle, timeAgo } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api, useFetch } from "@/hooks/use-api";
import type { Preferences } from "@/types/domain";
import { AiEnginePanel } from "./ai-engine-panel";

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failures: number;
  recent: { id: string; operation: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; durationMs: number; status: string; error: string | null; createdAt: string }[];
}
interface Status {
  ai: { configured: boolean; activeLabel: string | null; activeFree: boolean };
  renderer: { available: boolean; detail: string };
  assetProviders: { id: string; label: string; configured: boolean; setupHint: string | null; kinds: string[] }[];
  planned: { id: string; label: string; detail: string }[];
  researchSources: { id: string; label: string; configured: boolean; detail: string }[];
  hosted: boolean;
}

export function SettingsView() {
  const toast = useToast();
  const { data, error, reload, setData } = useFetch<{ preferences: Preferences; usage: Usage }>("/api/settings");
  const { data: status } = useFetch<Status>("/api/status");
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the form from the server
    if (data) setPrefs(data.preferences);
  }, [data]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!prefs || !data) return <Skeleton className="h-96 rounded-2xl" />;
  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setPrefs({ ...prefs, [k]: v });
  const dirty = JSON.stringify(prefs) !== JSON.stringify(data.preferences);

  // AI engine choices apply immediately, so "Test connection" always uses what's on screen.
  const saveAi = async (next: Preferences) => {
    setPrefs({ ...prefs, aiProvider: next.aiProvider, aiModels: next.aiModels, aiFallback: next.aiFallback });
    try {
      await api("/api/settings", { method: "PATCH", json: { aiProvider: next.aiProvider, aiModels: next.aiModels, aiFallback: next.aiFallback } });
      setData((d) => (d ? { ...d, preferences: { ...d.preferences, aiProvider: next.aiProvider, aiModels: next.aiModels, aiFallback: next.aiFallback } } : d));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PATCH", json: prefs });
      toast("Preferences saved");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow="Settings"
        title="Preferences & integrations"
        description="Preferences guide the agents as defaults. They are never turned into permanent design rules: brand rules live in the Brand Library, per-project direction in each brief."
        actions={
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>
            Save preferences
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <AiEnginePanel prefs={prefs} onChange={saveAi} />

          <Panel className="space-y-5">
            <h2 className="text-[15px] font-semibold">Critique & creation</h2>
            <Field label="Critique strictness">
              <Segmented value={prefs.critiqueStrictness} onChange={(v) => set("critiqueStrictness", v)} options={[{ value: "gentle", label: "Gentle" }, { value: "balanced", label: "Balanced" }, { value: "strict", label: "Strict" }]} />
            </Field>
            <Field label="Default creativity">
              <Segmented value={prefs.creativityLevel} onChange={(v) => set("creativityLevel", v)} options={[{ value: "conservative", label: "Safe" }, { value: "balanced", label: "Balanced" }, { value: "experimental", label: "Experimental" }]} />
            </Field>
            <Field label="Brand compliance" hint="Locked brand rules are always enforced; this sets how flexible rules are treated.">
              <Segmented value={prefs.brandStrictness} onChange={(v) => set("brandStrictness", v)} options={[{ value: "strict", label: "Strict" }, { value: "balanced", label: "Balanced" }, { value: "loose", label: "Loose" }]} />
            </Field>
            <Field label="Asset selection" hint="Automatic only uses assets whose licence clearly allows commercial use and modification.">
              <Segmented value={prefs.assetMode} onChange={(v) => set("assetMode", v)} options={[{ value: "automatic", label: "Automatic" }, { value: "uploaded", label: "My uploads only" }]} />
            </Field>
            <Field label="QA correction rounds" hint="How many times the builder may fix measured problems before stopping. Bounded to prevent endless loops.">
              <Segmented value={String(prefs.qaMaxIterations) as "0" | "1" | "2" | "3"} onChange={(v) => set("qaMaxIterations", Number(v))} options={[{ value: "0", label: "Off" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }]} />
            </Field>
            <Field label="Preferred styles" hint="Soft guidance passed to the Creative Director for new briefs.">
              <Textarea rows={2} value={prefs.preferredStyles} onChange={(e) => set("preferredStyles", e.target.value)} placeholder="e.g. Swiss typography, generous whitespace, natural light photography" maxLength={1000} />
            </Field>
            <Field label="Research feeds" hint="One RSS/Atom URL per line. Leave empty to use the built-in design publications (Creative Review, Dezeen, Designboom, Creative Boom, Abduzeedo).">
              <Textarea rows={3} value={prefs.researchFeeds.join("\n")} onChange={(e) => set("researchFeeds", e.target.value.split(/\s+/).map((x) => x.trim()).filter(Boolean))} placeholder="https://www.dezeen.com/design/feed/" className="font-mono text-[12px]" />
            </Field>
            <Toggle checked={prefs.requireApproval} onChange={(v) => set("requireApproval", v)} label="Ask before applying changes to approved designs" description="Agent edits always create new versions; approved versions are never overwritten." />
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <h2 className="mb-4 text-[15px] font-semibold">Integrations</h2>
            {!status ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="space-y-3">
                <StatusRow ok={status.ai.configured} label="AI engine" detail={status.ai.configured ? `${status.ai.activeLabel}${status.ai.activeFree ? " · free tier" : " · paid"}` : `Add a free GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY ${status.hosted ? "in Vercel → Environment Variables" : "to .env.local"}`} />
                <StatusRow ok={status.renderer.available} label="Renderer (headless browser)" detail={status.renderer.detail} />
                {status.assetProviders.map((p) => (
                  <StatusRow key={p.id} ok={p.configured} label={p.label} detail={p.configured ? `${p.kinds.join(", ")}` : p.setupHint ?? "Not configured"} optional />
                ))}
                {status.researchSources.map((p) => (
                  <StatusRow key={p.id} ok={p.configured} label={p.label} detail={p.detail} optional={p.id === "tavily"} />
                ))}
                {status.planned.map((p) => (
                  <StatusRow key={p.id} ok={null} label={p.label} detail={p.detail} />
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <h2 className="mb-1 text-[15px] font-semibold">AI usage</h2>
            <p className="mb-4 text-[12px] text-muted">Free-tier providers cost $0; the estimate only counts Claude if you choose it. Token counts help you watch free-tier limits.</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {[
                ["Calls", data.usage.calls.toLocaleString()],
                ["Tokens", `${((data.usage.inputTokens + data.usage.outputTokens) / 1000).toFixed(1)}k`],
                ["Est. cost", `$${data.usage.costUsd.toFixed(2)}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-surface-2 px-3 py-2.5">
                  <div className="text-[11px] text-muted">{k}</div>
                  <div className="text-[17px] font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-line text-[12px]">
              {data.usage.recent.slice(0, 10).map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{u.operation}</span>
                    <span className="block truncate text-subtle">
                      {timeAgo(u.createdAt)} · {(u.durationMs / 1000).toFixed(1)}s{u.error ? ` · ${u.error}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-1.5">
                    {u.status !== "ok" && <Badge tone="critical">{u.status}</Badge>}
                    <span className="text-muted tabular-nums">${u.costUsd.toFixed(3)}</span>
                  </span>
                </li>
              ))}
              {!data.usage.recent.length && <li className="py-3 text-subtle">No AI calls yet.</li>}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function StatusRow({ ok, label, detail, optional }: { ok: boolean | null; label: string; detail: string; optional?: boolean }) {
  return (
    <li className="flex gap-2.5">
      {ok === null ? <CircleDashed className="mt-0.5 size-4 flex-none text-subtle" /> : ok ? <Check className="mt-0.5 size-4 flex-none text-success" /> : <CircleAlert className={cx("mt-0.5 size-4 flex-none", optional ? "text-subtle" : "text-major")} />}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">
          {label}
          {ok === null && <span className="ml-1.5 text-[11px] font-normal text-subtle">planned</span>}
          {ok === false && optional && <span className="ml-1.5 text-[11px] font-normal text-subtle">optional</span>}
        </span>
        <span className="block text-[12px] break-words text-muted">{detail}</span>
      </span>
    </li>
  );
}
