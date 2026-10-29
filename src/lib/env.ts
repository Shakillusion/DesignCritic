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
    return path.resolve(process.cwd(), process.env.DESIGNCRITIC_DATA_DIR?.trim() || "./data");
  },
  get contact() {
    return process.env.DESIGNCRITIC_CONTACT?.trim() || "designcritic-local";
  },
  get browserPath() {
    return process.env.DESIGNCRITIC_BROWSER_PATH?.trim() || null;
  },
  get maxUploadBytes() {
    const mb = Number(process.env.DESIGNCRITIC_MAX_UPLOAD_MB || 20);
    return (Number.isFinite(mb) && mb > 0 ? mb : 20) * 1024 * 1024;
  },
};

export const userAgent = () => `DesignCriticAI/0.1 (+${env.contact})`;
