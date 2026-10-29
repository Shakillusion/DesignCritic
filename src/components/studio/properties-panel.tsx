"use client";

import { AlignCenter, AlignLeft, AlignRight, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { ALLOWED_FONTS, type DesignDocument, type Fill, type Layer } from "@/lib/design-engine/schema";
import { cx, Input, Select, Textarea } from "@/components/ui";
import type { Asset } from "@/types/domain";

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex min-w-0 gap-1.5">{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, step = 1, suffix, min, max }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string; min?: number; max?: number }) {
  return (
    <div className="relative min-w-0 flex-1">
      <Input type="number" step={step} min={min} max={max} value={Number.isInteger(value) ? value : Number(value.toFixed(3))} onChange={(e) => onChange(num(e.target.value, value))} className="h-8 pr-7 text-[12.5px] tabular-nums" />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-subtle">{suffix}</span>}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const base = value.slice(0, 7);
  const alpha = value.length === 9 ? value.slice(7) : "";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <label className="relative size-8 flex-none cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" style={{ background: value }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(base) ? base : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase() + alpha)} className="absolute inset-0 opacity-0" aria-label="Colour" />
      </label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 font-mono text-[12px] uppercase" maxLength={9} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 border-b border-line px-4 py-4">
      <h3 className="text-[11.5px] font-semibold tracking-wider text-subtle uppercase">{title}</h3>
      {children}
    </div>
  );
}

