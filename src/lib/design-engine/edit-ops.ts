import { z } from "zod";
import { Fill, Layer, normalizeDocument, type DesignDocument } from "./schema";
import type { AppliedChange } from "@/types/domain";

/**
 * Targeted edits to a design document. Agents propose these instead of
 * rewriting the whole document, so untouched layers stay byte-identical and
 * every change is traceable to a finding.
 *
 * `update.changes` lists every editable property as nullable: null = leave as is.
 * (Free models follow a fixed shape far more reliably than an open patch object.)
 */

const nullable = <T extends z.ZodType>(t: T) => t.nullable();

export const LayerChanges = z.object({
  name: nullable(z.string()),
  x: nullable(z.number()),
  y: nullable(z.number()),
  width: nullable(z.number()),
  height: nullable(z.number()),
  rotation: nullable(z.number()),
  opacity: nullable(z.number()),
  visible: nullable(z.boolean()),
  // text
  text: nullable(z.string()),
  fontFamily: nullable(z.string()),
  fontWeight: nullable(z.number()),
  fontSize: nullable(z.number()),
  lineHeight: nullable(z.number()),
  letterSpacing: nullable(z.number()),
  color: nullable(z.string()),
  align: nullable(z.enum(["left", "center", "right"])),
  verticalAlign: nullable(z.enum(["top", "middle", "bottom"])),
  textTransform: nullable(z.enum(["none", "uppercase", "lowercase"])),
  italic: nullable(z.boolean()),
  // image
  fit: nullable(z.enum(["cover", "contain"])),
  focalX: nullable(z.number()),
  focalY: nullable(z.number()),
  brightness: nullable(z.number()),
  contrast: nullable(z.number()),
  saturation: nullable(z.number()),
  // shape
  fill: nullable(Fill),
  stroke: nullable(z.string()),
  strokeWidth: nullable(z.number()),
  borderRadius: nullable(z.number()),
});
export type LayerChanges = z.infer<typeof LayerChanges>;

export const EditOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update"), layerId: z.string(), findingId: z.string().nullable(), reason: z.string(), changes: LayerChanges }),
  z.object({ op: z.literal("add"), findingId: z.string().nullable(), reason: z.string(), layer: Layer, placeAboveLayerId: z.string().nullable().describe("Insert directly above this layer; null = on top") }),
  z.object({ op: z.literal("remove"), layerId: z.string(), findingId: z.string().nullable(), reason: z.string() }),
  z.object({
    op: z.literal("reorder"),
    layerId: z.string(),
    findingId: z.string().nullable(),
    reason: z.string(),
    position: z.enum(["front", "back", "above", "below"]),
    relativeToLayerId: z.string().nullable(),
  }),
]);
export type EditOp = z.infer<typeof EditOp>;

const FIELDS_BY_TYPE: Record<Layer["type"], Set<string>> = {
  text: new Set(["text", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "color", "align", "verticalAlign", "textTransform", "italic"]),
  image: new Set(["fit", "focalX", "focalY", "brightness", "contrast", "saturation", "borderRadius"]),
  shape: new Set(["fill", "stroke", "strokeWidth", "borderRadius"]),
};
const COMMON = new Set(["name", "x", "y", "width", "height", "rotation", "opacity", "visible"]);

export interface ApplyResult {
  doc: DesignDocument;
  applied: AppliedChange[];
  rejected: { op: EditOp; reason: string }[];
}

/**
 * Apply ops in order. Never touches locked layers, never removes an image
 * layer's asset reference to something unknown, and rejects (rather than
 * guesses) anything it can't apply cleanly.
 */
