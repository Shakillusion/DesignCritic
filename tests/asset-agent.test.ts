import { describe, expect, it } from "vitest";
import { queryVariants, wikimediaRendition } from "@/agents/asset-agent";
import type { AssetCandidate } from "@/lib/integrations/assets/types";

const wiki = (width: number, height: number): AssetCandidate => ({
  provider: "wikimedia",
  providerId: "1",
  type: "photo",
  title: "Lake",
  creator: null,
  creatorUrl: null,
  sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Lake.jpg",
  downloadUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f9/Lake.jpg",
  thumbnailUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Lake.jpg/960px-Lake.jpg?utm_source=x",
  width,
  height,
  mime: "image/jpeg",
  license: { code: "cc0", name: "CC0", url: null, commercialUse: true, modificationAllowed: true, attributionRequired: false, shareAlike: false, notes: null },
  attribution: null,
});

describe("asset agent helpers", () => {
  it("broadens keyword queries by dropping mood words and trailing terms", () => {
    expect(queryVariants("Swiss alpine lake reflection summer")).toEqual(["Swiss alpine lake reflection summer", "Swiss alpine lake", "Swiss alpine", "Swiss landscape"]);
  });

  it("picks the smallest standard Wikimedia width that covers the artboard", () => {
    // 6000×4000 landscape cropped into a 1200×1800 portrait needs a 2700px-wide rendition → 3840 step.
    expect(wikimediaRendition(wiki(6000, 4000), { width: 1200, height: 1800 })).toEqual({ url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Lake.jpg/3840px-Lake.jpg", width: 3840 });
    // 4000×6000 portrait into the same artboard needs 1200px → 1280 step.
    expect(wikimediaRendition(wiki(4000, 6000), { width: 1200, height: 1800 })?.width).toBe(1280);
    // Original already smaller than the needed step: use the original.
    expect(wikimediaRendition(wiki(1000, 1500), { width: 1200, height: 1800 })).toBeNull();
  });
});
