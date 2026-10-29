import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_META, computeOverall, CritiqueResult, finalizeCritique } from "@/agents/design-critic/schema";

/** A realistic model response for the summer-festival fixture poster. */
const response = {
  summary: "A confident, high-contrast poster whose headline reads instantly, let down by illegible supporting details and an unresolved image block.",
  observedContent: { visibleText: ["SUMMER", "FESTIVAL", "12–14 July · City Park · tickets online"], description: "Dark navy poster with a red rectangle and white headline." },
  inferredContext: { purpose: "Promote a summer festival", audience: "Local adults", medium: "Poster (print or digital)", creativeIntent: "Bold, minimal, typographic" },
  categoryScores: [
    { category: "communication", score: 72, rationale: "Headline is clear; date and place are hard to read." },
    { category: "hierarchy", score: 78, rationale: "Strong headline dominance." },
    { category: "typography", score: 64, rationale: "Default-looking sans, cramped line spacing." },
    { category: "layout", score: 70, rationale: "Consistent left margin." },
    { category: "color", score: 58, rationale: "Detail text #6f7d8c on #1f2b3a is low contrast." },
    { category: "imagery", score: 40, rationale: "Placeholder red block, no image." },
    { category: "brand", score: 90, rationale: "Model scored brand without rules (should be ignored)." },
    { category: "distinctiveness", score: 55, rationale: "Generic." },
    { category: "production", score: 130, rationale: "Out-of-range score to test clamping." },
  ],
  findings: [
    { id: "f1", title: "Event details fail contrast at small size", category: "color", severity: "major", kind: "objective", affectedElement: "Details line, bottom-left", region: { x: 0.06, y: 0.87, width: 0.75, height: 0.05 }, description: "Grey 22px text on navy measures roughly 3.2:1.", whyItMatters: "Date and place are the action information.", recommendation: "Set to #F4EFE6 at 26px, weight 500.", confidence: "high", intentionalPossibility: null },
    { id: "f1", title: "Placeholder image block", category: "imagery", severity: "critical", kind: "contextual", affectedElement: "Red rectangle, top", region: { x: 0.9, y: -0.1, width: 0.5, height: 0.5 }, description: "A flat red rectangle where an image would sit.", whyItMatters: "It reads unfinished.", recommendation: "Replace with festival photography cropped to 4:3.", confidence: "medium", intentionalPossibility: "If a colour-field style is intended, extend it to the edge." },
    { id: "f3", title: "Tight headline leading", category: "typography", severity: "suggestion", kind: "subjective", affectedElement: "Headline", region: null, description: "Lines sit close.", whyItMatters: "Polish.", recommendation: "Leading 0.95 with -10 tracking.", confidence: "low", intentionalPossibility: null },
  ],
  strengths: [{ title: "Instant headline", description: "Huge, high-contrast headline.", region: { x: 0.06, y: 0.55, width: 0.6, height: 0.17 } }],
  productionNotes: ["900×1200px prints at only 76×102 mm at 300 dpi."],
};

describe("critique schema", () => {
  it("parses a realistic model response", () => {
    expect(CritiqueResult.safeParse(response).success).toBe(true);
  });

  it("rejects responses missing required structure", () => {
    const missing: Partial<typeof response> = { ...response };
    delete missing.findings;
    expect(CritiqueResult.safeParse(missing).success).toBe(false);
    expect(CritiqueResult.safeParse({ ...response, findings: [{ ...response.findings[0], severity: "catastrophic" }] }).success).toBe(false);
  });

  it("clamps scores, nulls brand without rules, fixes regions and ids, sorts by severity", () => {
    const { result, overall } = finalizeCritique(CritiqueResult.parse(response), { hasBrand: false });
    const byCat = Object.fromEntries(result.categoryScores.map((s) => [s.category, s.score]));
    expect(byCat.brand).toBeNull();
    expect(byCat.production).toBe(100);
    expect(result.categoryScores.map((s) => s.category)).toEqual([...CATEGORIES]);
    expect(result.findings.map((f) => f.severity)).toEqual(["critical", "major", "suggestion"]);
    expect(new Set(result.findings.map((f) => f.id)).size).toBe(3);
    const clipped = result.findings.find((f) => f.category === "imagery")!.region!;
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(1);
    expect(clipped.y).toBe(0);
    expect(overall).toBe(computeOverall(result.categoryScores));
  });

  it("computes a transparent weighted mean", () => {
    const scores = CATEGORIES.map((c) => ({ category: c, score: c === "brand" ? null : 50 }));
    expect(computeOverall(scores)).toBe(50);
    const weights = Object.values(CATEGORY_META).reduce((a, m) => a + m.weight, 0);
    expect(weights).toBe(100);
  });
});
