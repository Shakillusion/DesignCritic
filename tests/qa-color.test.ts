import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, deltaE76, parseHex, relativeLuminance } from "@/agents/qa-inspector/color";

describe("qa colour maths", () => {
  it("computes relative luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#777")).toBeCloseTo(0.1845, 3);
  });

  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", "#000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#EEEEEE", "#FFFFFF")).toBeLessThan(1.2);
  });

  it("parses alpha and composites", () => {
    expect(parseHex("#00000080")?.a).toBeCloseTo(0.502, 2);
    const c = compositeOver("#000000", "#FFFFFF", 0.5);
    expect(c.r).toBeCloseTo(127.5);
    expect(parseHex("nope")).toBeNull();
  });

  it("computes CIE76 deltaE", () => {
    expect(deltaE76("#FF0000", "#FF0000")).toBe(0);
    expect(deltaE76("#000000", "#FFFFFF")).toBeCloseTo(100, 0);
  });
});
