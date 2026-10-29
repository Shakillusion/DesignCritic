# Architecture

```
Browser (React client components)
  │  fetch JSON, poll /api/jobs/:id
  ▼
Route handlers  src/app/api/**        validation (Zod) · requireUser() · error mapping (lib/http.ts)
  ▼
Services        src/lib/services/*    critique.ts · design.ts — orchestrate agents inside background jobs
  ▼
Agents          src/agents/*
  creative-director   brief → structured CreativeBrief + distinct concepts
  design-critic       image → CritiqueResult (scored, located findings) · improvement plans
  brand-guardian      brand → prompt rules · strictness mapping · guideline extraction
  asset-agent         search → licence gate → Claude vision ranking → safe download → prepared copy
  design-builder      concept + asset → DesignDocument · QA-driven revisions (locked layers restored)
  qa-inspector        rendered page → objective QaReport (overflow, contrast, resolution, …)
  export              critique reports (HTML/MD/JSON); design exports live in services/design.ts
  ▼
Platform        src/lib/*
  ai/client.ts            the only Claude entry point (structured output, fallback, usage log)
  database/{db,repo}.ts   node:sqlite; user-scoped queries; seam for a Supabase adapter
  storage/storage.ts      immutable files under data/storage, path-confined
  design-engine/*         schema, HTML renderer, Playwright renderer (system Edge/Chrome)
  integrations/assets/*   Wikimedia, Openverse, Iconify, Unsplash, Pexels + licence policy
  net/safe-fetch.ts       SSRF-safe HTTP client used for every external request
  image-processing/*      sniffing, validation, facts, vision prep, colour profile
```

## Key decisions

- **One rendering path.** The editor's iframe, the QA inspection and the exports all use `renderDesignHtml`. What you edit is what is measured and what exports.
- **Objective vs subjective.** The QA Inspector measures, and the Critic judges. Critique findings are labelled objective, contextual or subjective, and QA results are passed to the critic as facts.
- **Bounded loops.** The correction loop runs at most `qaMaxIterations` rounds (default 2, configurable 0–3). It never accepts a revision with more errors than the current best.
- **Non-destructive by default.** Originals are never overwritten. Every edit, restore or agent revision is a new version. Locked layers are enforced on the server.
- **Honest integrations.** A missing key produces a setup message, never fake output. Planned features are labelled as planned.

## Data model

See `src/lib/database/migrations.ts` (SQLite) and `supabase/migrations/0001_init.sql` (Postgres + RLS). Main tables:
- `projects`, `brands` (with `brand_changes`), `files`
- `assets` (licence, attribution, provider IDs, analysis) and `asset_usages`
- `designs` and `design_versions` (document JSON, render, QA)
- `critiques` (context, technical facts, result, decisions, plan)
- `jobs`, `ai_usage`, `settings`
