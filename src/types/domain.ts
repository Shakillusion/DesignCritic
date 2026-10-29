/**
 * Domain types shared by server and client. Database rows are mapped to these
 * shapes in lib/database/repo.ts; nothing here touches secrets.
 */
import type { DesignDocument } from "@/lib/design-engine/schema";
import type { CritiqueResult, ImprovementPlan } from "@/agents/design-critic/schema";
import type { QaReport } from "@/agents/qa-inspector/types";
import type { AssetLicense } from "@/lib/integrations/assets/types";

/** How a brand rule may be treated by the agents. */
export type RuleLock = "locked" | "flexible" | "inspirational";

export interface BrandColor {
  name: string;
  hex: string;
  role: string; // primary, secondary, accent, neutral, background…
  lock: RuleLock;
}

export interface BrandFont {
  role: string; // display, body, accent…
  family: string;
  weights: string;
  notes: string;
  lock: RuleLock;
}

export interface BrandRestriction {
  text: string;
  lock: RuleLock;
}

export interface Brand {
  id: string;
  name: string;
  description: string;
  industry: string;
  audience: string;
  personality: string;
  photographyStyle: string;
  graphicElements: string;
  colors: BrandColor[];
  typography: BrandFont[];
  restrictions: BrandRestriction[];
  logoFileIds: string[];
  referenceFileIds: string[];
  guidelineFileIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BrandChange {
  id: string;
  brandId: string;
  summary: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  brandId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  brandName: string | null;
  critiqueCount: number;
  designCount: number;
  assetCount: number;
  coverFileId: string | null;
}

export type FileKind =
  | "upload"
  | "guideline"
  | "logo"
  | "reference"
  | "render"
  | "asset-original"
  | "asset-prepared"
  | "thumbnail";

export interface StoredFile {
  id: string;
  projectId: string | null;
  brandId: string | null;
  kind: FileKind;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export type AssetType = "photo" | "illustration" | "vector" | "icon" | "texture" | "logo" | "other";
export type AssetStatus = "approved" | "rejected" | "pending";

export interface AssetAnalysis {
  /** 0–1 focal point of the main subject. */
  focalX?: number;
  focalY?: number;
  /** Where clean space for type exists. */
  negativeSpace?: "left" | "right" | "top" | "bottom" | "center" | "none";
  dominantColors?: string[];
  luminance?: number; // 0–1 mean brightness
  description?: string;
  selectionReason?: string;
  score?: number;
}

export interface Asset {
  id: string;
  projectId: string;
  fileId: string;
  preparedFileId: string | null;
  type: AssetType;
  source: "provider" | "upload";
  provider: string | null;
  providerId: string | null;
  title: string;
  creator: string | null;
  creatorUrl: string | null;
  sourceUrl: string | null;
  license: AssetLicense;
  attribution: string | null;
  status: AssetStatus;
  locked: boolean;
  analysis: AssetAnalysis;
  retrievedAt: string | null;
  createdAt: string;
  width: number | null;
  height: number | null;
  mime: string;
  usageCount: number;
}

export interface CritiqueContext {
  purpose?: string;
  audience?: string;
  medium?: string;
  creativeIntent?: string;
  notes?: string;
}

export interface TechnicalFacts {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  density: number | null;
  colorSpace: string | null;
  hasAlpha: boolean;
  aspectRatio: string;
  printSizeAt300: { widthMm: number; heightMm: number };
}

export type FindingDecision = "pending" | "accepted" | "rejected";

export interface Critique {
  id: string;
  projectId: string;
  fileId: string;
  designVersionId: string | null;
  brandId: string | null;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  model: string;
  context: CritiqueContext;
  technical: TechnicalFacts | null;
  result: CritiqueResult | null;
  overallScore: number | null;
  decisions: Record<string, FindingDecision>;
  improvementPlan: ImprovementPlan | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Design {
  id: string;
  projectId: string;
  name: string;
  brief: Record<string, unknown>;
  currentVersionId: string | null;
  /** Set when the design was rebuilt from an uploaded image. */
  sourceFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignVersion {
  id: string;
  designId: string;
  number: number;
  parentVersionId: string | null;
  document: DesignDocument;
  renderFileId: string | null;
  qa: QaReport | null;
  critiqueId: string | null;
  changeSummary: string;
  createdBy: "agent" | "user";
  approved: boolean;
  createdAt: string;
  /** Agent edits applied to produce this version (empty for user saves). */
  changes: AppliedChange[];
}

export interface AppliedChange {
  findingId: string | null;
  layerId: string;
  op: "update" | "add" | "remove" | "reorder";
  reason: string;
  /** Property names that changed (update ops). */
  fields: string[];
}

export interface ChatMessage {
  id: string;
  projectId: string;
  designId: string | null;
  role: "user" | "assistant";
  content: string;
  action: { type: string; jobId?: string; versionId?: string; status?: string; detail?: string } | null;
  createdAt: string;
}

export interface JobStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
}

export interface Job {
  id: string;
  projectId: string | null;
  type: "critique" | "create-design" | "improvement-plan" | "brand-extract" | "design-critique" | "apply-fixes" | "rebuild" | "research" | "directions";
  status: "queued" | "running" | "succeeded" | "failed";
  steps: JobStep[];
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CritiqueStrictness = "gentle" | "balanced" | "strict";
export type AssetMode = "automatic" | "uploaded";

export interface Preferences {
  /** Which AI service answers. Free providers by default; Claude is optional and paid. */
  aiProvider: "gemini" | "groq" | "openrouter" | "anthropic";
  /** Model per provider; "auto" picks the best free vision model available. */
  aiModels: Record<"gemini" | "groq" | "openrouter" | "anthropic", string>;
  /** On rate limits or outages, try the other configured free providers. */
  aiFallback: boolean;
  critiqueStrictness: CritiqueStrictness;
  creativityLevel: "conservative" | "balanced" | "experimental";
  brandStrictness: "strict" | "balanced" | "loose";
  assetMode: AssetMode;
  preferredStyles: string;
  preferredFormats: string[];
  researchDepth: "light" | "standard" | "deep";
  /** RSS/Atom feeds the Research Studio reads; empty = the built-in list. */
  researchFeeds: string[];
  requireApproval: boolean;
  qaMaxIterations: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  aiProvider: "gemini",
  aiModels: { gemini: "auto", groq: "auto", openrouter: "auto", anthropic: "claude-opus-5-5" },
  aiFallback: true,
  critiqueStrictness: "balanced",
  creativityLevel: "balanced",
  brandStrictness: "strict",
  assetMode: "automatic",
  preferredStyles: "",
  preferredFormats: ["png", "pdf"],
  researchDepth: "standard",
  researchFeeds: [],
  requireApproval: true,
  qaMaxIterations: 2,
};
