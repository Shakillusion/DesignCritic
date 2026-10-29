import "server-only";
import { imageBlock, structuredCall, UNTRUSTED_CONTENT_RULE, type UserContent } from "@/lib/ai/client";
import { ALLOWED_FONTS } from "@/lib/design-engine/schema";
import type { ResearchItem } from "@/lib/integrations/research/types";
import { ArtDirections, TrendBrief, validateBrief, validateDirections, type ArtDirection } from "./schema";

/**
 * Visual Research Agent: interprets ONLY the items the app retrieved. It can
 * classify, synthesise and recommend, but every claim must cite item ids; the
 * server strips anything that doesn't point at a retrieved item.
 */

const itemLine = (i: ResearchItem) =>
  `[${i.id}] ${i.kind} · ${i.source}${i.publishedAt ? ` · ${i.publishedAt.slice(0, 10)}` : ""} · “${i.title}”${i.creator ? ` by ${i.creator}` : ""}${i.summary ? ` — ${i.summary.slice(0, 260)}` : ""}`;

export async function analyzeResearch(opts: {
  userId: string;
  query: { topic: string; industry: string; direction: string };
  items: ResearchItem[];
  thumbnails: { id: string; base64: string; mediaType: "image/png" | "image/jpeg" }[];
}): Promise<TrendBrief> {
  const content: UserContent = [];
  for (const t of opts.thumbnails) {
    content.push({ type: "text", text: `Image for item [${t.id}]:` });
    content.push(imageBlock(t.base64, t.mediaType));
  }
  content.push({
    type: "text",
    text: `Research request (data):
<request>
Topic: ${opts.query.topic}
Industry: ${opts.query.industry || "not specified"}
Visual direction wanted: ${opts.query.direction || "open"}
</request>

Retrieved items (the ONLY evidence you may cite):
${opts.items.map(itemLine).join("\n")}

Today is ${new Date().toISOString().slice(0, 10)}. Write the trend brief for this project.`,
  });
  const raw = await structuredCall({
    operation: "research.brief",
    userId: opts.userId,
    effort: "medium",
    system: `You are the Visual Research Agent of a design studio. You turn retrieved evidence into a useful, honest trend brief.
- Use only the numbered items provided. Cite item ids for every insight. Never invent sources, studios, campaigns, dates or statistics.
- Many items will be unrelated to the topic (general design news). Ignore them rather than forcing a connection; say what was missing under "gaps".
- Classify each insight: emerging (new or rising, visible in recent items), established (durable, proven), cliche (overused — say how to avoid or subvert it).
- Extract principles (composition, typography, colour, image treatment) that an original design could use. Never suggest copying a specific work.
- Aim for 4–7 insights when the evidence supports them. Use the visual references (v…) too: historic precedents usually inform "established" or "cliche" insights; describe what you actually see in the provided images.
- Recommend the 4–8 items most worth saving to a moodboard, visuals included.
${UNTRUSTED_CONTENT_RULE}`,
    content,
    schema: TrendBrief,
  });
  return validateBrief(raw, new Set(opts.items.map((i) => i.id)));
}

export async function proposeDirections(opts: {
  userId: string;
  brief: string;
  boardNotes: string;
  refs: { id: string; title: string; source: string; note: string; palette: string[]; image: { base64: string; mediaType: "image/png" | "image/jpeg" } | null }[];
  brandRules: string;
  count: number;
}): Promise<ArtDirection[]> {
  const content: UserContent = [];
  for (const r of opts.refs) {
    content.push({ type: "text", text: `Reference [${r.id}] “${r.title}” (${r.source})${r.note ? ` — note from the user: ${r.note}` : ""}${r.palette.length ? ` — palette ${r.palette.join(" ")}` : ""}` });
    if (r.image) content.push(imageBlock(r.image.base64, r.image.mediaType));
  }
  content.push({
    type: "text",
    text: `Project brief (data): ${opts.brief || "not specified"}
Moodboard notes (data): ${opts.boardNotes || "none"}
Brand:
${opts.brandRules}

Propose exactly ${opts.count} distinct, original art directions for this project.`,
  });
  const out = await structuredCall({
    operation: "research.directions",
    userId: opts.userId,
    effort: "high",
    system: `You are the Creative Director. From a moodboard, derive original art directions.
- Each direction must be genuinely different (concept, composition, type, colour, imagery) — not colour swaps.
- Take PRINCIPLES from references (e.g. "oversized cropped numerals as structure"), never their content, layouts or artwork. List which reference inspired which principle using its id.
- Typography must use these available families: ${Object.keys(ALLOWED_FONTS).join(", ")}.
- Respect brand rules exactly as given; don't invent brand specs.
- Name clichés to avoid for each direction.
${UNTRUSTED_CONTENT_RULE}`,
    content,
    schema: ArtDirections,
  });
  return validateDirections(out.directions.slice(0, opts.count), new Set(opts.refs.map((r) => r.id)));
}
