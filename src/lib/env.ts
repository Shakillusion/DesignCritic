import path from "node:path";
import "server-only";

/** Server-side configuration. Secrets are only ever read here, never sent to the client. */
export const env = {
  get geminiKey() {
    return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
  },
  get groqKey() {
    return process.env.GROQ_API_KEY?.trim() || null;
  },
  get openrouterKey() {
    return process.env.OPENROUTER_API_KEY?.trim() || null;
  },
  get tavilyKey() {
    return process.env.TAVILY_API_KEY?.trim() || null;
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY?.trim() || null;
  },
  get unsplashKey() {
    return process.env.UNSPLASH_ACCESS_KEY?.trim() || null;
  },
  get pexelsKey() {
    return process.env.PEXELS_API_KEY?.trim() || null;
  },
  get dataDir() {
    // Runtime data, not source: keep the bundler from tracing the whole project through this path.
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DESIGNCRITIC_DATA_DIR?.trim() || "./data");
  },
  /** Hosted database (Turso). Unset locally: a SQLite file in dataDir is used. */
  get databaseUrl() {
    return process.env.TURSO_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
  },
  get databaseAuthToken() {
    return process.env.TURSO_AUTH_TOKEN?.trim() || null;
  },
  /** Vercel Blob file storage. Unset locally: files go under dataDir/storage. */
  get blobToken() {
    return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
  },
  /** Running on Vercel serverless functions. */
  get onVercel() {
    return process.env.VERCEL === "1";
  },
  get contact() {
    return process.env.DESIGNCRITIC_CONTACT?.trim() || "designcritic-local";
  },
  get browserPath() {
    return process.env.DESIGNCRITIC_BROWSER_PATH?.trim() || null;
  },
  get browserNoSandbox() {
    return process.env.DESIGNCRITIC_BROWSER_NO_SANDBOX === "1";
  },
  get maxUploadBytes() {
    // Vercel functions reject request bodies over 4.5 MB, so the hosted default stays under it.
    const fallback = this.onVercel ? 4 : 20;
    const mb = Number(process.env.DESIGNCRITIC_MAX_UPLOAD_MB || fallback);
    return (Number.isFinite(mb) && mb > 0 ? mb : fallback) * 1024 * 1024;
  },
};

export const userAgent = () => `DesignCriticAI/0.1 (+${env.contact})`;
