"use client";

import { Check, ExternalLink, KeyRound, Zap } from "lucide-react";
import { useState } from "react";
import { Badge, Button, cx, Panel, Select, Toggle } from "@/components/ui";
import { api, useFetch } from "@/hooks/use-api";
import type { Preferences } from "@/types/domain";

type ProviderId = Preferences["aiProvider"];

interface ProviderStatus {
  id: ProviderId;
  label: string;
  free: boolean;
  configured: boolean;
  keyEnv: string;
  signupUrl: string;
  maxImages: number;
  supportsPdf: boolean;
}

const BLURB: Record<ProviderId, string> = {
  gemini: "Strongest free option for design critique: reads images and PDFs, follows JSON schemas. Free-tier limits apply; on the free tier Google may use prompts to improve its products.",
  groq: "Very fast free tier. Up to 3 images per request and no PDF reading, so asset comparison uses 3 candidates.",
  openrouter: "One key, many free vision models chosen live from OpenRouter's catalogue. Free models allow 50 requests per day (1,000 after a one-time $10 credit purchase).",
  anthropic: "Paid. Highest-quality critiques. Only used if you select it and add a key.",
};

export function AiEnginePanel({ prefs, onChange }: { prefs: Preferences; onChange: (p: Preferences) => void }) {
  const { data: status } = useFetch<{ ai: { providers: ProviderStatus[] }; hosted: boolean }>("/api/status");
  const providers = status?.ai.providers ?? [];

  return (
    <Panel className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold">AI engine</h2>
        <p className="mt-1 text-[13px] text-muted">Every agent uses the provider you choose. Gemini, Groq and OpenRouter all have free tiers that need only a free key, no card.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            hosted={status?.hosted ?? false}
            selected={prefs.aiProvider === p.id}
            model={prefs.aiModels[p.id]}
            onSelect={() => onChange({ ...prefs, aiProvider: p.id })}
            onModel={(m) => onChange({ ...prefs, aiModels: { ...prefs.aiModels, [p.id]: m } })}
          />
        ))}
      </div>
      <Toggle
        checked={prefs.aiFallback}
        onChange={(v) => onChange({ ...prefs, aiFallback: v })}
        label="Fall back to other free providers"
        description="If the selected provider is rate-limited or down, try the other configured free providers in turn. A paid provider is never used as a fallback."
      />
    </Panel>
  );
}

function ProviderCard({ p, hosted, selected, model, onSelect, onModel }: { p: ProviderStatus; hosted: boolean; selected: boolean; model: string; onSelect: () => void; onModel: (m: string) => void }) {
  const { data } = useFetch<{ models: { id: string; label: string; vision: boolean }[]; auto: string | null }>(selected || p.configured ? `/api/ai/models?provider=${p.id}` : null);
  const [test, setTest] = useState<{ running: boolean; ok?: boolean; text?: string }>({ running: false });

  const runTest = async () => {
    setTest({ running: true });
    try {
      const r = await api<{ ok: boolean; model?: string; ms?: number; error?: string }>("/api/ai/test", { method: "POST", json: { provider: p.id } });
      setTest({ running: false, ok: r.ok, text: r.ok ? `Working · ${r.model} · ${((r.ms ?? 0) / 1000).toFixed(1)}s` : r.error });
    } catch (e) {
      setTest({ running: false, ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className={cx("rounded-xl border p-4 transition-colors", selected ? "border-accent bg-accent-soft/30" : "border-line")}>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="radio" name="ai-provider" checked={selected} onChange={onSelect} className="mt-1 accent-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14px] font-semibold">{p.label}</span>
            {p.free ? <Badge tone="success">Free</Badge> : <Badge tone="major">Paid</Badge>}
            {p.configured ? (
              <Badge tone="accent" icon={<Check className="size-3" />}>
                Key set
              </Badge>
            ) : (
              <Badge icon={<KeyRound className="size-3" />}>No key</Badge>
            )}
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{BLURB[p.id]}</span>
        </span>
      </label>
      <div className="mt-3 space-y-2 pl-7">
        {p.configured ? (
          <>
            <Select value={model || "auto"} onChange={(e) => onModel(e.target.value)} className="h-8 text-[12.5px]" aria-label={`${p.label} model`}>
              {p.id !== "anthropic" && <option value="auto">Auto{data?.auto ? ` — ${data.auto}` : ""}</option>}
              {data?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {p.id === "groq" && !m.vision ? " (text only)" : ""}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Zap className="size-3.5" />} loading={test.running} onClick={runTest}>
                Test connection
              </Button>
              {test.text && <span className={cx("min-w-0 text-[12px] break-words", test.ok ? "text-success" : "text-critical")}>{test.text}</span>}
            </div>
          </>
        ) : (
          <p className="text-[12px] text-muted">
            {hosted ? (
              <>
                Add <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">{p.keyEnv}</code> in Vercel → Settings → Environment Variables, then redeploy.{" "}
              </>
            ) : (
              <>
                Add <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">{p.keyEnv}</code> to <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">.env.local</code> and restart.{" "}
              </>
            )}
            <a href={p.signupUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline">
              Get a {p.free ? "free " : ""}key <ExternalLink className="size-3" />
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
