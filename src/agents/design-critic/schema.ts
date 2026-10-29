import { z } from "zod";

/**
 * Structured critique returned by the Senior Design Critic.
 * Sent to Claude as the output format, so: no numeric min/max (clamped after),
 * all fields required (nullable where the answer can legitimately be absent).
 */

export const CATEGORIES = [
  "communication",
  "hierarchy",
  "typography",
  "layout",
  "color",
  "imagery",
  "brand",
  "distinctiveness",
  "production",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Transparent scoring: overall = weighted mean of scored categories (brand drops out when no brand is set). */
export const CATEGORY_META: Record<Category, { label: string; weight: number; criteria: string }> = {
  communication: {
    label: "Clarity of communication",
    weight: 16,
    criteria: "Is the core message understood within ~3 seconds by the intended audience? Is the call to action clear?",
  },
  hierarchy: {
    label: "Visual hierarchy",
    weight: 14,
    criteria: "Is there a deliberate reading order with one dominant focal point and clear secondary levels?",
  },
  typography: {
    label: "Typography",
    weight: 14,
    criteria: "Typeface fit, pairing, scale contrast, spacing (tracking/leading), measure, rag, legibility at target size.",
  },
  layout: {
    label: "Layout & composition",
    weight: 13,
    criteria: "Grid/alignment logic, balance, proximity, negative space, rhythm — judged against the chosen compositional intent.",
  },
  color: {
    label: "Colour & contrast",
    weight: 11,
    criteria: "Harmony, purposeful palette, legibility contrast (WCAG-style for text), mood fit.",
  },
  imagery: {
    label: "Imagery",
    weight: 10,
    criteria: "Relevance, quality/resolution, cropping, lighting, art-direction consistency, image–type relationship.",
  },
  brand: {
    label: "Brand alignment",
    weight: 8,
    criteria: "Use of approved colours, fonts, logo rules and tone. Only scored when brand rules are provided.",
  },
  distinctiveness: {
    label: "Distinctiveness",
    weight: 7,
    criteria: "Ownable, non-generic idea appropriate to the audience. Not rewarded for complexity.",
  },
  production: {
    label: "Technical & production",
    weight: 7,
    criteria: "Resolution, artefacts, safe margins, edge tension, export suitability for the stated medium.",
  },
};

export const Region = z.object({
  x: z.number().describe("Left edge, 0–1 fraction of image width"),
  y: z.number().describe("Top edge, 0–1 fraction of image height"),
  width: z.number().describe("0–1 fraction of image width"),
  height: z.number().describe("0–1 fraction of image height"),
});
export type Region = z.infer<typeof Region>;

export const Finding = z.object({
  id: z.string().describe("Short stable id like f1, f2…"),
  title: z.string().describe("Specific, ≤ 10 words. Never generic like 'Improve typography'."),
  category: z.enum(CATEGORIES),
  severity: z.enum(["critical", "major", "minor", "suggestion"]),
  kind: z
    .enum(["objective", "contextual", "subjective"])
    .describe("objective = measurable error; contextual = depends on purpose/audience; subjective = art-direction opinion"),
  affectedElement: z.string().describe("Which element, e.g. 'Headline “SUMMER SALE”, top-left'"),
  region: Region.nullable().describe("Bounding box of the affected area, or null if not localisable"),
  description: z.string().describe("Exactly what is wrong, citing what you see"),
  whyItMatters: z.string(),
  recommendation: z.string().describe("Concrete correction with values where possible (sizes, spacing, colours, weights)"),
  confidence: z.enum(["high", "medium", "low"]),
  intentionalPossibility: z
    .string()
    .nullable()
    .describe("If this could be a deliberate creative choice, say how to tell; otherwise null"),
});
export type Finding = z.infer<typeof Finding>;

export const CritiqueResult = z.object({
  summary: z.string().describe("3–5 sentence verdict a creative director would give"),
  observedContent: z.object({
    visibleText: z.array(z.string()).describe("Text you can read in the design, verbatim"),
    description: z.string().describe("Neutral description of what the design contains"),
  }),
  inferredContext: z.object({
    purpose: z.string(),
    audience: z.string(),
    medium: z.string(),
    creativeIntent: z.string().describe("The art direction the designer appears to be pursuing"),
  }),
  categoryScores: z.array(
    z.object({
      category: z.enum(CATEGORIES),
      score: z.number().nullable().describe("0–100, or null when not assessable (e.g. brand without rules)"),
      rationale: z.string(),
    }),
  ),
  findings: z.array(Finding),
  strengths: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      region: Region.nullable(),
    }),
  ),
  productionNotes: z.array(z.string()),
});
export type CritiqueResult = z.infer<typeof CritiqueResult>;

export const ImprovementPlan = z.object({
  goal: z.string(),
  preserve: z.array(z.string()).describe("What must not change because it already works"),
  steps: z.array(
    z.object({
      order: z.number(),
      title: z.string(),
      findingIds: z.array(z.string()),
      action: z.string().describe("Precise instruction a designer could execute"),
      impact: z.enum(["high", "medium", "low"]),
      effort: z.enum(["small", "medium", "large"]),
      feasibleOnRaster: z
        .boolean()
        .describe("Can this be done on a flattened image without rebuilding the layout?"),
    }),
  ),
  rebuildRecommended: z.boolean().describe("Whether rebuilding as an editable layout is the better path"),
  notes: z.string(),
});
export type ImprovementPlan = z.infer<typeof ImprovementPlan>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Clamp model output and compute the transparent overall score. */
export function finalizeCritique(raw: CritiqueResult, opts: { hasBrand: boolean }): { result: CritiqueResult; overall: number } {
  const result = structuredClone(raw);
  const byCategory = new Map<Category, CritiqueResult["categoryScores"][number]>();
  for (const s of result.categoryScores) byCategory.set(s.category, s);
  result.categoryScores = CATEGORIES.map((c) => {
    const s = byCategory.get(c) ?? { category: c, score: null, rationale: "Not assessed." };
    let score = s.score === null ? null : Math.round(Math.min(100, Math.max(0, s.score)));
    if (c === "brand" && !opts.hasBrand) score = null;
    return { ...s, score };
  });
  const fixRegion = (r: Region | null): Region | null => {
    if (!r) return null;
    const x = clamp01(r.x), y = clamp01(r.y);
    const width = Math.min(1 - x, clamp01(r.width)), height = Math.min(1 - y, clamp01(r.height));
    return width > 0.002 && height > 0.002 ? { x, y, width, height } : null;
  };
  const ids = new Set<string>();
  result.findings = result.findings.map((f, i) => {
    let id = f.id?.trim() || `f${i + 1}`;
    if (ids.has(id)) id = `f${i + 1}`;
    ids.add(id);
    return { ...f, id, region: fixRegion(f.region) };
  });
  const severityRank = { critical: 0, major: 1, minor: 2, suggestion: 3 } as const;
  result.findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  result.strengths = result.strengths.map((s) => ({ ...s, region: fixRegion(s.region) }));
  return { result, overall: computeOverall(result.categoryScores) };
}

export function computeOverall(scores: { category: Category; score: number | null }[]): number {
  let total = 0, weights = 0;
  for (const s of scores) {
    if (s.score === null) continue;
    const w = CATEGORY_META[s.category].weight;
    total += s.score * w;
    weights += w;
  }
  return weights ? Math.round(total / weights) : 0;
}
