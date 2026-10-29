/** A real item retrieved from a research source. Only these can ever be cited. */
export interface ResearchItem {
  /** Short id within one research run, e.g. "a3" (article) or "v7" (visual). Citations reference it. */
  id: string;
  kind: "article" | "visual" | "web" | "link";
  source: string;
  title: string;
  url: string;
  publishedAt: string | null;
  creator: string | null;
  summary: string;
  imageUrl: string | null;
  /** Rights note, e.g. "Public domain (The Met)" or "CC BY-SA 4.0". References are never placed in artwork. */
  rights: string | null;
}

export interface SourceError {
  source: string;
  message: string;
}
