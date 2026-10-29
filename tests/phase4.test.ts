import { beforeEach, describe, expect, it } from "vitest";
import { parseFeed } from "@/lib/integrations/research/feeds";
import { validateBrief, validateDirections } from "@/agents/research/schema";
import { rankArticles } from "@/lib/services/research";
import { createMoodboard, getMoodboard, insertReference, listReferences, saveMoodboard, saveResearchRun, listResearchRuns } from "@/lib/database/research-repo";
import { createProject, deleteProject, insertFile } from "@/lib/database/repo";
import { useTestDb } from "./fixtures";

const RSS = `<?xml version="1.0"?><rss><channel><title>Dezeen</title>
<item><title>Montana acquires &amp; renews Takt</title><link>https://www.dezeen.com/2026/10/29/montana-takt/</link>
<dc:creator><![CDATA[Jennifer Hahn]]></dc:creator><pubDate>Thu, 29 Oct 2026 10:30:00 +0000</pubDate>
<description><![CDATA[<p>Montana has announced its buyout of Takt.</p><p>The post <a href="x">Montana</a> appeared first on Dezeen.</p>]]></description>
<content:encoded><![CDATA[<img src="https://static.dezeen.com/a.jpg" alt="">]]></content:encoded></item>
<item><title>No link item</title></item>
<item><title>Abduzeedo style</title><link>https://abduzeedo.com/x/</link><description>Assembly Coffee pairs &lt;b&gt;serif&lt;/b&gt; type&#039;s contrast</description><pubDate>Thu, 29 Oct 2026 13:52:52 GMT</pubDate><enclosure url="https://cms.abduzeedo.com/hero.jpg" type="image/jpeg"/></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Swiss poster revival</title><link href="https://example.org/swiss"/><published>2026-09-01T08:00:00Z</published><summary>Grids are back.</summary><author><name>A. Writer</name></author></entry></feed>`;

describe("feed parsing", () => {
  it("parses RSS items with CDATA, entities, dates, creators and images; skips items without links", () => {
    const items = parseFeed(RSS, "Dezeen");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Montana acquires & renews Takt", url: "https://www.dezeen.com/2026/10/29/montana-takt/", creator: "Jennifer Hahn", imageUrl: "https://static.dezeen.com/a.jpg", publishedAt: "2026-10-29T10:30:00.000Z", kind: "article" });
    expect(items[0].summary).toBe("Montana has announced its buyout of Takt.");
    expect(items[1]).toMatchObject({ imageUrl: "https://cms.abduzeedo.com/hero.jpg", summary: "Assembly Coffee pairs serif type's contrast" });
  });
  it("parses Atom entries", () => {
    expect(parseFeed(ATOM, "Example")[0]).toMatchObject({ title: "Swiss poster revival", url: "https://example.org/swiss", publishedAt: "2026-09-01T08:00:00.000Z", summary: "Grids are back." });
  });
});

describe("no fabricated sources", () => {
  it("strips citations that don't exist and labels insights left without evidence", () => {
    const b = validateBrief(
      {
        summary: "s",
        insights: [
          { title: "Grids", category: "established", explanation: "e", citations: ["a1", "a99", "a1"] },
          { title: "Invented", category: "emerging", explanation: "made up", citations: ["x7"] },
        ],
        recommended: [{ itemId: "v1", why: "w" }, { itemId: "ghost", why: "w" }],
        gaps: "g",
      },
      new Set(["a1", "v1"]),
    );
    expect(b.insights).toEqual([{ title: "Grids", category: "established", explanation: "e", citations: ["a1"] }]);
    expect(b.uncited).toEqual([{ title: "Invented", explanation: "made up" }]);
    expect(b.recommended.map((r) => r.itemId)).toEqual(["v1"]);
  });
  it("drops inspiration links to unknown references and invalid colours", () => {
    const [d] = validateDirections([{ name: "n", idea: "i", composition: "c", typography: "t", palette: ["#abcdef", "red", "#123"], imagery: "im", avoid: [], inspiredBy: [{ refId: "ref_ok", principle: "p" }, { refId: "ref_fake", principle: "p" }] }], new Set(["ref_ok"]));
    expect(d.palette).toEqual(["#ABCDEF"]);
    expect(d.inspiredBy.map((x) => x.refId)).toEqual(["ref_ok"]);
  });
});

describe("article ranking", () => {
  it("puts topical, recent coverage first", () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const ranked = rankArticles(
      [
        { title: "Furniture fair", summary: "chairs", publishedAt: now },
        { title: "Tourism campaign for the Alps", summary: "travel poster with editorial type", publishedAt: old },
        { title: "Travel poster trends", summary: "tourism", publishedAt: now },
      ],
      { topic: "tourism poster", industry: "travel", direction: "editorial" },
      2,
    );
    expect(ranked.map((r) => r.title)).toEqual(["Tourism campaign for the Alps", "Travel poster trends"]);
  });
});

describe("references and moodboards", () => {
  const U = "local-user";
  beforeEach(async () => await useTestDb());
  const ref = async (projectId: string, url: string, fileId: string | null = null) =>
    await insertReference(U, { projectId, kind: "visual", source: "The Met", title: "Poster", url, publishedAt: null, creator: null, summary: "", rights: "Public domain", fileId, palette: ["#112233"], researchRunId: null });

  it("de-duplicates by URL per project and keeps boards ordered", async () => {
    const p = await createProject(U, { name: "P" });
    const a = await ref(p.id, "https://met/1");
    expect((await ref(p.id, "https://met/1")).id).toBe(a.id);
    const b = await ref(p.id, "https://met/2");
    const board = await createMoodboard(U, { projectId: p.id, name: "Board", refIds: [a.id, b.id] });
    expect(board.items.map((i) => i.ref.id)).toEqual([a.id, b.id]);
    const saved = await saveMoodboard(U, board.id, { notes: "calm", items: [{ refId: b.id, size: "l", note: "hero" }, { refId: a.id, size: "s", note: "" }] });
    expect(saved.items.map((i) => [i.ref.id, i.size, i.note])).toEqual([[b.id, "l", "hero"], [a.id, "s", ""]]);
    expect((await getMoodboard(U, board.id)).notes).toBe("calm");
  });

  it("refuses references from another project on a board", async () => {
    const p1 = await createProject(U, { name: "P1" });
    const p2 = await createProject(U, { name: "P2" });
    const foreign = await ref(p2.id, "https://x/1");
    await expect(createMoodboard(U, { projectId: p1.id, name: "B", refIds: [foreign.id] })).rejects.toThrow(/another project/);
  });

  it("deleting a project removes research, references (and their preview files) and boards", async () => {
    const p = await createProject(U, { name: "P" });
    const f = await insertFile(U, { projectId: p.id, kind: "reference", originalName: "r.webp", mime: "image/webp", size: 1, storagePath: "x/r.webp", sha256: "s" });
    const r = await ref(p.id, "https://met/9", f.id);
    await createMoodboard(U, { projectId: p.id, name: "B", refIds: [r.id] });
    await saveResearchRun(U, { projectId: p.id, query: { topic: "t", industry: "", direction: "" }, items: [], brief: null, sourceErrors: [] });
    const paths = await deleteProject(U, p.id);
    expect(paths).toContain("x/r.webp");
    const p2 = await createProject(U, { name: "P2" });
    expect(await listReferences(U, p2.id)).toEqual([]);
    expect(await listResearchRuns(U, p2.id)).toEqual([]);
  });
});
