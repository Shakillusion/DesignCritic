# Implementation status

Updated 2026-10-29. "Verified" means exercised by automated tests or a live check during development. "Built, not verified live" means the code exists and its non-AI parts are tested, but the AI-dependent path has not run against a real provider yet because no AI key (Gemini, Groq or OpenRouter) has been added.

## Phase 1: Functional foundation

| Feature | State |
|---|---|
| Next.js app, shell, light-first UI with optional dark mode, responsive nav | Verified (browser) |
| Projects: create, rename/edit, delete with typed confirmation, per-project data isolation | Verified (tests + browser) |
| Brand Library: colours, type, rules with Locked/Flexible/Inspirational, logos/references/guidelines, change history | Verified (tests + browser) |
| Brand rule extraction from PDF/images/text (proposals the user confirms) | Built, not verified live |
| Image upload: magic-byte detection, size limit, full decode, SVG script rejection | Verified (tests) |
| AI critique: structured schema, transparent weighted score, located findings, strengths | **Verified live** on Gemini's free tier, at $0. All visible text was read correctly, findings were located at the right regions, and the fixes were specific |
| Free AI providers: Gemini, Groq, OpenRouter (free vision models only), optional paid Claude; per-provider model choice; free-only fallback; connection test | **Verified live**: Gemini, Groq (qwen3.8-27b, 0.6 s) and OpenRouter (nemotron VL, 8 s) all passed a real image test. On Gemini, "Auto" skips overloaded or no-quota models (health tracking plus a 90 s per-model cap) |
| Critique workspace: annotated canvas, zoom, filters, accept/reject, scores, technical facts | Verified (browser, with a fixture result) |
| Improvement plan from accepted findings | **Verified live** (Gemini, 8 s) |
| Report export: HTML (standalone, annotated), Markdown, JSON | Verified (tests + live) |
| Background jobs with step progress; orphaned jobs marked failed on restart | Verified (tests) |
| AI usage and cost log (Settings) | Verified (tests) |
| Authentication | Single local user by design. All queries are scoped by user ID; Supabase Auth plus the RLS schema in `supabase/migrations` are planned for deployment |

## Phase 2 / asset demo (pulled forward)

| Feature | State |
|---|---|
| Design document schema + normaliser | Verified (tests) |
| HTML renderer, headless render via system Edge/Chrome (PNG, @2x, JPG, PDF, HTML export) | Verified (tests run a real browser) |
| QA Inspector: overflow, clipping, safe margin, WCAG contrast over the actual pixels, low resolution / effective DPI, missing assets, font fallback, brand colour and font checks | Verified (tests) |
| Design Studio: select, drag, resize, layer list, properties, undo/redo, versions, compare slider, restore, approve | Built, partly verified. Saving, versioning, restore and locked-layer protection are tested end-to-end; the editor UI has not been clicked through with a generated design yet |
| Asset providers: Wikimedia Commons, Openverse, Iconify (no key), Unsplash, Pexels (key) | Wikimedia verified live; Iconify verified live by the provider tests; Openverse's API was timing out on their side during development; Unsplash and Pexels are mapped and unit-tested but untested live (no keys) |
| Licence policy: auto-use only clear commercial and modification rights; share-alike and unknown licences need review; NC/ND blocked | Verified (tests + live: CC BY / CC0 / PDM accepted, CC BY-SA flagged) |
| SSRF-safe server-side download, original kept, prepared copy, attribution stored | Verified live (a CC BY 3.0 Wikimedia photo was downloaded and stored) |
| Asset Agent: AI vision ranking of candidates for layout fit; query broadening; skips failing providers; Wikimedia standard-size renditions | **Verified live**: 6 licensed candidates were compared and a CC BY 2.0 photo was downloaded as a 3840 px rendition |
| Create pipeline (brief → asset → build → render → QA correction loop → critique) | **Verified live: the Switzerland poster demo ran end to end in about 2.5 minutes on free services.** It produced a real downloaded photo, 9 editable layers, the required CC BY credit line, a passed QA check (1 contrast warning) and a critique score of 78/100 |

## Phase 3: Improve (built 2026-10-29)

