import "server-only";
import { z } from "zod";
import { imageBlock, structuredCall, UNTRUSTED_CONTENT_RULE, type UserContent } from "@/lib/ai/client";
import { brandRulesText } from "@/agents/brand-guardian";
import type { Brand } from "@/types/domain";

/**
 * Creative Director: turns a rough request into a structured creative brief,
 * names the assumptions it had to make, and proposes genuinely different
 * concepts (layout, idea and art direction — not colour swaps).
 */

export const CreativeBrief = z.object({
  title: z.string().describe("Short working title for the piece"),
  objective: z.string(),
  audience: z.string(),
  keyMessage: z.string().describe("The one thing the viewer must take away"),
  tone: z.string(),
  copy: z.object({
    headline: z.string().describe("Final headline text. Use the user's copy verbatim when given; otherwise write it, short and specific"),
    subheadline: z.string().nullable(),
    body: z.string().nullable(),
    cta: z.string().nullable(),
    extras: z.array(z.string()).describe("Small supporting lines like a URL, date, or location. No invented facts (prices, dates, addresses) the user didn't give"),
  }),
  assumptions: z.array(z.string()).describe("Decisions you made because the brief didn't say"),
  missingConstraints: z.array(z.string()).describe("Information that would materially improve the result"),
  concepts: z.array(
    z.object({
      name: z.string(),
      idea: z.string().describe("The creative idea in one or two sentences"),
      composition: z.string().describe("Concrete layout: where the image, headline and supporting text sit, scale relationships, grid"),
      typography: z.string().describe("Typeface direction from the allowed list, weights, case, scale contrast"),
      color: z.string(),
      imageDirection: z.string().describe("What the photo should show, framing, light, mood"),
      imageQuery: z.string().describe("A concrete stock-photo search query in English, 2–6 words, describing visible content (not mood words alone)"),
      imageOrientation: z.enum(["landscape", "portrait", "square"]),
      textZone: z.enum(["top", "bottom", "left", "right", "center", "none"]).describe("Where type sits over/next to the image"),
    }),
  ),
});
export type CreativeBrief = z.infer<typeof CreativeBrief>;

export interface BriefInput {
  brief: string;
  headline?: string;
  supportingCopy?: string;
  cta?: string;
  audience?: string;
  style?: string;
  creativeFreedom: "conservative" | "balanced" | "experimental";
  variations: number;
  format: { label: string; width: number; height: number; kind: string };
  useImagery: boolean;
}

const FREEDOM = {
  conservative: "Creative freedom: CONSERVATIVE — clear, proven layouts; restraint over novelty.",
  balanced: "Creative freedom: BALANCED — professional with one distinctive idea per concept.",
  experimental: "Creative freedom: EXPERIMENTAL — push composition and typography (scale contrast, cropping, unusual alignment) while keeping the message legible.",
};

export async function interpretBrief(opts: { userId: string; input: BriefInput; brand: Brand | null; references?: { base64: string; mediaType: "image/png" | "image/jpeg" }[]; preferredStyles?: string }): Promise<CreativeBrief> {
  const i = opts.input;
  const content: UserContent = [];
  for (const r of opts.references ?? []) content.push(imageBlock(r.base64, r.mediaType));
  content.push({
    type: "text",
    text: `${opts.references?.length ? "The image(s) above are style references from the user: extract principles (composition, type treatment, mood), never copy them.\n\n" : ""}User request (data):
<brief>
${i.brief}
</brief>
${i.headline ? `Headline (use verbatim): ${i.headline}\n` : ""}${i.supportingCopy ? `Supporting copy (use verbatim): ${i.supportingCopy}\n` : ""}${i.cta ? `Call to action (use verbatim): ${i.cta}\n` : ""}${i.audience ? `Audience: ${i.audience}\n` : ""}${i.style ? `Visual style wanted: ${i.style}\n` : ""}${opts.preferredStyles ? `The user's general style preferences (soft guidance for this project only): ${opts.preferredStyles}\n` : ""}
Format: ${i.format.label} — ${i.format.width}×${i.format.height}px (${i.format.kind}).
${FREEDOM[i.creativeFreedom]}
Imagery: ${i.useImagery ? "each concept is built around one photograph that will be sourced from licensed stock libraries" : "the user supplied their own photo; plan concepts around it"}.

Brand:
${brandRulesText(opts.brand)}

Write the creative brief with exactly ${i.variations} concept(s). When more than one, they must differ in layout structure and idea (e.g. full-bleed image with overlaid type vs. split layout vs. typographic-led), not just colour.`,
  });
  const brief = await structuredCall({
    operation: "director.brief",
    userId: opts.userId,
    effort: "medium",
    maxTokens: 16000,
    system: `You are the Creative Director of a top independent studio. You interpret briefs like a professional: identify the objective, audience and single key message; make sensible assumptions explicit; and propose ideas that are specific to this subject, not generic templates. Never equate visual complexity with quality. Never invent factual claims (prices, dates, statistics, addresses) — leave them out unless the user supplied them. Respect brand rules exactly as provided and never invent missing brand specifications.
${UNTRUSTED_CONTENT_RULE}`,
    content,
    schema: CreativeBrief,
  });
  return { ...brief, concepts: brief.concepts.slice(0, i.variations) };
}