export function PropertiesPanel({ doc, layer, assets, onLayer, onDoc }: { doc: DesignDocument; layer: Layer | null; assets: Asset[]; onLayer: (patch: Partial<Layer>) => void; onDoc: (d: DesignDocument) => void }) {
  if (!layer) {
    const bg = doc.artboard.background;
    return (
      <div>
        <Section title="Artboard">
          <Row label="Size">
            <span className="text-[12.5px] text-ink tabular-nums">
              {doc.artboard.width} × {doc.artboard.height}px
            </span>
          </Row>
          {doc.artboard.print && (
            <Row label="Print">
              <span className="text-[12.5px] text-ink">
                {doc.artboard.print.trimWidthMm}×{doc.artboard.print.trimHeightMm}mm · {doc.artboard.print.dpi}dpi
              </span>
            </Row>
          )}
          <Row label="Background">
            <ColorInput value={bg.type === "solid" ? bg.color : bg.stops[0]?.color ?? "#FFFFFF"} onChange={(c) => onDoc({ ...doc, artboard: { ...doc.artboard, background: { type: "solid", color: c } } })} />
          </Row>
        </Section>
        <Section title="Concept">
          <p className="text-[12.5px] leading-relaxed text-ink-2">{doc.metadata.concept}</p>
          <p className="text-[12px] leading-relaxed text-muted">{doc.metadata.rationale}</p>
        </Section>
        <p className="px-4 py-4 text-[12px] text-subtle">Select a layer on the canvas or in the layer list to edit it.</p>
      </div>
    );
  }

  const disabled = layer.locked;
  return (
    <fieldset disabled={disabled} className={cx(disabled && "opacity-60")}>
      {disabled && (
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-[12px] text-muted">
          <Lock className="size-3.5" /> Locked — unlock in the layer list to edit.
        </div>
      )}
      <Section title="Layer">
        <Row label="Name">
          <Input value={layer.name} onChange={(e) => onLayer({ name: e.target.value })} className="h-8 text-[12.5px]" />
        </Row>
        <Row label="Position">
          <NumberInput value={layer.x} onChange={(x) => onLayer({ x })} suffix="X" />
          <NumberInput value={layer.y} onChange={(y) => onLayer({ y })} suffix="Y" />
        </Row>
        <Row label="Size">
          <NumberInput value={layer.width} onChange={(width) => onLayer({ width: Math.max(1, width) })} suffix="W" min={1} />
          <NumberInput value={layer.height} onChange={(height) => onLayer({ height: Math.max(1, height) })} suffix="H" min={1} />
        </Row>
        <Row label="Rotate / α">
          <NumberInput value={layer.rotation} onChange={(rotation) => onLayer({ rotation })} suffix="°" />
          <NumberInput value={Math.round(layer.opacity * 100)} onChange={(o) => onLayer({ opacity: Math.min(1, Math.max(0, o / 100)) })} suffix="%" min={0} max={100} />
        </Row>
      </Section>

      {layer.type === "text" && (
        <Section title="Text">
          <Textarea rows={3} value={layer.text} onChange={(e) => onLayer({ text: e.target.value })} className="text-[13px]" />
          <Row label="Font">
            <Select value={layer.fontFamily} onChange={(e) => onLayer({ fontFamily: e.target.value })} className="h-8 text-[12.5px]">
              {Object.keys(ALLOWED_FONTS).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Weight / size">
            <Select value={String(layer.fontWeight)} onChange={(e) => onLayer({ fontWeight: Number(e.target.value) })} className="h-8 text-[12.5px]">
              {(ALLOWED_FONTS[layer.fontFamily]?.weights ?? [400]).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
            <NumberInput value={layer.fontSize} onChange={(fontSize) => onLayer({ fontSize: Math.max(4, fontSize) })} suffix="px" />
          </Row>
          <Row label="Leading / track">
            <NumberInput value={layer.lineHeight} onChange={(lineHeight) => onLayer({ lineHeight })} step={0.05} />
            <NumberInput value={layer.letterSpacing} onChange={(letterSpacing) => onLayer({ letterSpacing })} step={0.01} suffix="em" />
          </Row>
          <Row label="Colour">
            <ColorInput value={layer.color} onChange={(color) => onLayer({ color })} />
          </Row>
          <Row label="Align">
            <div className="flex rounded-lg border border-line p-0.5">
              {(
                [
                  ["left", AlignLeft],
                  ["center", AlignCenter],
                  ["right", AlignRight],
                ] as const
              ).map(([a, Icon]) => (
                <button key={a} type="button" aria-label={`Align ${a}`} onClick={() => onLayer({ align: a })} className={cx("flex size-7 items-center justify-center rounded-md", layer.align === a ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
                  <Icon className="size-3.5" />
                </button>
              ))}
            </div>
            <Select value={layer.verticalAlign} onChange={(e) => onLayer({ verticalAlign: e.target.value as "top" | "middle" | "bottom" })} className="h-8 text-[12.5px]">
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </Select>
          </Row>
          <Row label="Case">
            <Select value={layer.textTransform} onChange={(e) => onLayer({ textTransform: e.target.value as "none" | "uppercase" | "lowercase" })} className="h-8 text-[12.5px]">
              <option value="none">As typed</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
            </Select>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={layer.italic} onChange={(e) => onLayer({ italic: e.target.checked })} className="accent-[var(--accent)]" /> Italic
            </label>
          </Row>
        </Section>
      )}

      {layer.type === "image" && (
        <Section title="Image">
          <Row label="Asset">
            <Select value={layer.assetId} onChange={(e) => onLayer({ assetId: e.target.value })} className="h-8 text-[12.5px]">
              {assets.filter((a) => a.status !== "rejected" && a.type !== "icon").map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title || a.id}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Fit">
            <Select value={layer.fit} onChange={(e) => onLayer({ fit: e.target.value as "cover" | "contain" })} className="h-8 text-[12.5px]">
              <option value="cover">Fill (crop)</option>
              <option value="contain">Fit (no crop)</option>
            </Select>
          </Row>
          <Row label="Focal point">
            <NumberInput value={layer.focalX} onChange={(focalX) => onLayer({ focalX: Math.min(1, Math.max(0, focalX)) })} step={0.05} suffix="X" />
            <NumberInput value={layer.focalY} onChange={(focalY) => onLayer({ focalY: Math.min(1, Math.max(0, focalY)) })} step={0.05} suffix="Y" />
          </Row>
          {(["brightness", "contrast", "saturation"] as const).map((k) => (
            <Row key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <input type="range" min={0} max={2} step={0.05} value={layer[k]} onChange={(e) => onLayer({ [k]: Number(e.target.value) } as Partial<Layer>)} className="flex-1 accent-[var(--accent)]" />
              <span className="w-9 text-right text-[12px] text-muted tabular-nums">{layer[k].toFixed(2)}</span>
            </Row>
          ))}
        </Section>
      )}

      {layer.type === "shape" && (
        <Section title="Shape">
          <Row label="Type">
            <Select value={layer.shape} onChange={(e) => onLayer({ shape: e.target.value as "rect" | "ellipse" | "line" })} className="h-8 text-[12.5px]">
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="line">Line</option>
            </Select>
          </Row>
          <FillEditor fill={layer.fill} onChange={(fill) => onLayer({ fill })} />
          <Row label="Stroke">
            <ColorInput value={layer.stroke ?? ""} onChange={(stroke) => onLayer({ stroke: stroke || null })} />
            <div className="w-16 flex-none">
              <NumberInput value={layer.strokeWidth} onChange={(strokeWidth) => onLayer({ strokeWidth: Math.max(0, strokeWidth) })} />
            </div>
          </Row>
          <Row label="Radius">
            <NumberInput value={layer.borderRadius} onChange={(borderRadius) => onLayer({ borderRadius: Math.max(0, borderRadius) })} suffix="px" />
          </Row>
          <Row label="Blend">
            <Select value={layer.blendMode} onChange={(e) => onLayer({ blendMode: e.target.value as "normal" })} className="h-8 text-[12.5px]">
              {["normal", "multiply", "screen", "overlay", "soft-light"].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Row>
        </Section>
      )}
    </fieldset>
  );
}

function FillEditor({ fill, onChange }: { fill: Fill | null; onChange: (f: Fill | null) => void }) {
  return (
    <>
      <Row label="Fill">
        <Select
          value={fill?.type ?? "none"}
          onChange={(e) => {
            const t = e.target.value;
            if (t === "none") onChange(null);
            else if (t === "solid") onChange({ type: "solid", color: fill?.type === "linear" ? fill.stops[0]?.color ?? "#000000" : fill?.color ?? "#000000" });
            else onChange({ type: "linear", angle: 180, stops: [{ color: "#00000000", position: 0 }, { color: fill?.type === "solid" ? fill.color : "#000000CC", position: 100 }] });
          }}
          className="h-8 text-[12.5px]"
        >
          <option value="none">None</option>
          <option value="solid">Solid</option>
          <option value="linear">Linear gradient</option>
        </Select>
      </Row>
      {fill?.type === "solid" && (
        <Row label="Colour">
          <ColorInput value={fill.color} onChange={(color) => onChange({ type: "solid", color })} />
        </Row>
      )}
      {fill?.type === "linear" && (
        <>
          <Row label="Angle">
            <NumberInput value={fill.angle} onChange={(angle) => onChange({ ...fill, angle })} suffix="°" />
          </Row>
          {fill.stops.map((s, i) => (
            <Row key={i} label={`Stop ${i + 1}`}>
              <ColorInput value={s.color} onChange={(color) => onChange({ ...fill, stops: fill.stops.map((x, j) => (j === i ? { ...x, color } : x)) })} />
              <div className="w-16 flex-none">
                <NumberInput value={s.position} onChange={(position) => onChange({ ...fill, stops: fill.stops.map((x, j) => (j === i ? { ...x, position } : x)) })} suffix="%" />
              </div>
            </Row>
          ))}
        </>
      )}
    </>
  );
}
