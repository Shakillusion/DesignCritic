import { z } from "zod";

/** Research outputs. Citations are item ids from the run; anything else is stripped by `validateBrief`. */

export const TrendBrief = z.object({
  summary: z.string().describe("3–5 sentences: what the evidence says about this topic right now"),
  insights: z.array(
    z.object({
      title: z.string(),
      category: z.enum(["emerging", "established", "cliche"]).describe("emerging = new/rising; established = proven, durable; cliche = overused, avoid or subvert"),
      explanation: z.string().describe("What it is, why it works or fails, and how it applies to this project"),
      citations: z.array(z.string()).describe("Ids of the provided items that support this, e.g. [\"a3\",\"v1\"]. Never invent ids"),
    }),
  ),
  recommended: z.array(z.object({ itemId: z.string(), why: z.string() })).describe("Most useful items to save as references"),
  gaps: z.string().describe("What the provided sources did NOT cover, so the user knows the limits of this research"),
});
export type TrendBrief = z.infer<typeof TrendBrief> & { uncited?: { title: string; explanation: string }[] };

export const ArtDirection = z.object({
  name: z.string(),
  idea: z.string().describe("The core creative idea in one or two sentences"),
  composition: z.string(),
  typography: z.string().describe("Families from the available list, weights, case, scale contrast"),
  palette: z.array(z.string()).describe("4–6 hex colours"),
  imagery: z.string().describe("Photography/illustration direction: subject, framing, light, treatment"),
  avoid: z.array(z.string()).describe("Clichés and things NOT to do"),
  inspiredBy: z.array(z.object({ refId: z.string(), principle: z.string().describe("The principle taken — never a copy of the work") })),
});
export type ArtDirection = z.infer<typeof ArtDirection>;
export const ArtDirections = z.object({ directions: z.array(ArtDirection) });

/** Keep only citations that point at retrieved items; insights left with none are moved to "uncited" and labelled. */
export function validateBrief(raw: z.infer<typeof TrendBrief>, itemIds: Set<string>): TrendBrief {
  const insights: TrendBrief["insights"] = [];
  const uncited: { title: string; explanation: string }[] = [];
  for (const i of raw.insights) {
    const citations = [...new Set(i.citations.map((c) => c.trim()).filter((c) => itemIds.has(c)))];
    if (citations.length) insights.push({ ...i, citations });
    else uncited.push({ title: i.title, explanation: i.explanation });
  }
  return {
    summary: raw.summary,
    insights,
    uncited,
    recommended: raw.recommended.filter((r) => itemIds.has(r.itemId)),
    gaps: raw.gaps,
  };
}

/** Drop inspiredBy entries that don't point at real references, and invalid colours. */
export function validateDirections(dirs: ArtDirection[], refIds: Set<string>): ArtDirection[] {
  return dirs.map((d) => ({
    ...d,
    palette: d.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toUpperCase()),
    inspiredBy: d.inspiredBy.filter((x) => refIds.has(x.refId)),
  }));
}
