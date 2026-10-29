import { describe, expect, it } from "vitest";
import { fontsCssUrl, renderDesignHtml } from "@/lib/design-engine/render-html";
import type { DesignDocument, Layer } from "@/lib/design-engine/schema";

const base = { rotation: 0, opacity: 1, locked: false, visible: true };

function doc(layers: Layer[], background: DesignDocument["artboard"]["background"] = { type: "solid", color: "#FFFFFF" }): DesignDocument {
  return {
    schemaVersion: 1,
    name: "Test",
    format: { kind: "social", preset: "custom" },
    artboard: { width: 400, height: 300, background, print: null },
    layers,
    metadata: { concept: "", rationale: "", fontsUsed: [] },
  };
}

const text = (id: string, extra: Partial<Extract<Layer, { type: "text" }>> = {}): Layer => ({
  ...base,
  id,
  name: id,
  type: "text",
  x: 10,
  y: 10,
  width: 200,
  height: 50,
  role: "body",
  text: "Hello",
  fontFamily: "Inter",
  fontWeight: 400,
  fontSize: 16,
  lineHeight: 1.2,
  letterSpacing: 0,
  color: "#111111",
  align: "left",
  verticalAlign: "top",
  textTransform: "none",
  italic: false,
  ...extra,
});

const none = () => null;

describe("renderDesignHtml", () => {
  it("escapes script tags and quotes in text and names", () => {
    const html = renderDesignHtml(
      doc([text("t1", { text: `<script>alert("x")</script>\nline 2 & 'q'`, name: `"><img src=x onerror=alert(1)>` })]),
      { resolveAsset: none, mode: "export" },
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain(`"><img`);
    expect(html).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;<br>line 2 &#38; &#39;q&#39;");
  });

  it("paints layers in array order with increasing z-index", () => {
    const html = renderDesignHtml(doc([text("a"), text("b"), text("c")]), { resolveAsset: none, mode: "export" });
    const order = [...html.matchAll(/data-layer-id="([^"]+)"[^>]*style="[^"]*z-index:(\d+)/g)].map((m) => [m[1], Number(m[2])]);
    expect(order).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  it("renders linear gradients", () => {
    const html = renderDesignHtml(
      doc([], { type: "linear", angle: 135, stops: [{ color: "#FF0000", position: 0 }, { color: "#0000FF80", position: 100 }] }),
      { resolveAsset: none, mode: "export" },
    );
    expect(html).toContain("linear-gradient(135deg, #FF0000 0%, #0000FF80 100%)");
  });

  it("renders a hatched placeholder for missing assets and an img for resolved ones", () => {
    const img = (id: string, assetId: string): Layer => ({
      ...base, id, name: id, type: "image", x: 0, y: 0, width: 100, height: 100, assetId, fit: "cover",
      focalX: 0.25, focalY: 0.75, brightness: 1, contrast: 1, saturation: 1, borderRadius: 8,
    });
    const html = renderDesignHtml(doc([img("missing", "nope"), img("ok", "a1")]), {
      resolveAsset: (id) => (id === "a1" ? { src: "/api/assets/a1", width: 800, height: 600 } : null),
      mode: "export",
    });
    expect(html).toMatch(/data-layer-id="missing"[^>]*data-missing-asset="true"/);
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain('<img src="/api/assets/a1"');
    expect(html).toContain("object-position:25% 75%");
  });

  it("hides text layers with hideText and specific layers with hideLayerIds", () => {
    const d = doc([text("t1"), { ...base, id: "s1", name: "s", type: "shape", x: 0, y: 0, width: 10, height: 10, shape: "ellipse", fill: { type: "solid", color: "#000000" }, stroke: null, strokeWidth: 0, borderRadius: 0, blendMode: "multiply" }]);
    const hidden = renderDesignHtml(d, { resolveAsset: none, mode: "export", hideText: true });
    expect(hidden).toMatch(/data-layer-id="t1"[^>]*style="[^"]*visibility:hidden/);
    expect(hidden).not.toMatch(/data-layer-id="s1"[^>]*style="[^"]*visibility:hidden/);
    expect(hidden).toContain("mix-blend-mode:multiply");
    expect(hidden).toContain("border-radius:50%");
    const byId = renderDesignHtml(d, { resolveAsset: none, mode: "export", hideLayerIds: ["s1"] });
    expect(byId).toMatch(/data-layer-id="s1"[^>]*style="[^"]*visibility:hidden/);
    expect(byId).not.toMatch(/data-layer-id="t1"[^>]*style="[^"]*visibility:hidden/);
  });

  it("builds a Google Fonts URL with exactly the used weights", () => {
    const url = fontsCssUrl(doc([text("a", { fontWeight: 700 }), text("b"), text("c", { italic: true }), text("d", { fontFamily: "Bebas Neue" })]));
    expect(url).toBe("https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&family=Inter:ital,wght@0,400;0,700;1,400&display=block");
    expect(fontsCssUrl(doc([]))).toBeNull();
  });
});
