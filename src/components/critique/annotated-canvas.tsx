"use client";

import { Eye, EyeOff, Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Region } from "@/agents/design-critic/schema";
import { cx } from "@/components/ui";

export interface Marker {
  id: string;
  label: string;
  region: Region;
  tone: "critical" | "major" | "minor" | "suggestion" | "strength";
}

const TONE = {
  critical: { border: "border-critical", bg: "bg-critical", fill: "bg-critical/8" },
  major: { border: "border-major", bg: "bg-major", fill: "bg-major/8" },
  minor: { border: "border-minor", bg: "bg-minor", fill: "bg-minor/8" },
  suggestion: { border: "border-subtle", bg: "bg-muted", fill: "bg-ink/5" },
  strength: { border: "border-success", bg: "bg-success", fill: "bg-success/8" },
};

/** Artwork viewer with zoom and region markers positioned in image-relative coordinates. */
export function AnnotatedCanvas({ src, width, height, markers, activeId, onSelect, onHover, alt }: { src: string; width: number; height: number; markers: Marker[]; activeId: string | null; onSelect: (id: string) => void; onHover?: (id: string | null) => void; alt: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(1);
  const [show, setShow] = useState(true);

  const measure = useCallback(() => {
    const el = viewport.current;
    if (!el || !width || !height) return;
    const pad = 64;
    setFitScale(Math.min((el.clientWidth - pad) / width, (el.clientHeight - pad) / height, 2));
  }, [width, height]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [measure]);

  const scale = zoom === "fit" ? fitScale : zoom;
  const step = (dir: 1 | -1) => setZoom(Math.min(4, Math.max(0.1, Math.round((scale * (dir > 0 ? 1.25 : 0.8)) * 100) / 100)));

  return (
    <div className="relative h-full min-h-0">
      <div ref={viewport} className="canvas-grid h-full overflow-auto">
        <div className="flex min-h-full min-w-full items-center justify-center p-8" style={{ width: zoom === "fit" ? undefined : width * scale + 64, height: zoom === "fit" ? undefined : height * scale + 64 }}>
          <div className="relative flex-none shadow-lg" style={{ width: width * scale, height: height * scale }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- private files served by our route */}
            <img src={src} alt={alt} className="block h-full w-full select-none" draggable={false} />
            {show &&
              markers.map((m) => {
                const t = TONE[m.tone];
                const active = activeId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => onSelect(m.id)}
                    onMouseEnter={() => onHover?.(m.id)}
                    onMouseLeave={() => onHover?.(null)}
                    aria-label={`Finding ${m.label}`}
                    className={cx(
                      "absolute rounded-[3px] border-2 transition-all duration-150",
                      t.border,
                      active ? cx(t.fill, "z-20 ring-4 ring-white/60") : "z-10 border-dashed opacity-80 hover:opacity-100",
                    )}
                    style={{ left: `${m.region.x * 100}%`, top: `${m.region.y * 100}%`, width: `${m.region.width * 100}%`, height: `${m.region.height * 100}%` }}
                  >
                    <span className={cx("absolute -top-2.5 -left-2.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10.5px] font-bold text-white shadow-md ring-2 ring-white", t.bg, active && "scale-125")}>{m.label}</span>
                  </button>
                );
              })}
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface/95 p-1 shadow-md backdrop-blur">
        <ToolButton label="Zoom out" onClick={() => step(-1)}>
          <Minus className="size-4" />
        </ToolButton>
        <button onClick={() => setZoom(1)} className="h-8 w-14 rounded-lg text-[12.5px] font-medium text-ink-2 tabular-nums hover:bg-surface-2" title="Actual size">
          {Math.round(scale * 100)}%
        </button>
        <ToolButton label="Zoom in" onClick={() => step(1)}>
          <Plus className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" />
        <ToolButton label="Fit to screen" onClick={() => setZoom("fit")} active={zoom === "fit"}>
          <Maximize className="size-4" />
        </ToolButton>
        <ToolButton label={show ? "Hide annotations" : "Show annotations"} onClick={() => setShow((s) => !s)} active={show}>
          {show ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className={cx("flex size-8 items-center justify-center rounded-lg transition-colors", active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink")}>
      {children}
    </button>
  );
}
