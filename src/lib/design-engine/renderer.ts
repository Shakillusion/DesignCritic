import "server-only";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { env } from "@/lib/env";
import { errorFields, logger } from "@/lib/logger";

/**
 * Headless-browser renderer for design HTML (see render-html.ts).
 * Uses a system Chromium-family browser via playwright-core; one browser is
 * launched lazily and reused, each render gets its own isolated context.
 */

export class RendererUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererUnavailableError";
  }
}

export interface RenderSize {
  width: number;
  height: number;
  /** deviceScaleFactor, default 1 */
  scale?: number;
  timeoutMs?: number;
}

export interface LayerMeasurement {
  id: string;
  type: "text" | "image" | "shape";
  role: string | null;
  /** getBoundingClientRect of the layer relative to the artboard (axis-aligned, includes rotation). */
  box: { x: number; y: number; w: number; h: number };
  /** Text only: the inner text node's rect clipped to the layer box (where glyphs actually sit). */
  contentBox: { x: number; y: number; w: number; h: number } | null;
  /** For text: natural height/width of the inner text node; otherwise the layer element's own scroll size. */
  scrollHeight: number;
  scrollWidth: number;
  /** Size of the layer box (layout size, unaffected by rotation). */
  clientHeight: number;
  clientWidth: number;
  naturalWidth?: number;
  naturalHeight?: number;
  fontFamily?: string;
  /** Text only: the requested face is loaded (no fallback font in use). */
  fontLoaded?: boolean;
  missingAsset: boolean;
}

const CANDIDATES: Record<string, string[]> = {
  win32: [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ...(process.env.LOCALAPPDATA ? [`${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`] : []),
  ],
  darwin: [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
};

const exists = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Resolve the browser executable, or null if none is found. Throws if DESIGNCRITIC_BROWSER_PATH points nowhere. */
export function findBrowserExecutable(): string | null {
  const override = env.browserPath;
  if (override) {
    if (exists(override)) return override;
    throw new RendererUnavailableError(`DESIGNCRITIC_BROWSER_PATH is set to "${override}" but no file exists there.`);
  }
  return (CANDIDATES[process.platform] ?? CANDIDATES.linux).find(exists) ?? null;
}

// Survive Next.js dev HMR: keep the browser on globalThis instead of module scope.
const g = globalThis as typeof globalThis & { __dcBrowser?: Promise<Browser> | null; __dcExitHook?: boolean };

/** On Vercel there is no system browser: unpack the slim serverless Chromium bundled with the app. */
async function serverlessChromium(): Promise<{ executablePath: string; args: string[] }> {
  const { default: Chromium } = await import("@sparticuz/chromium");
  Chromium.setGraphicsMode = false; // no WebGL needed, and it skips unpacking SwiftShader
  return { executablePath: await Chromium.executablePath(), args: Chromium.args };
}

async function launch(): Promise<Browser> {
  if (env.onVercel) {
    const started = Date.now();
    const { executablePath, args } = await serverlessChromium();
    const browser = await chromium.launch({ executablePath, headless: true, args: [...args, "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", "--mute-audio"] });
    browser.on("disconnected", () => {
      g.__dcBrowser = null;
    });
    logger.info("renderer.browser_launched", { executablePath, serverless: true, ms: Date.now() - started });
    return browser;
  }
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new RendererUnavailableError(
      "No Chromium-based browser found for rendering. Install Microsoft Edge or Google Chrome, or set " +
        "DESIGNCRITIC_BROWSER_PATH to a Chrome/Edge/Chromium executable.",
    );
  }
  const started = Date.now();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    // Containers usually lack the user namespaces Chromium's sandbox needs; the Docker image opts out explicitly.
    args: ["--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", "--mute-audio", "--no-first-run", ...(env.browserNoSandbox ? ["--no-sandbox"] : [])],
  });
  browser.on("disconnected", () => {
    g.__dcBrowser = null;
  });
  logger.info("renderer.browser_launched", { executablePath, ms: Date.now() - started });
  return browser;
}

/** Lazily launched shared browser. Concurrent callers share the same pending launch. */
export function getBrowser(): Promise<Browser> {
  if (!g.__dcBrowser) {
    const p = launch();
    g.__dcBrowser = p;
    p.catch(() => {
      if (g.__dcBrowser === p) g.__dcBrowser = null; // allow retry after a failed launch
    });
    if (!g.__dcExitHook) {
      g.__dcExitHook = true;
      // playwright also kills launched browsers on exit/SIGINT/SIGTERM; this closes cleanly when the loop drains.
      process.once("beforeExit", () => void closeRenderer());
    }
  }
  return g.__dcBrowser;
}

export async function closeRenderer(): Promise<void> {
  const p = g.__dcBrowser;
  g.__dcBrowser = null;
  if (!p) return;
  try {
    await (await p).close();
  } catch (err) {
    logger.warn("renderer.close_failed", errorFields(err));
  }
}

// Small concurrency limiter so a burst of exports doesn't open dozens of pages.
const MAX_PAGES = 4;
let active = 0;
const queue: (() => void)[] = [];
async function acquire(): Promise<() => void> {
  if (active >= MAX_PAGES) await new Promise<void>((r) => queue.push(r));
  active++;
  return () => {
    active--;
    queue.shift()?.();
  };
}

