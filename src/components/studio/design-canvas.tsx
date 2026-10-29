"use client";

import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderDesignHtml, type ResolvedAsset } from "@/lib/design-engine/render-html";
import type { DesignDocument, Layer } from "@/lib/design-engine/schema";
import { cx } from "@/components/ui";

/**
 * Live artboard: the same HTML the server renders for export, written into a
 * sandboxed iframe (no scripts). Selection, drag and resize happen on an
 * overlay in artboard coordinates, so what you edit is what exports.
 */
export function DesignCanvas({ doc, resolveAsset, selectedId, onSelect, onChange }: { doc: DesignDocument; resolveAsset: (id: string) => ResolvedAsset | null; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (layerId: string, patch: Partial<Layer>, commit: boolean) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [fit, setFit] = useState(0.5);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number }; dx: number; dy: number } | null>(null);
  const { width, height } = doc.artboard;

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    setFit(Math.min((el.clientWidth - 96) / width, (el.clientHeight - 112) / height, 1.5));
  }, [width, height]);
  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [measure]);
  const scale = zoom === "fit" ? fit : zoom;

  // Patch the iframe document in place instead of reloading it, so edits don't flicker.
  useLayoutEffect(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const html = renderDesignHtml(doc, { resolveAsset, mode: "preview" });
    const parsed = new DOMParser().parseFromString(html, "text/html");
    if (!d.documentElement || d.head.innerHTML !== parsed.head.innerHTML) {
      d.open();
      d.write(html);
      d.close();
    } else {
      d.body.replaceWith(d.importNode(parsed.body, true));
    }
  }, [doc, resolveAsset]);

  const onPointerDown = (e: React.PointerEvent, layer: Layer, mode: "move" | "resize") => {
    e.stopPropagation();
    onSelect(layer.id);
    if (layer.locked) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: layer.id, mode, startX: e.clientX, startY: e.clientY, orig: { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, dx: 0, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    setDrag({ ...drag, dx, dy });
    onChange(drag.id, drag.mode === "move" ? { x: Math.round(drag.orig.x + dx), y: Math.round(drag.orig.y + dy) } : { width: Math.max(4, Math.round(drag.orig.width + dx)), height: Math.max(4, Math.round(drag.orig.height + dy)) }, false);
  };
  const onPointerUp = () => {
    if (drag && (drag.dx || drag.dy)) {
      const l = doc.layers.find((x) => x.id === drag.id);
      if (l) onChange(drag.id, { x: l.x, y: l.y, width: l.width, height: l.height }, true);
    }
    setDrag(null);
  };

  const step = (dir: 1 | -1) => setZoom(Math.min(4, Math.max(0.05, Math.round(scale * (dir > 0 ? 1.25 : 0.8) * 100) / 100)));

  return (
    <div className="relative h-full min-h-0">
      <div ref={viewport} className="canvas-grid h-full overflow-auto" onPointerDown={() => onSelect(null)}>
        <div className="flex min-h-full min-w-full items-center justify-center p-12" style={zoom === "fit" ? undefined : { width: width * scale + 96, height: height * scale + 112 }}>
          <div className="relative flex-none" style={{ width: width * scale, height: height * scale }}>
            <div className="absolute -top-6 left-0 text-[11px] font-medium text-subtle tabular-nums">
              {doc.name} · {width}×{height}
            </div>
            <div className="absolute inset-0 overflow-hidden bg-white shadow-lg">
              <iframe ref={frame} title="Artboard" sandbox="allow-same-origin" className="pointer-events-none absolute top-0 left-0 origin-top-left border-0" style={{ width, height, transform: `scale(${scale})` }} />
            </div>
            <div className="absolute inset-0" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
              {[...doc.layers].reverse().map((l) => {
                if (!l.visible) return null;
                const selected = selectedId === l.id;
                return (
                  <div
                    key={l.id}
                    onPointerDown={(e) => onPointerDown(e, l, "move")}
                    className={cx("absolute", selected ? "outline-2 outline-accent" : "hover:outline-1 hover:outline-accent/60", l.locked ? "cursor-not-allowed" : "cursor-move")}
                    style={{ left: l.x * scale, top: l.y * scale, width: l.width * scale, height: l.height * scale, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined }}
                  >
                    {selected && !l.locked && (
                      <span onPointerDown={(e) => onPointerDown(e, l, "resize")} className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-sm border-2 border-accent bg-white" />
                    )}
                    {selected && <span className="absolute -top-5 left-0 rounded bg-accent px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-white">{l.name}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface/95 p-1 shadow-md backdrop-blur">
        <button aria-label="Zoom out" onClick={() => step(-1)} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <Minus className="size-4" />
        </button>
        <button onClick={() => setZoom(1)} title="Actual size" className="h-8 w-14 rounded-lg text-[12.5px] font-medium text-ink-2 tabular-nums hover:bg-surface-2">
          {Math.round(scale * 100)}%
        </button>
        <button aria-label="Zoom in" onClick={() => step(1)} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <Plus className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button aria-label="Fit to screen" onClick={() => setZoom("fit")} className={cx("flex size-8 items-center justify-center rounded-lg", zoom === "fit" ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2")}>
          <Maximize className="size-4" />
        </button>
      </div>
    </div>
  );
}
