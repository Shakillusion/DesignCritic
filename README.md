# DesignCritic AI

An AI creative director that **critiques** existing designs, **creates** editable layouts from a rough brief, sources **licensed photography** automatically, and helps **improve** work through ranked correction plans. It runs locally and works entirely on **free** services; deployment comes later.

> Status: Phase 1 (critique foundation) plus the asset-integration demo pipeline. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for exactly what works, what's verified and what's planned.

## Quick start

Requirements: Node.js 24+ (uses the built-in `node:sqlite`), and Microsoft Edge or Google Chrome installed (used headlessly to render designs).

```bash
cd designcritic-ai
npm install
```

Add at least one **free** AI key to `.env.local` (already created from `.env.example`), then choose the provider in **Settings → AI engine**:

| Provider | Key | Get one (free, no card) | Notes |
|---|---|---|---|
| Google Gemini (recommended) | `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Reads images and PDFs, follows JSON schemas. Free-tier limits apply. On the free tier Google may use prompts to improve its products. |
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys | Very fast. Max 3 images per request, no PDFs. |
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/settings/keys | Uses only free vision models, picked live. Limits: 20 requests/min and 50/day (1,000/day after a one-time $10 credit). |
| Claude (optional, **paid**) | `ANTHROPIC_API_KEY` | https://platform.claude.com | Only used if you select it. Never used as a fallback. |

With *Fall back to other free providers* on (the default), a rate-limited provider hands the request to your other configured free providers. Use **Test connection** in Settings to check a key.

Other optional free keys:

```bash
UNSPLASH_ACCESS_KEY=                  # optional, free
PEXELS_API_KEY=                       # optional, free
DESIGNCRITIC_CONTACT=you@example.com  # recommended: sent in the User-Agent to Wikimedia/Openverse
```

```bash
npm run dev
```

Open http://localhost:3000. Data lives in `designcritic-ai/data/` (SQLite database + stored files), which is git-ignored.

## Using it

1. **Create a project** (Projects → New project). Optionally attach a brand.
2. **Brand Library**: add colours, typography and rules, each marked *Locked*, *Flexible* or *Inspirational*. Or upload guideline PDFs/images (or paste text) and let the Brand Guardian propose rules for you to confirm.
3. **Critique**: upload a design, add context (purpose, audience, medium, intent), run. You get a weighted score, category scores, located findings with severity, confidence and a concrete fix, plus strengths to keep. Accept or reject findings, build an improvement plan, and export the report as HTML, Markdown or JSON.
4. **Create**: describe the piece, pick a format, choose *Find licensed photos for me* or *Use my own images*, optionally add style references. The pipeline:
   - Creative Director writes the brief and concepts.
   - Asset Agent searches the providers, filters by licence, has Claude compare the candidates for layout fit, then downloads and prepares the chosen photo.
   - Design Builder writes editable layers.
   - The renderer and QA Inspector measure overflow, contrast, resolution and safe margins, with up to 2 bounded correction rounds.
   - The Senior Critic scores the result.
5. **Design Studio**: move and resize layers, edit text and type, adjust image focal point, brightness and contrast, and edit fills and gradients. Undo and redo with Ctrl+Z / Ctrl+Shift+Z. Each save creates a new version that is re-rendered and QA-checked. You can compare versions with a before/after slider, restore an old one, or approve one. Export as PNG (1×/2×), JPG, PDF or HTML.
6. **Assets**: every downloaded or uploaded image, with source, creator, licence terms, attribution and usage count. You can approve, reject, lock, remove (only when unused and unlocked), search providers and import results.

7. **Improve**: from any design critique, **Apply fixes**. The agents make targeted edits, render and measure each one (dropping any that make things worse), then save a new version for you to review with a before/after view. For an uploaded image, **Rebuild as editable design** or **Quick adjust**.
8. **Assistant**: the *Assistant* tab in the Design Studio (and *Ask* on critiques) understands the project, brand, design and critique. Requests like "make the headline stronger" or "give me 2 experimental variations" run as checked actions that create reviewable versions.

9. **Research**: enter a topic to get a cited trend brief from real design-publication feeds and open collections (The Met, Wikimedia Commons), plus links you paste. Save references to moodboards, then have the Creative Director propose original art directions and send one to **Create**. References are never placed in artwork.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest: unit, API-route and real-renderer integration tests |

## Architecture (short)

- **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4.** UI components are client components that call JSON route handlers under `src/app/api`.
- **Agents** (`src/agents/*`):
  - Creative Director, Senior Design Critic, Brand Guardian, Asset Agent, Design Builder, QA Inspector, Export.
  - Every AI call goes through `src/lib/ai/client.ts`. It is provider-neutral, with modules in `src/lib/ai/providers/` for Gemini, Groq, OpenRouter and optional Claude.
  - It requests JSON matching a Zod schema, validates the answer, and retries once with the validation errors.
  - It falls back across free providers, maps errors to typed codes, and logs usage per call.
- **Design document** (`src/lib/design-engine/schema.ts`):
  - A validated JSON format: artboard, ordered text/image/shape layers and print metadata.
  - `render-html.ts` turns it into the same HTML used both by the live editor (sandboxed iframe) and by headless export (Playwright + system Edge/Chrome).
- **Persistence:** SQLite via `node:sqlite` behind `src/lib/database/repo.ts`. Every query is scoped by user ID.
  - `supabase/migrations/0001_init.sql` is the Postgres + RLS equivalent for deployment. It is written but not yet connected.
- **Long operations** run as in-process background jobs (`src/lib/jobs.ts`) that the UI polls.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security notes

- **Uploads:** checked by magic bytes, size-limited, fully decoded before they are accepted. SVGs containing scripts or event handlers are rejected.
- **Serving files:** files are served with `nosniff` and a sandboxing CSP.
- **External fetches:** every external fetch goes through `src/lib/net/safe-fetch.ts`. It blocks private and loopback networks at DNS-lookup time (which defends against DNS rebinding), re-validates every redirect, and enforces timeouts and byte limits.
- **Untrusted input:** uploaded artwork, guidelines and web content are treated as data. Each agent's system prompt tells Claude to ignore instructions embedded in them.
- **Destructive actions:** deleting a project or brand requires typing its name. Locked layers can't be changed through the editor (enforced on the server). Assets in use can't be deleted.
- **Secrets:** keys are read only on the server and are never sent to the browser.
