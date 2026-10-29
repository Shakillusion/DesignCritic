import { CATEGORY_META } from "@/agents/design-critic/schema";
import type { Brand, Critique, Project, StoredFile } from "@/types/domain";

/** Export & Production agent: critique reports as standalone HTML, Markdown or JSON. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SEV_COLOR = { critical: "#C2362D", major: "#C77414", minor: "#3566C4", suggestion: "#6E6862" } as const;

export interface ReportInput {
  critique: Critique;
  project: Project;
  brand: Brand | null;
  file: StoredFile;
  imageDataUri: string;
}

function decisionLabel(c: Critique, id: string) {
  const d = c.decisions[id] ?? "pending";
  return d === "accepted" ? "Accepted" : d === "rejected" ? "Rejected" : "Open";
}

export function reportMarkdown({ critique, project, brand, file }: ReportInput): string {
  const r = critique.result;
  if (!r) return `# ${critique.title}\n\nThis critique has no result (status: ${critique.status}).\n`;
  const lines: string[] = [
    `# Design critique — ${critique.title}`,
    "",
    `Project: ${project.name}${brand ? ` · Brand: ${brand.name}` : ""} · File: ${file.originalName} (${file.width}×${file.height})`,
    `Reviewed ${new Date(critique.completedAt ?? critique.createdAt).toLocaleString("en-GB")} by ${critique.model}`,
    "",
    `## Overall score: ${critique.overallScore ?? "–"}/100`,
    "",
    "Heuristic score: a weighted mean of the category scores below (weights in brackets). It is an expert estimate, not an objective measurement.",
    "",
    r.summary,
    "",
    "## Category scores",
    "",
    ...r.categoryScores.map((s) => `- **${CATEGORY_META[s.category].label}** [${CATEGORY_META[s.category].weight}]: ${s.score ?? "n/a"} — ${s.rationale}`),
    "",
    "## Findings",
    "",
  ];
  for (const f of r.findings) {
    lines.push(
      `### ${f.id}. ${f.title}`,
      `${f.severity.toUpperCase()} · ${f.kind} · ${CATEGORY_META[f.category].label} · confidence ${f.confidence} · ${decisionLabel(critique, f.id)}`,
      "",
      `**Element:** ${f.affectedElement}`,
      "",
      `**Problem:** ${f.description}`,
      "",
      `**Why it matters:** ${f.whyItMatters}`,
      "",
      `**Recommendation:** ${f.recommendation}`,
      ...(f.intentionalPossibility ? ["", `**Could be intentional:** ${f.intentionalPossibility}`] : []),
      "",
    );
  }
  lines.push("## Strengths to preserve", "", ...r.strengths.map((s) => `- **${s.title}** — ${s.description}`), "");
  if (r.productionNotes.length) lines.push("## Production notes", "", ...r.productionNotes.map((n) => `- ${n}`), "");
  if (critique.improvementPlan) {
    const p = critique.improvementPlan;
    lines.push("## Improvement plan", "", p.goal, "", "Preserve:", ...p.preserve.map((x) => `- ${x}`), "");
    for (const s of [...p.steps].sort((a, b) => a.order - b.order)) {
      lines.push(`${s.order}. **${s.title}** (impact ${s.impact}, effort ${s.effort}${s.feasibleOnRaster ? "" : ", needs editable source"}) — ${s.action}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function reportHtml(input: ReportInput): string {
  const { critique, project, brand, file, imageDataUri } = input;
  const r = critique.result;
  const title = `Design critique — ${critique.title}`;
  if (!r) return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><p>No result.</p>`;
  const markers = r.findings
    .map((f, i) =>
      f.region
        ? `<div class="m" style="left:${f.region.x * 100}%;top:${f.region.y * 100}%;width:${f.region.width * 100}%;height:${f.region.height * 100}%;border-color:${SEV_COLOR[f.severity]}"><span style="background:${SEV_COLOR[f.severity]}">${i + 1}</span></div>`
        : "",
    )
    .join("");
  const findings = r.findings
    .map(
      (f, i) => `<article class="f">
  <header><span class="n" style="background:${SEV_COLOR[f.severity]}">${i + 1}</span><h3>${esc(f.title)}</h3></header>
  <p class="meta">${esc(f.severity)} · ${esc(f.kind)} · ${esc(CATEGORY_META[f.category].label)} · confidence ${esc(f.confidence)} · ${decisionLabel(critique, f.id)}</p>
  <p><b>Element</b> ${esc(f.affectedElement)}</p>
  <p><b>Problem</b> ${esc(f.description)}</p>
  <p><b>Why it matters</b> ${esc(f.whyItMatters)}</p>
  <p class="rec"><b>Recommendation</b> ${esc(f.recommendation)}</p>
  ${f.intentionalPossibility ? `<p class="meta"><b>Could be intentional</b> ${esc(f.intentionalPossibility)}</p>` : ""}
</article>`,
    )
    .join("");
  const cats = r.categoryScores
    .map(
      (s) => `<div class="c"><div class="cl"><span>${esc(CATEGORY_META[s.category].label)} <i>×${CATEGORY_META[s.category].weight}</i></span><b>${s.score ?? "n/a"}</b></div>
<div class="bar"><div style="width:${s.score ?? 0}%"></div></div><p>${esc(s.rationale)}</p></div>`,
    )
    .join("");
  const plan = critique.improvementPlan
    ? `<section><h2>Improvement plan</h2><p>${esc(critique.improvementPlan.goal)}</p><ol>${[...critique.improvementPlan.steps]
        .sort((a, b) => a.order - b.order)
        .map((s) => `<li><b>${esc(s.title)}</b> — ${esc(s.action)} <span class="meta">(impact ${s.impact}, effort ${s.effort})</span></li>`)
        .join("")}</ol></section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--ink:#1A1816;--muted:#6E6862;--line:#E7E1D8;--bg:#FAF8F5;--accent:#6D5BF6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1080px;margin:0 auto;padding:48px 24px}h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:20px;margin:40px 0 14px}h3{font-size:16px;margin:0}
.meta{color:var(--muted);font-size:13px}.top{display:grid;grid-template-columns:1.1fr 1fr;gap:32px;align-items:start}
.art{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}.art img{display:block;width:100%}
.m{position:absolute;border:2px solid;border-radius:4px}.m span{position:absolute;top:-11px;left:-11px;width:22px;height:22px;border-radius:50%;color:#fff;font:600 12px/22px Inter,sans-serif;text-align:center}
.score{font-size:64px;font-weight:700;letter-spacing:-.04em;line-height:1}.c{margin:0 0 14px}.cl{display:flex;justify-content:space-between;font-size:14px}.cl i{color:var(--muted);font-style:normal}
.bar{height:6px;background:var(--line);border-radius:3px;margin:6px 0}.bar div{height:100%;background:var(--accent);border-radius:3px}.c p{margin:0;color:var(--muted);font-size:13px}
.f{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:0 0 12px}.f header{display:flex;gap:10px;align-items:center}
.n{width:24px;height:24px;border-radius:50%;color:#fff;font:600 12px/24px Inter,sans-serif;text-align:center;flex:none}.f p{margin:8px 0 0}.rec{background:#F3F1FE;border-radius:8px;padding:10px 12px}
@media (max-width:800px){.top{grid-template-columns:1fr}}@media print{body{background:#fff}.f{break-inside:avoid}}
</style></head><body><main>
<p class="meta">DesignCritic AI · ${esc(project.name)}${brand ? ` · ${esc(brand.name)}` : ""}</p>
<h1>${esc(critique.title)}</h1>
<p class="meta">${esc(file.originalName)} · ${file.width}×${file.height}px · reviewed ${esc(new Date(critique.completedAt ?? critique.createdAt).toLocaleString("en-GB"))} by ${esc(critique.model)}</p>
<div class="top"><div class="art"><img src="${imageDataUri}" alt="Reviewed design">${markers}</div>
<div><div class="score">${critique.overallScore ?? "–"}<span style="font-size:20px;color:var(--muted)">/100</span></div>
<p class="meta">Heuristic score: the weighted mean of the category scores (weights shown as ×n). An expert estimate, not an objective measurement.</p>
<p>${esc(r.summary)}</p>${cats}</div></div>
<section><h2>Findings</h2>${findings}</section>
<section><h2>Strengths to preserve</h2><ul>${r.strengths.map((s) => `<li><b>${esc(s.title)}</b> — ${esc(s.description)}</li>`).join("")}</ul></section>
${r.productionNotes.length ? `<section><h2>Production notes</h2><ul>${r.productionNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}
${plan}
</main></body></html>`;
}
