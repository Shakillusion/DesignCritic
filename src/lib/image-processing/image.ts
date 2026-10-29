import "server-only";
import sharp from "sharp";
import type { TechnicalFacts } from "@/types/domain";

export type SniffedType = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/svg+xml" | "application/pdf";

/** Identify a file by its bytes, never by its name or the client-supplied MIME type. */
export function sniffType(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "").trimStart();
  if ((head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!--")) && /<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export interface ValidatedUpload {
  mime: SniffedType;
  width: number | null;
  height: number | null;
  buffer: Buffer;
}

const RASTER: SniffedType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Validate type by magic bytes, size, and (for images) that the file actually decodes. */
export async function validateUpload(buffer: Buffer, opts: { allow: ("raster" | "svg" | "pdf")[]; maxBytes: number }): Promise<ValidatedUpload> {
  if (buffer.length === 0) throw new UploadError("The file is empty.");
  if (buffer.length > opts.maxBytes) {
    throw new UploadError(`The file is ${(buffer.length / 1048576).toFixed(1)} MB; the limit is ${Math.round(opts.maxBytes / 1048576)} MB.`);
  }
  const mime = sniffType(buffer);
  const allowed: SniffedType[] = [
    ...(opts.allow.includes("raster") ? RASTER : []),
    ...(opts.allow.includes("svg") ? (["image/svg+xml"] as const) : []),
    ...(opts.allow.includes("pdf") ? (["application/pdf"] as const) : []),
  ];
  if (!mime || !allowed.includes(mime)) {
    const names = allowed.map((m) => m.split("/")[1].replace("+xml", "").toUpperCase());
    throw new UploadError(`Unsupported file type. Allowed: ${[...new Set(names)].join(", ")}.`);
  }
  if (mime === "application/pdf") return { mime, width: null, height: null, buffer };
  if (mime === "image/svg+xml") {
    const text = buffer.toString("utf8");
    if (/<script[\s>]|\son\w+\s*=|javascript:|<foreignObject/i.test(text)) {
      throw new UploadError("SVG files containing scripts, event handlers or embedded HTML are not accepted.");
    }
  }
  try {
    const meta = await sharp(buffer, { limitInputPixels: 268_402_689 }).metadata();
    if (!meta.width || !meta.height) throw new Error("no dimensions");
    // Decode every pixel (into a tiny thumbnail) so truncated or corrupt files are caught now, not at render time.
    await sharp(buffer, { limitInputPixels: 268_402_689, failOn: "truncated" }).resize(8, 8, { fit: "inside" }).raw().toBuffer();
    return { mime, width: meta.width, height: meta.height, buffer };
  } catch {
    throw new UploadError("The image could not be decoded. It may be corrupt or truncated.");
  }
}

function ratio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const d = gcd(w, h);
  if (w / d <= 50 && h / d <= 50) return `${w / d}:${h / d}`;
  return `${(w / h).toFixed(2)}:1`;
}

/** Facts measured from the file itself, reported separately from the AI's opinion. */
export async function technicalFacts(buffer: Buffer): Promise<TechnicalFacts> {
  const m = await sharp(buffer).metadata();
  const width = m.width ?? 0;
  const height = m.height ?? 0;
  return {
    width,
    height,
    format: m.format ?? "unknown",
    sizeBytes: buffer.length,
    density: m.density ?? null,
    colorSpace: m.space ?? null,
    hasAlpha: Boolean(m.hasAlpha),
    aspectRatio: width && height ? ratio(width, height) : "unknown",
    printSizeAt300: { widthMm: Math.round((width / 300) * 25.4), heightMm: Math.round((height / 300) * 25.4) },
  };
}

/**
 * Downscale for Claude vision: long edge ≤ 1568 px. Larger images are resized
 * by the API anyway, so this saves upload time and tokens without losing detail.
 */
export async function prepareForVision(
  buffer: Buffer,
  maxEdge = 1568,
): Promise<{ base64: string; mediaType: "image/png" | "image/jpeg"; width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  const usePng = Boolean(meta.hasAlpha) || meta.format === "svg";
  const pipeline = sharp(buffer, { density: 144 })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  const out = usePng
    ? await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true })
    : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { base64: out.data.toString("base64"), mediaType: usePng ? "image/png" : "image/jpeg", width: out.info.width, height: out.info.height };
}

export async function thumbnail(buffer: Buffer, edge = 480): Promise<Buffer> {
  return sharp(buffer, { density: 144 })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/** Non-destructive working copy of a downloaded photo, sized for the artboard. */
export async function preparePhoto(buffer: Buffer, maxEdge: number): Promise<{ buffer: Buffer; width: number; height: number }> {
  const out = await sharp(buffer)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/** Mean luminance (0–1) and dominant colours from a small downsample. */
export async function colorProfile(buffer: Buffer): Promise<{ luminance: number; dominantColors: string[] }> {
  const { data, info } = await sharp(buffer, { density: 72 })
    .resize(48, 48, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  let lum = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: e.n + 1, r: e.r + r, g: e.g + g, b: e.b + b });
  }
  const px = data.length / info.channels;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const dominantColors = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((e) => `#${hex(e.r / e.n)}${hex(e.g / e.n)}${hex(e.b / e.n)}`.toUpperCase());
  return { luminance: Number((lum / px).toFixed(3)), dominantColors };
}