| Feature | State |
|---|---|
| Edit-operation engine: targeted layer edits (update/add/remove/reorder) traced to findings; locked layers, unknown layers, wrong-type fields and outside assets refused | Verified (tests) |
| Apply fixes: Design Fixer plans edits, each edit is rendered and QA-measured on its own (edits that add an error are dropped), one correction round, saved as a new version, then re-critiqued | **Verified live** on the Switzerland poster: 78 → 91 with zero QA errors. The gate dropped two harmful edits (a CTA contrast of 1.31:1 and a 12 px clip), and the correction round fixed both |
| Review flow: versions wait for approval (Settings → ask before applying), before/after slider, per-change list with reasons, score change, "make current"; regressions are flagged | Verified (browser) |
| Rebuild uploads as editable designs: layout read by the AI, photo regions cut from your file (baked-in text softened), font matching, measured auto-fit of text, compare with the original | **Verified live** on the farmers-market poster: 5 editable layers in 40 s, faithful to the original |
| Quick adjust for flattened images (crop, brightness, contrast, saturation, resize) saved as a new image | **Verified live**: a 4:5 crop at 800 px gave 800×1000 with the original untouched |
| Creative assistant (Design Studio "Assistant" tab, critique "Ask" tab): project-, brand-, design- and critique-aware; whitelisted actions (edit, critique, apply fixes, variations), each producing reviewable versions | **Verified live**: "make the headline stronger" became a precise edit, v4 scored 78 → 86, and the gate dropped one harmful scrim. The action whitelist is tested |
| Improve hub: designs with pending reviews and one-click apply; uploads with rebuild / quick adjust | Verified (browser) |

## Phase 4: Research and art direction (built 2026-10-29)

| Feature | State |
|---|---|
| Sources (all free): design-publication feeds (Creative Review, Dezeen, Designboom, Creative Boom, Abduzeedo), The Met (v1.1 search, graphic objects only), Wikimedia Commons, pasted links (only that page's meta tags are read), optional Tavily web search | **Verified live**: 24 articles and 11 visual references per run. Tavily is built but untested (no key). Behance, Dribbble and Pinterest have no public search API and are not scraped; paste their links instead |
| Research Agent trend brief: emerging / established / cliché insights citing retrieved items only; server strips unknown citations; evidence-free claims are labelled "general knowledge"; honest "limits of this research" | **Verified live** (3 cited insights across all three categories; 0 uncited) and tested |
| Saved references with local preview, palette, source, creator, date and rights note ("reference only") | **Verified live** (6 saved, plus pasted links from Abduzeedo, Creative Boom and Dezeen) |
| Moodboards: drag to reorder, item sizes and notes, board notes, combined palette, autosave | Verified (browser plus tests) |
| Original art directions from a moodboard: distinct concepts, available fonts only, palettes, clichés to avoid, "inspired by" principles validated against real references | **Verified live**: three distinct directions |
| Use in Create: brief, style and style references prefilled from a direction | Verified (browser) |
| Assistant uses the latest research and may cite only its URLs | Built; not separately exercised live |
| Settings: editable feed list; research-source status | Built |

## Not built yet

- **Phase 5:**
  - Figma import/export
  - Image generation
  - CMYK/ICC print verification. PDF exports are screen RGB and are labelled as such.
  - Background removal
  - SVG export of whole designs
- **Deployment:** Supabase adapter (Postgres schema written), Supabase Storage, auth.

## Known limitations

- In-process jobs only survive while the dev server runs. Jobs interrupted by a restart are marked failed.
- Wikimedia strictly rate-limits original-file downloads and non-standard thumbnail sizes (since early 2026). The agent downloads standard-width renditions (960/1280/1920/3840 px), with backoff retries. Setting `DESIGNCRITIC_CONTACT` to a real email or URL is recommended by Wikimedia's user-agent policy.
- Free AI tiers are shared: at peak times the newest Gemini model can hang or return 503. "Auto" moves on to the next model, which can add 1–3 minutes. Pin a specific model in Settings if you prefer predictable behaviour.
- Free photo sources without keys (Wikimedia, Openverse) have a limited pool of commercially reusable photos, and Openverse's API was timing out during development. Adding free Unsplash or Pexels keys greatly widens the choice.
- The Unsplash API guidelines ask apps to hotlink images in-app. DesignCritic downloads a copy because export and rendering need the file. Review this before commercial deployment.
- Locked layers must be unlocked and saved before they can be deleted.