export function applyEditOps(input: DesignDocument, ops: EditOp[], opts: { knownAssetIds: Set<string> }): ApplyResult {
  const doc = structuredClone(input);
  const applied: AppliedChange[] = [];
  const rejected: ApplyResult["rejected"] = [];
  const find = (id: string) => doc.layers.findIndex((l) => l.id === id);

  for (const op of ops) {
    if (op.op === "add") {
      const layer = op.layer;
      if (find(layer.id) >= 0) {
        rejected.push({ op, reason: `A layer named “${layer.id}” already exists` });
        continue;
      }
      if (layer.type === "image" && !opts.knownAssetIds.has(layer.assetId)) {
        rejected.push({ op, reason: "Image layers can only use assets already in this project" });
        continue;
      }
      const at = op.placeAboveLayerId ? find(op.placeAboveLayerId) : -1;
      doc.layers.splice(at >= 0 ? at + 1 : doc.layers.length, 0, { ...layer, locked: false });
      applied.push({ findingId: op.findingId, layerId: layer.id, op: "add", reason: op.reason, fields: [] });
      continue;
    }

    const i = find(op.layerId);
    if (i < 0) {
      rejected.push({ op, reason: `No layer “${op.layerId}”` });
      continue;
    }
    const layer = doc.layers[i];
    if (layer.locked) {
      rejected.push({ op, reason: `“${layer.name}” is locked` });
      continue;
    }

    if (op.op === "remove") {
      doc.layers.splice(i, 1);
      applied.push({ findingId: op.findingId, layerId: op.layerId, op: "remove", reason: op.reason, fields: [] });
    } else if (op.op === "reorder") {
      const [moved] = doc.layers.splice(i, 1);
      let to = op.position === "front" ? doc.layers.length : op.position === "back" ? 0 : -1;
      if (to < 0) {
        const r = op.relativeToLayerId ? find(op.relativeToLayerId) : -1;
        if (r < 0) {
          doc.layers.splice(i, 0, moved);
          rejected.push({ op, reason: "Reorder needs an existing reference layer" });
          continue;
        }
        to = op.position === "above" ? r + 1 : r;
      }
      doc.layers.splice(to, 0, moved);
      applied.push({ findingId: op.findingId, layerId: op.layerId, op: "reorder", reason: op.reason, fields: [] });
    } else {
      const allowed = FIELDS_BY_TYPE[layer.type];
      const patch: Record<string, unknown> = {};
      const ignored: string[] = [];
      for (const [k, v] of Object.entries(op.changes)) {
        if (v === null || v === undefined) continue;
        if (COMMON.has(k) || allowed.has(k)) patch[k] = v;
        else ignored.push(k);
      }
      const fields = Object.keys(patch).filter((k) => JSON.stringify((layer as Record<string, unknown>)[k]) !== JSON.stringify(patch[k]));
      if (!fields.length) {
        rejected.push({ op, reason: ignored.length ? `${ignored.join(", ")} don't apply to a ${layer.type} layer` : "No actual change" });
        continue;
      }
      doc.layers[i] = { ...layer, ...patch } as Layer;
      applied.push({ findingId: op.findingId, layerId: op.layerId, op: "update", reason: op.reason, fields });
    }
  }
  const normalized = normalizeDocument(doc);
  // normalizeDocument may rename duplicate ids; locked layers must come through untouched.
  normalized.layers = normalized.layers.map((l) => input.layers.find((o) => o.locked && o.id === l.id) ?? l);
  return { doc: normalized, applied, rejected };
}

/** Compact, model-readable description of a document (ids, roles, geometry, key styling). */
export function describeDocument(doc: DesignDocument): string {
  const lines = [`Artboard ${doc.artboard.width}×${doc.artboard.height}px. Layers bottom → top:`];
  for (const l of doc.layers) {
    const base = `- [${l.type}] id="${l.id}" name="${l.name}"${l.locked ? " LOCKED" : ""}${l.visible ? "" : " hidden"} box=(${Math.round(l.x)},${Math.round(l.y)},${Math.round(l.width)}×${Math.round(l.height)}) opacity=${l.opacity}`;
    if (l.type === "text") lines.push(`${base} role=${l.role} font="${l.fontFamily}" ${l.fontWeight} ${l.fontSize}px lh=${l.lineHeight} ls=${l.letterSpacing}em color=${l.color} align=${l.align} transform=${l.textTransform} text=${JSON.stringify(l.text)}`);
    else if (l.type === "image") lines.push(`${base} asset=${l.assetId} fit=${l.fit} focal=(${l.focalX},${l.focalY}) b/c/s=${l.brightness}/${l.contrast}/${l.saturation}`);
    else lines.push(`${base} shape=${l.shape} fill=${JSON.stringify(l.fill)} stroke=${l.stroke ?? "none"} radius=${l.borderRadius} blend=${l.blendMode}`);
  }
  return lines.join("\n");
}
