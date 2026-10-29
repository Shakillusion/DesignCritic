import "server-only";
import { z } from "zod";
import type { Brand, RuleLock } from "@/types/domain";
import { structuredCall, UNTRUSTED_CONTENT_RULE, type UserContent } from "@/lib/ai/client";

/**
 * Brand Guardian: turns a brand profile into rules the other agents follow,
 * and extracts proposed rules from guideline documents (always for user
 * confirmation — nothing extracted is applied automatically).
 */

const LOCK_TEXT = {
  locked: "LOCKED — must be followed exactly; never alter",
  flexible: "FLEXIBLE — may deviate only with an explicit justification",
  inspirational: "INSPIRATIONAL — reference direction only",
} as const;

/**
 * Apply the user's brand-compliance preference to flexible rules only.
 * Locked rules always stay locked; inspirational rules stay inspirational.
 */
export function withBrandStrictness(brand: Brand | null, strictness: "strict" | "balanced" | "loose"): Brand | null {
  if (!brand || strictness === "balanced") return brand;
  const map = (l: RuleLock): RuleLock => (l !== "flexible" ? l : strictness === "strict" ? "locked" : "inspirational");
  return {
    ...brand,
    colors: brand.colors.map((c) => ({ ...c, lock: map(c.lock) })),
    typography: brand.typography.map((t) => ({ ...t, lock: map(t.lock) })),
    restrictions: brand.restrictions.map((r) => ({ ...r, lock: map(r.lock) })),
  };
}

/** Brand rules as a prompt section. Only states what the profile actually contains. */
export function brandRulesText(brand: Brand | null): string {
  if (!brand) return "No brand profile is attached. Do not assume or invent brand rules; score brand alignment as null.";
  const lines: string[] = [`Brand profile: ${brand.name}`];
  const add = (label: string, v: string) => v.trim() && lines.push(`${label}: ${v.trim()}`);
  add("Description", brand.description);
  add("Industry", brand.industry);
  add("Target audience", brand.audience);
  add("Personality / tone", brand.personality);
  add("Photography style", brand.photographyStyle);
  add("Graphic elements", brand.graphicElements);
  if (brand.colors.length) {
    lines.push("Colours:");
    for (const c of brand.colors) lines.push(`- ${c.name} ${c.hex} (${c.role || "unspecified role"}) — ${LOCK_TEXT[c.lock]}`);
  }
  if (brand.typography.length) {
    lines.push("Typography:");
    for (const f of brand.typography) lines.push(`- ${f.role}: ${f.family}${f.weights ? ` (${f.weights})` : ""}${f.notes ? ` — ${f.notes}` : ""} — ${LOCK_TEXT[f.lock]}`);
  }
  if (brand.restrictions.length) {
    lines.push("Rules and restrictions:");
    for (const r of brand.restrictions) lines.push(`- ${r.text} — ${LOCK_TEXT[r.lock]}`);
  }
  if (brand.logoFileIds.length) lines.push("Logo assets exist and are protected: never redraw, recolour, distort or crop a logo.");
  lines.push("Anything not listed here is unspecified: do not invent it.");
  return lines.join("\n");
}

export function brandForQa(brand: Brand | null) {
  if (!brand) return null;
  return {
    colors: brand.colors.map((c) => ({ hex: c.hex, lock: c.lock })),
    fonts: brand.typography.map((f) => ({ family: f.family, lock: f.lock })),
  };
}

export const ExtractedBrand = z.object({
  description: z.string().nullable(),
  industry: z.string().nullable(),
  audience: z.string().nullable(),
  personality: z.string().nullable(),
  photographyStyle: z.string().nullable(),
  graphicElements: z.string().nullable(),
  colors: z.array(
    z.object({
      name: z.string(),
      hex: z.string().describe("#RRGGBB exactly as specified in the source; omit colours whose value is not stated"),
      role: z.string(),
      evidence: z.string().describe("Where in the source this appears"),
    }),
  ),
  typography: z.array(
    z.object({ role: z.string(), family: z.string(), weights: z.string(), notes: z.string(), evidence: z.string() }),
  ),
  restrictions: z.array(z.object({ text: z.string(), evidence: z.string() })),
  missing: z.array(z.string()).describe("Important specifications the source does not state"),
});
export type ExtractedBrand = z.infer<typeof ExtractedBrand>;

export async function extractBrandRules(opts: { userId: string; documents: UserContent; text?: string }): Promise<ExtractedBrand> {
  const content: UserContent = [
    ...opts.documents,
    ...(opts.text?.trim() ? [{ type: "text" as const, text: `Written guidelines from the user:\n<guidelines>\n${opts.text.trim()}\n</guidelines>` }] : []),
    { type: "text", text: "Extract the brand specifications stated in the material above." },
  ];
  const result = await structuredCall({
    operation: "brand.extract",
    userId: opts.userId,
    effort: "medium",
    system: `You are the Brand Guardian of a design studio. Extract brand specifications from guideline material.
Only extract what is explicitly stated or unambiguously shown (e.g. a colour swatch labelled with a hex/RGB value). Never guess hex values from how a colour looks, never invent fonts, never fill gaps with typical choices. Use null or an empty list for anything not stated, and list important gaps under "missing". Convert RGB to hex when RGB values are given; note CMYK/Pantone-only colours under "missing" rather than approximating them.
${UNTRUSTED_CONTENT_RULE}`,
    content,
    schema: ExtractedBrand,
    maxTokens: 16000,
  });
  return {
    ...result,
    colors: result.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex)).map((c) => ({ ...c, hex: c.hex.toUpperCase() })),
  };
}
