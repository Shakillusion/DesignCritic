import { z } from "zod";

/** Request-body schemas for the API routes. All user input is validated here. */

const text = (max: number) => z.string().trim().max(max);
const id = z.string().regex(/^[a-z]{3}_[0-9a-z]{16}$/, "Invalid id");
export const IdParam = id;

export const ProjectCreate = z.object({
  name: text(120).min(1, "Name is required"),
  description: text(2000).optional(),
  brandId: id.nullable().optional(),
});

export const ProjectUpdate = z.object({
  name: text(120).min(1).optional(),
  description: text(2000).optional(),
  brandId: id.nullable().optional(),
});

const Lock = z.enum(["locked", "flexible", "inspirational"]);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #1A1816");

export const BrandFields = z.object({
  name: text(120).min(1, "Name is required"),
  description: text(4000),
  industry: text(200),
  audience: text(1000),
  personality: text(1000),
  photographyStyle: text(2000),
  graphicElements: text(2000),
  colors: z.array(z.object({ name: text(80), hex: Hex.transform((h) => h.toUpperCase()), role: text(80), lock: Lock })).max(40),
  typography: z.array(z.object({ role: text(80), family: text(120).min(1), weights: text(120), notes: text(500), lock: Lock })).max(20),
  restrictions: z.array(z.object({ text: text(500).min(1), lock: Lock })).max(60),
  logoFileIds: z.array(id).max(20),
  referenceFileIds: z.array(id).max(60),
  guidelineFileIds: z.array(id).max(20),
});
export const BrandCreate = BrandFields.partial().extend({ name: text(120).min(1, "Name is required") });
export const BrandUpdate = BrandFields.partial().extend({ changeSummary: text(300).optional() });

export const CritiqueCreate = z.object({
  projectId: id,
  fileId: id,
  title: text(160).optional(),
  context: z
    .object({
      purpose: text(500).optional(),
      audience: text(500).optional(),
      medium: text(300).optional(),
      creativeIntent: text(1000).optional(),
      notes: text(2000).optional(),
    })
    .default({}),
});

export const CritiqueUpdate = z.object({
  title: text(160).optional(),
  decisions: z.record(z.string().max(20), z.enum(["pending", "accepted", "rejected"])).optional(),
});

export const PreferencesUpdate = z
  .object({
    aiProvider: z.enum(["gemini", "groq", "openrouter", "anthropic"]),
    aiModels: z.object({ gemini: text(120), groq: text(120), openrouter: text(160), anthropic: text(60) }),
    aiFallback: z.boolean(),
    critiqueStrictness: z.enum(["gentle", "balanced", "strict"]),
    creativityLevel: z.enum(["conservative", "balanced", "experimental"]),
    brandStrictness: z.enum(["strict", "balanced", "loose"]),
    assetMode: z.enum(["automatic", "uploaded"]),
    preferredStyles: text(1000),
    preferredFormats: z.array(z.enum(["png", "jpg", "pdf", "html", "svg"])).max(5),
    researchDepth: z.enum(["light", "standard", "deep"]),
    researchFeeds: z.array(z.string().url().max(400)).max(20),
    requireApproval: z.boolean(),
    qaMaxIterations: z.number().int().min(0).max(3),
  })
  .partial();

export const AssetUpdate = z.object({
  status: z.enum(["approved", "rejected", "pending"]).optional(),
  locked: z.boolean().optional(),
});

export const AssetSearch = z.object({
  query: text(200).min(2),
  kinds: z.array(z.enum(["photo", "illustration", "vector", "icon"])).optional(),
  orientation: z.enum(["landscape", "portrait", "square"]).optional(),
});

export const AssetImport = z.object({
  projectId: id,
  candidate: z.object({
    provider: z.enum(["openverse", "wikimedia", "unsplash", "pexels", "iconify"]),
    providerId: text(300),
  }),
  query: text(200),
});

export const DesignGenerate = z.object({
  projectId: id,
  brief: text(4000).min(10, "Describe the design in at least a sentence."),
  preset: text(60),
  customSize: z.object({ width: z.number().int().min(100).max(8000), height: z.number().int().min(100).max(8000) }).nullable().optional(),
  headline: text(200).optional(),
  supportingCopy: text(1000).optional(),
  cta: text(120).optional(),
  audience: text(500).optional(),
  style: text(500).optional(),
  creativeFreedom: z.enum(["conservative", "balanced", "experimental"]).optional(),
  variations: z.number().int().min(1).max(3).default(1),
  assetMode: z.enum(["automatic", "uploaded"]),
  uploadedAssetIds: z.array(id).max(6).default([]),
  referenceFileIds: z.array(id).max(4).default([]),
});

export const VersionSave = z.object({
  document: z.unknown(),
  changeSummary: text(300).min(1),
  baseVersionId: id,
});