const READY_SCRIPT = (timeoutMs: number) => `(async () => {
  const imgs = Array.prototype.slice.call(document.images);
  const loaded = Promise.all(imgs.map(function (img) {
    if (img.complete) return null;
    return new Promise(function (r) { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); });
  }));
  await Promise.race([Promise.all([loaded, document.fonts.ready]), new Promise(function (r) { setTimeout(r, ${Math.max(0, Math.round(timeoutMs))}); })]);
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  return true;
})()`;

/** Open one page with the HTML loaded, fonts and images settled, then run `fn`. The context is always closed. */
export async function withPage<T>(html: string, size: RenderSize, fn: (page: Page) => Promise<T>): Promise<T> {
  const timeout = size.timeoutMs ?? 20_000;
  const browser = await getBrowser();
  const release = await acquire();
  const context = await browser.newContext({
    viewport: { width: Math.ceil(size.width), height: Math.ceil(size.height) },
    deviceScaleFactor: size.scale ?? 1,
    javaScriptEnabled: true, // needed for our own measurement scripts; the HTML itself has none
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    try {
      await page.setContent(html, { waitUntil: "networkidle", timeout });
    } catch (err) {
      // Usually an unreachable font/image host; render with whatever loaded.
      logger.warn("renderer.set_content_timeout", errorFields(err));
    }
    await page.evaluate(READY_SCRIPT(Math.min(timeout, 10_000)));
    return await fn(page);
  } finally {
    await context.close().catch(() => undefined);
    release();
  }
}

export async function screenshotArtboard(page: Page, size: { width: number; height: number }): Promise<Buffer> {
  return page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: size.width, height: size.height },
    omitBackground: false,
    animations: "disabled",
    caret: "hide",
  });
}

export async function renderToPng(html: string, size: RenderSize): Promise<Buffer> {
  return withPage(html, size, (page) => screenshotArtboard(page, size));
}

export async function renderToPdf(html: string, size: { width: number; height: number; timeoutMs?: number }): Promise<Buffer> {
  return withPage(html, size, async (page) => {
    await page.emulateMedia({ media: "screen" });
    return page.pdf({
      width: `${size.width}px`,
      height: `${size.height}px`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      preferCSSPageSize: false,
      pageRanges: "1",
    });
  });
}

const MEASURE_SCRIPT = `(() => {
  const art = document.getElementById("artboard");
  const ar = art.getBoundingClientRect();
  const rel = function (r) { return { x: r.left - ar.left, y: r.top - ar.top, w: r.width, h: r.height }; };
  const faceLoaded = function (family, weight, style) {
    let ok = false;
    document.fonts.forEach(function (f) {
      if (f.status === "loaded" && f.family.replace(/["']/g, "") === family && f.style === style) {
        const parts = String(f.weight).split(" ").map(Number);
        const lo = parts[0], hi = parts.length > 1 ? parts[1] : parts[0];
        if (weight >= lo && weight <= hi) ok = true;
      }
    });
    return ok;
  };
  return Array.prototype.map.call(art.querySelectorAll("[data-layer-id]"), function (el) {
    const type = el.getAttribute("data-layer-type");
    const r = el.getBoundingClientRect();
    const m = {
      id: el.getAttribute("data-layer-id"), type: type, role: el.getAttribute("data-role"),
      box: rel(r), contentBox: null,
      scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight, clientWidth: el.clientWidth,
      missingAsset: el.getAttribute("data-missing-asset") === "true"
    };
    if (type === "text") {
      const t = el.querySelector(".t");
      if (t) {
        m.scrollHeight = t.scrollHeight;
        m.scrollWidth = t.scrollWidth;
        const tr = t.getBoundingClientRect();
        const x1 = Math.max(tr.left, r.left), y1 = Math.max(tr.top, r.top);
        const x2 = Math.min(tr.right, r.right), y2 = Math.min(tr.bottom, r.bottom);
        m.contentBox = rel({ left: x1, top: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) });
      }
      const family = el.getAttribute("data-font-family") || "";
      const weight = Number(el.getAttribute("data-font-weight") || 400);
      const style = el.getAttribute("data-font-style") || "normal";
      const size = Number(el.getAttribute("data-font-size") || 16);
      m.fontFamily = family;
      // fonts.check() alone returns true when no @font-face matches at all, so also require a loaded face.
      m.fontLoaded = faceLoaded(family, weight, style) && document.fonts.check(style + " " + weight + " " + size + 'px "' + family + '"');
    } else if (type === "image") {
      const img = el.querySelector("img");
      const aw = Number(el.getAttribute("data-asset-width") || 0), ah = Number(el.getAttribute("data-asset-height") || 0);
      if (img && img.naturalWidth > 0) { m.naturalWidth = img.naturalWidth; m.naturalHeight = img.naturalHeight; }
      else if (aw && ah) { m.naturalWidth = aw; m.naturalHeight = ah; }
      if (img && img.complete && img.naturalWidth === 0) m.missingAsset = true; // broken image URL
    }
    return m;
  });
})()`;

export async function measureInPage(page: Page): Promise<LayerMeasurement[]> {
  return page.evaluate<LayerMeasurement[]>(MEASURE_SCRIPT);
}

export async function measureLayers(html: string, size: { width: number; height: number; timeoutMs?: number }): Promise<LayerMeasurement[]> {
  return withPage(html, size, measureInPage);
}
