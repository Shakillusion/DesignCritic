import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as projects from "@/app/api/projects/route";
import * as project from "@/app/api/projects/[id]/route";
import * as uploads from "@/app/api/uploads/route";
import * as files from "@/app/api/files/[id]/route";
import * as critiques from "@/app/api/critiques/route";
import * as critique from "@/app/api/critiques/[id]/route";
import * as report from "@/app/api/critiques/[id]/report/route";
import * as brands from "@/app/api/brands/route";
import * as brand from "@/app/api/brands/[id]/route";
import * as jobs from "@/app/api/jobs/[id]/route";
import { getJob, updateCritique } from "@/lib/database/repo";
import { CritiqueResult, finalizeCritique } from "@/agents/design-critic/schema";
import { posterPng, useTestDb } from "./fixtures";

const req = (url: string, init?: { method?: string; json?: unknown }) =>
  new NextRequest(new URL(url, "http://localhost"), {
    method: init?.method ?? "GET",
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route contexts are typed per route
const ctx = (params: Record<string, string>): any => ({ params: Promise.resolve(params) });

beforeAll(async () => {
  await useTestDb();
});

describe("API routes", () => {
  let projectId = "";
  let fileId = "";

  it("creates and validates projects", async () => {
    const bad = await projects.POST(req("/api/projects", { method: "POST", json: { name: "" } }));
    expect(bad.status).toBe(400);
    const res = await projects.POST(req("/api/projects", { method: "POST", json: { name: "Festival", description: "Summer poster" } }));
    expect(res.status).toBe(201);
    projectId = (await res.json()).project.id;
    const list = await (await projects.GET()).json();
    expect(list.projects).toHaveLength(1);
    const notFound = await project.GET(req("/api/projects/prj_0000000000000000"), ctx({ id: "prj_0000000000000000" }));
    expect(notFound.status).toBe(404);
    const invalidId = await project.GET(req("/api/projects/../../etc"), ctx({ id: "../../etc" }));
    expect(invalidId.status).toBe(400);
  });

  it("persists a brand and attaches it", async () => {
    const res = await brands.POST(req("/api/brands", { method: "POST", json: { name: "City Fest", colors: [{ name: "Night", hex: "#1f2b3a", role: "background", lock: "locked" }] } }));
    const b = (await res.json()).brand;
    expect(b.colors[0].hex).toBe("#1F2B3A");
    const badHex = await brand.PATCH(req(`/api/brands/${b.id}`, { method: "PATCH", json: { colors: [{ name: "x", hex: "red", role: "", lock: "locked" }] } }), ctx({ id: b.id }));
    expect(badHex.status).toBe(400);
    const p = await project.PATCH(req(`/api/projects/${projectId}`, { method: "PATCH", json: { brandId: b.id } }), ctx({ id: projectId }));
    expect((await p.json()).project.brandId).toBe(b.id);
  });

  it("uploads a real image and serves it with safe headers", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(await posterPng())], "poster.jpg", { type: "image/jpeg" }));
    form.append("purpose", "critique");
    form.append("projectId", projectId);
    const res = await uploads.POST(new Request("http://localhost/api/uploads", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    const f = (await res.json()).file;
    expect(f).toMatchObject({ mime: "image/png", width: 900, height: 1200 }); // detected from bytes, not the .jpg name
    fileId = f.id;
    const served = await files.GET(req(`/api/files/${f.id}`), ctx({ id: f.id }));
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    const thumb = await files.GET(req(`/api/files/${f.id}?thumb=200`), ctx({ id: f.id }));
    expect(thumb.headers.get("content-type")).toBe("image/webp");

    const exe = new FormData();
    exe.append("file", new File([new TextEncoder().encode("MZ fake executable bytes....")], "x.png"));
    exe.append("purpose", "critique");
    exe.append("projectId", projectId);
    expect((await uploads.POST(new Request("http://localhost/api/uploads", { method: "POST", body: exe }))).status).toBe(400);
  });

  it("queues a critique and fails it honestly when Claude isn't configured", async () => {
    const res = await critiques.POST(req("/api/critiques", { method: "POST", json: { projectId, fileId, context: { purpose: "Sell tickets" } } }));
    expect(res.status).toBe(202);
    const { critique: c, job } = await res.json();
    let j = await getJob("local-user", job.id);
    for (let i = 0; i < 100 && (j.status === "queued" || j.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 50));
      j = await getJob("local-user", job.id);
    }
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/GEMINI_API_KEY/);
    const after = await (await critique.GET(req(`/api/critiques/${c.id}`), ctx({ id: c.id }))).json();
    expect(after.critique.status).toBe("failed");
    expect(after.critique.technical).toMatchObject({ width: 900, height: 1200 });
    const polled = await (await jobs.GET(req(`/api/jobs/${job.id}`), ctx({ id: job.id }))).json();
    expect(polled.job.steps[0].status).toBe("done");
  });

  it("saves decisions and exports a report from a stored result", async () => {
    const res = await critiques.POST(req("/api/critiques", { method: "POST", json: { projectId, fileId } }));
    const { critique: c } = await res.json();
    await new Promise((r) => setTimeout(r, 300));
    // Simulate a completed critique (the AI call itself is covered in ai-client.test.ts).
    const raw = CritiqueResult.parse({
      summary: "Strong headline, weak details.",
      observedContent: { visibleText: ["SUMMER"], description: "Poster" },
      inferredContext: { purpose: "p", audience: "a", medium: "m", creativeIntent: "c" },
      categoryScores: [{ category: "communication", score: 70, rationale: "ok" }],
      findings: [{ id: "f1", title: "Low-contrast details", category: "color", severity: "major", kind: "objective", affectedElement: "Footer", region: { x: 0.1, y: 0.85, width: 0.7, height: 0.05 }, description: "d", whyItMatters: "w", recommendation: "r", confidence: "high", intentionalPossibility: null }],
      strengths: [],
      productionNotes: [],
    });
    const { result, overall } = finalizeCritique(raw, { hasBrand: true });
    await updateCritique("local-user", c.id, { status: "succeeded", result, overallScore: overall, decisions: { f1: "pending" } });

    const patched = await critique.PATCH(req(`/api/critiques/${c.id}`, { method: "PATCH", json: { decisions: { f1: "accepted", bogus: "accepted" } } }), ctx({ id: c.id }));
    expect((await patched.json()).critique.decisions).toEqual({ f1: "accepted" });

    const html = await report.GET(req(`/api/critiques/${c.id}/report?format=html`), ctx({ id: c.id }));
    const body = await html.text();
    expect(html.headers.get("content-disposition")).toMatch(/attachment; filename="critique-.*\.html"/);
    expect(body).toContain("Low-contrast details");
    expect(body).toContain("data:image/png;base64,");
    const md = await (await report.GET(req(`/api/critiques/${c.id}/report?format=md`), ctx({ id: c.id }))).text();
    expect(md).toContain("## Overall score: 70/100");
  });

  it("deletes a project and its files", async () => {
    const res = await project.DELETE(req(`/api/projects/${projectId}`, { method: "DELETE" }), ctx({ id: projectId }));
    expect(res.status).toBe(200);
    expect((await files.GET(req(`/api/files/${fileId}`), ctx({ id: fileId }))).status).toBe(404);
  });
});
