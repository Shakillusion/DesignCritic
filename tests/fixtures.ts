import sharp from "sharp";
import { openDatabase, setDbForTesting } from "@/lib/database/db";

/** Fresh in-memory database for the current test file. */
export function useTestDb() {
  const db = openDatabase(":memory:");
  setDbForTesting(db);
  return db;
}

/** A realistic poster-like PNG: dark field, a headline band, an image block and small text. */
export async function posterPng(width = 900, height = 1200): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1f2b3a"/>
    <rect x="60" y="80" width="${width - 120}" height="${height * 0.45}" fill="#c2462d"/>
    <text x="60" y="${height * 0.62}" font-family="Arial" font-size="84" font-weight="700" fill="#f4efe6">SUMMER</text>
    <text x="60" y="${height * 0.7}" font-family="Arial" font-size="84" font-weight="700" fill="#f4efe6">FESTIVAL</text>
    <text x="60" y="${height * 0.9}" font-family="Arial" font-size="22" fill="#6f7d8c">12–14 July · City Park · tickets online</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A landscape "photo": sky gradient over a mountain shape, as JPEG. */
export async function landscapeJpeg(width = 2400, height = 1600): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fa6c9"/><stop offset="1" stop-color="#e8eef2"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <polygon points="0,${height} ${width * 0.45},${height * 0.35} ${width * 0.6},${height * 0.5} ${width},${height * 0.25} ${width},${height}" fill="#3e5a46"/>
    <polygon points="${width * 0.45},${height * 0.35} ${width * 0.5},${height * 0.42} ${width * 0.4},${height * 0.45}" fill="#ffffff"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
