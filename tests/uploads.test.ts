import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareForVision, sniffType, technicalFacts, UploadError, validateUpload } from "@/lib/image-processing/image";
import { landscapeJpeg, posterPng } from "./fixtures";

const MB = 1024 * 1024;

describe("upload validation", () => {
  it("identifies files by content, not name", async () => {
    expect(sniffType(await posterPng())).toBe("image/png");
    expect(sniffType(await landscapeJpeg(400, 300))).toBe("image/jpeg");
    expect(sniffType(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe("application/pdf");
    expect(sniffType(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
    expect(sniffType(Buffer.from("MZ\x90\x00 this is an exe pretending"))).toBeNull();
  });

  it("accepts a real poster and returns its dimensions", async () => {
    const v = await validateUpload(await posterPng(900, 1200), { allow: ["raster"], maxBytes: 20 * MB });
    expect(v).toMatchObject({ mime: "image/png", width: 900, height: 1200 });
  });

  it("rejects oversize, empty, wrong-type and corrupt files", async () => {
    const png = await posterPng();
    await expect(validateUpload(png, { allow: ["raster"], maxBytes: 100 })).rejects.toThrow(/limit/);
    await expect(validateUpload(Buffer.alloc(0), { allow: ["raster"], maxBytes: MB })).rejects.toThrow(/empty/);
    await expect(validateUpload(Buffer.from("%PDF-1.7 ......"), { allow: ["raster"], maxBytes: MB })).rejects.toThrow(UploadError);
    const truncated = Buffer.concat([png.subarray(0, 64)]);
    await expect(validateUpload(truncated, { allow: ["raster"], maxBytes: MB })).rejects.toThrow(/decoded/);
  });

  it("rejects SVGs with scripts or event handlers", async () => {
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>');
    await expect(validateUpload(evil, { allow: ["svg"], maxBytes: MB })).rejects.toThrow(/scripts/);
    const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(validateUpload(script, { allow: ["svg"], maxBytes: MB })).rejects.toThrow(/scripts/);
    const ok = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 22 12 2l10 20z"/></svg>');
    await expect(validateUpload(ok, { allow: ["svg"], maxBytes: MB })).resolves.toMatchObject({ mime: "image/svg+xml", width: 24 });
  });

  it("measures technical facts and prepares a vision-sized copy", async () => {
    const big = await landscapeJpeg(4000, 2000);
    const t = await technicalFacts(big);
    expect(t).toMatchObject({ width: 4000, height: 2000, format: "jpeg", aspectRatio: "2:1", hasAlpha: false });
    expect(t.printSizeAt300.widthMm).toBe(339);
    const v = await prepareForVision(big);
    expect(Math.max(v.width, v.height)).toBe(1568);
    expect(v.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(v.base64, "base64")).metadata();
    expect(meta.width).toBe(1568);
  });
});
