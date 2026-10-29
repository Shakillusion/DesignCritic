import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn<(url: string, opts?: { headers?: Record<string, string>; accept?: string[] }) => Promise<unknown>>();
vi.mock("@/lib/net/safe-fetch", () => ({ safeFetchJson: (url: string, opts?: never) => fetchJson(url, opts) }));

import { searchAssets, providerStatus } from "@/lib/integrations/assets";
import { iconifyProvider } from "@/lib/integrations/assets/iconify";
import { licenseVerdict } from "@/lib/integrations/assets/license";
import { openverseProvider } from "@/lib/integrations/assets/openverse";
import { pexelsProvider } from "@/lib/integrations/assets/pexels";
import { trackUnsplashDownload, unsplashProvider } from "@/lib/integrations/assets/unsplash";
import { wikimediaProvider } from "@/lib/integrations/assets/wikimedia";

const OPENVERSE = {
  result_count: 2,
  page_count: 1,
  results: [
    {
      id: "4bc43a04-ef46-4544-a0c1-63c63f56e276",
      title: "Matterhorn at dawn",
      foreign_landing_url: "https://www.flickr.com/photos/jdoe/123",
      url: "https://live.staticflickr.com/65535/123_abc_b.jpg",
      creator: "Jane Doe",
      creator_url: "https://www.flickr.com/photos/jdoe",
      license: "by",
      license_version: "2.0",
      license_url: "https://creativecommons.org/licenses/by/2.0/",
      provider: "flickr",
      source: "flickr",
      category: "photograph",
      filesize: null,
      filetype: "jpg",
      tags: [{ name: "alps" }],
      attribution: "ignored",
      height: 1024,
      width: 683,
      thumbnail: "https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/thumb/",
      detail_url: "https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/",
    },
    { id: "no-url", title: "Broken", url: null, license: "cc0", license_version: "1.0" },
  ],
};

const WIKIMEDIA = {
  batchcomplete: "",
  query: {
    pages: {
      "222": {
        pageid: 222,
        ns: 6,
        title: "File:Second result.png",
        index: 2,
        imagetype: "bitmap",
        imageinfo: [
          {
            width: 800,
            height: 1200,
            thumburl: "https://upload.wikimedia.org/thumb/second.png/640px-second.png",
            url: "https://upload.wikimedia.org/second.png",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Second_result.png",
            mime: "image/png",
            extmetadata: { LicenseShortName: { value: "CC0" } },
          },
        ],
      },
      "111": {
        pageid: 111,
        ns: 6,
        title: "File:Matterhorn from Zermatt.jpg",
        index: 1,
        imageinfo: [
          {
            size: 4_000_000,
            width: 3000,
            height: 4000,
            thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/M.jpg/640px-M.jpg",
            thumbwidth: 640,
            thumbheight: 853,
            url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/M.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Matterhorn_from_Zermatt.jpg",
            mime: "image/jpeg",
            extmetadata: {
              ObjectName: { value: "Matterhorn from Zermatt", source: "commons-desc-page" },
              LicenseShortName: { value: "CC BY-SA 4.0", source: "commons-desc-page" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0", source: "commons-desc-page" },
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Zacharie">Zacharie &amp; Co</a>', source: "commons-desc-page" },
              AttributionRequired: { value: "true", source: "commons-desc-page" },
            },
          },
        ],
      },
      "333": {
        pageid: 333,
        title: "File:Diagram.svg",
        index: 3,
        imageinfo: [{ url: "https://upload.wikimedia.org/d.svg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Diagram.svg", mime: "image/svg+xml", width: 100, height: 100 }],
      },
      "444": {
        pageid: 444,
        title: "File:Wide nc.jpg",
        index: 4,
        imageinfo: [
          {
            url: "https://upload.wikimedia.org/wide.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Wide_nc.jpg",
            mime: "image/jpeg",
            width: 2000,
            height: 1000,
            extmetadata: { LicenseShortName: { value: "CC BY-NC 2.0" } },
          },
        ],
      },
    },
  },
};

const UNSPLASH = {
  total: 1,
  total_pages: 1,
  results: [
    {
      id: "eOLpJytrbsQ",
      width: 4000,
      height: 6000,
      color: "#a6a6a6",
      description: "Snowy peak",
      alt_description: "white and black mountain under blue sky",
      urls: {
        raw: "https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.0.3",
        full: "https://images.unsplash.com/photo-1?full",
        regular: "https://images.unsplash.com/photo-1?w=1080",
        small: "https://images.unsplash.com/photo-1?w=400",
        thumb: "https://images.unsplash.com/photo-1?w=200",
      },
      links: {
        self: "https://api.unsplash.com/photos/eOLpJytrbsQ",
        html: "https://unsplash.com/photos/eOLpJytrbsQ",
        download: "https://unsplash.com/photos/eOLpJytrbsQ/download",
        download_location: "https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc",
      },
      user: { id: "u1", username: "jeffk", name: "Jeff Sheldon", links: { html: "https://unsplash.com/@jeffk" } },
    },
  ],
};

const PEXELS = {
  total_results: 2,
  page: 1,
  per_page: 2,
  photos: [
    {
      id: 2014422,
      width: 3024,
      height: 3024,
      url: "https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/",
      photographer: "Joey Farina",
      photographer_url: "https://www.pexels.com/@joey",
      photographer_id: 680589,
      avg_color: "#978E82",
      src: {
        original: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg",
        large2x: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?w=1880",
        medium: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?h=350",
      },
      alt: "Brown Rocks During Golden Hour",
    },
    {
      id: 5,
      width: 10,
      height: 10,
      url: "https://www.pexels.com/photo/5/",
      photographer: "",
      src: { large2x: "https://images.pexels.com/photos/5/p.png?w=1880", medium: "https://images.pexels.com/photos/5/p.png?h=350" },
      alt: "",
    },
  ],
};

const ICONIFY = {
  icons: ["mdi:mountain", "tabler:mountain", "gpl-set:peak", "weird:icon"],
  total: 4,
  limit: 32,
  start: 0,
  collections: {
    mdi: { name: "Material Design Icons", total: 7000, author: { name: "Pictogrammers", url: "https://github.com/Templarian/MaterialDesign" }, license: { title: "Apache 2.0", spdx: "Apache-2.0", url: "https://github.com/Templarian/MaterialDesign/blob/master/LICENSE" } },
    tabler: { name: "Tabler Icons", author: { name: "Paweł Kuna" }, license: { title: "MIT", spdx: "MIT" } },
    "gpl-set": { name: "GPL Set", license: { title: "GPL 3.0", spdx: "GPL-3.0" } },
  },
};

beforeEach(() => {
  fetchJson.mockReset();
  delete process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.PEXELS_API_KEY;
});
afterEach(() => {
  delete process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.PEXELS_API_KEY;
});

describe("openverse", () => {
  it("builds the query and maps results", async () => {
    fetchJson.mockResolvedValueOnce(OPENVERSE);
    const res = await openverseProvider.search("swiss alps", { orientation: "portrait", perPage: 5, commercialOnly: true });
    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(url.searchParams.get("q")).toBe("swiss alps");
    expect(url.searchParams.get("page_size")).toBe("5");
    expect(url.searchParams.get("license_type")).toBe("commercial,modification");
    expect(url.searchParams.get("aspect_ratio")).toBe("tall");
    expect(fetchJson.mock.calls[0][1]?.accept).toEqual(["application/json"]);

    expect(res).toHaveLength(1); // result without url skipped
    expect(res[0]).toMatchObject({
      provider: "openverse",
      providerId: "4bc43a04-ef46-4544-a0c1-63c63f56e276",
      type: "photo",
      title: "Matterhorn at dawn",
      creator: "Jane Doe",
      creatorUrl: "https://www.flickr.com/photos/jdoe",
      sourcePageUrl: "https://www.flickr.com/photos/jdoe/123",
      downloadUrl: "https://live.staticflickr.com/65535/123_abc_b.jpg",
      thumbnailUrl: "https://api.openverse.org/v1/images/4bc43a04-ef46-4544-a0c1-63c63f56e276/thumb/",
      width: 683,
      height: 1024,
      mime: "image/jpeg",
      license: { code: "cc-by", name: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/", attributionRequired: true },
    });
    expect(res[0].attribution).toBe('"Matterhorn at dawn" by Jane Doe, CC BY 2.0, via flickr (Openverse)');
  });

  it("rejects malformed responses", async () => {
    fetchJson.mockResolvedValueOnce({ results: [{ nope: true }] });
    await expect(openverseProvider.search("x", {})).rejects.toThrow();
  });
});

describe("wikimedia", () => {
  it("builds the query, maps extmetadata and filters mime/orientation/licence", async () => {
    fetchJson.mockResolvedValueOnce(WIKIMEDIA);
    const res = await wikimediaProvider.search("matterhorn", { orientation: "portrait", perPage: 5, commercialOnly: true });
    const url = new URL(fetchJson.mock.calls[0][0]);
    expect(url.hostname).toBe("commons.wikimedia.org");
    expect(url.searchParams.get("generator")).toBe("search");
    expect(url.searchParams.get("gsrnamespace")).toBe("6");
    expect(url.searchParams.get("gsrsearch")).toBe("matterhorn filetype:bitmap");
    expect(url.searchParams.get("iiprop")).toBe("url|size|mime|extmetadata");
    expect(url.searchParams.get("iiurlwidth")).toBe("640");

    // svg (mime) and wide NC (orientation + licence) dropped; order restored from `index`.
    expect(res.map((c) => c.providerId)).toEqual(["111", "222"]);
    expect(res[0]).toMatchObject({
      provider: "wikimedia",
      type: "photo",
      title: "Matterhorn from Zermatt",
      creator: "Zacharie & Co",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Matterhorn_from_Zermatt.jpg",
      downloadUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/M.jpg",
      thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/M.jpg/640px-M.jpg",
      width: 3000,
      height: 4000,
      mime: "image/jpeg",
      license: { code: "cc-by-sa", url: "https://creativecommons.org/licenses/by-sa/4.0", attributionRequired: true, shareAlike: true },
    });
    expect(licenseVerdict(res[0].license)).toBe("needs-review");
    expect(res[0].attribution).toBe('"Matterhorn from Zermatt" by Zacharie & Co, CC BY-SA 4.0, via Wikimedia Commons');
    expect(res[1]).toMatchObject({ title: "Second result", creator: null, license: { code: "cc0" } });
  });

  it("handles an empty search (no `query` key)", async () => {
    fetchJson.mockResolvedValueOnce({ batchcomplete: "" });
    expect(await wikimediaProvider.search("zzzz", {})).toEqual([]);
  });
});

describe("unsplash", () => {
  it("is unconfigured without a key and throws on search", async () => {
    expect(unsplashProvider.isConfigured()).toBe(false);
    expect(unsplashProvider.setupHint).toMatch(/UNSPLASH_ACCESS_KEY/);
    await expect(unsplashProvider.search("x", {})).rejects.toThrow(/UNSPLASH_ACCESS_KEY/);
  });

  it("sends auth headers and maps photos", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key";
    fetchJson.mockResolvedValueOnce(UNSPLASH);
    const res = await unsplashProvider.search("alps", { orientation: "square", perPage: 3 });
    const [calledUrl, opts] = fetchJson.mock.calls[0];
    const url = new URL(calledUrl);
    expect(url.origin + url.pathname).toBe("https://api.unsplash.com/search/photos");
    expect(url.searchParams.get("orientation")).toBe("squarish");
    expect(url.searchParams.get("per_page")).toBe("3");
    expect(opts?.headers).toEqual({ Authorization: "Client-ID test-key", "Accept-Version": "v1" });

    const c = res[0];
    const dl = new URL(c.downloadUrl);
    expect(dl.origin + dl.pathname).toBe("https://images.unsplash.com/photo-1");
    expect(Object.fromEntries(dl.searchParams)).toMatchObject({ ixid: "abc", w: "3000", q: "85", fm: "jpg" });
    expect(c).toMatchObject({
      provider: "unsplash",
      providerId: "eOLpJytrbsQ",
      title: "white and black mountain under blue sky",
      creator: "Jeff Sheldon",
      creatorUrl: "https://unsplash.com/@jeffk?utm_source=designcritic&utm_medium=referral",
      sourcePageUrl: "https://unsplash.com/photos/eOLpJytrbsQ?utm_source=designcritic&utm_medium=referral",
      thumbnailUrl: "https://images.unsplash.com/photo-1?w=400",
      width: 4000,
      height: 6000,
      license: { code: "unsplash" },
      attribution: "Photo by Jeff Sheldon on Unsplash",
      trackDownloadUrl: "https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc",
    });
    expect(licenseVerdict(c.license)).toBe("auto-ok");
  });

  it("trackUnsplashDownload calls the endpoint with auth and refuses foreign hosts", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key";
    fetchJson.mockResolvedValueOnce({ url: "https://images.unsplash.com/x" });
    await trackUnsplashDownload("https://api.unsplash.com/photos/eOLpJytrbsQ/download?ixid=abc");
    expect(fetchJson.mock.calls[0][1]?.headers?.Authorization).toBe("Client-ID test-key");
    await expect(trackUnsplashDownload("https://evil.example/x")).rejects.toThrow();
  });
});

describe("pexels", () => {
  it("sends auth header and maps photos", async () => {
    process.env.PEXELS_API_KEY = "pk";
    fetchJson.mockResolvedValueOnce(PEXELS);
    const res = await pexelsProvider.search("rocks", { orientation: "square", perPage: 2 });
    const [calledUrl, opts] = fetchJson.mock.calls[0];
    const url = new URL(calledUrl);
    expect(url.origin + url.pathname).toBe("https://api.pexels.com/v1/search");
    expect(url.searchParams.get("orientation")).toBe("square");
    expect(opts?.headers).toEqual({ Authorization: "pk" });
    expect(res[0]).toMatchObject({
      provider: "pexels",
      providerId: "2014422",
      title: "Brown Rocks During Golden Hour",
      creator: "Joey Farina",
      creatorUrl: "https://www.pexels.com/@joey",
      sourcePageUrl: "https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/",
      downloadUrl: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg",
      thumbnailUrl: "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?h=350",
      width: 3024,
      height: 3024,
      mime: "image/jpeg",
      license: { code: "pexels", url: "https://www.pexels.com/license/" },
    });
    // falls back to large2x when original missing
    expect(res[1]).toMatchObject({ downloadUrl: "https://images.pexels.com/photos/5/p.png?w=1880", mime: "image/png", title: "Untitled", creator: null });
  });
});

describe("iconify", () => {
  it("maps icons with collection licences", async () => {
    fetchJson.mockResolvedValueOnce(ICONIFY);
    const res = await iconifyProvider.search("mountain", { perPage: 10 });
    expect(new URL(fetchJson.mock.calls[0][0]).searchParams.get("query")).toBe("mountain");
    expect(res).toHaveLength(4);
    expect(res[0]).toMatchObject({
      provider: "iconify",
      providerId: "mdi:mountain",
      type: "icon",
      title: "mountain",
      creator: "Pictogrammers",
      downloadUrl: "https://api.iconify.design/mdi/mountain.svg",
      thumbnailUrl: "https://api.iconify.design/mdi/mountain.svg",
      sourcePageUrl: "https://icon-sets.iconify.design/mdi/mountain/",
      width: null,
      height: null,
      mime: "image/svg+xml",
      license: { code: "apache-2.0", name: "Apache 2.0" },
    });
    expect(licenseVerdict(res[0].license)).toBe("auto-ok");
    expect(licenseVerdict(res[1].license)).toBe("auto-ok"); // MIT
    expect(licenseVerdict(res[2].license)).toBe("needs-review"); // GPL
    expect(res[2].license).toMatchObject({ commercialUse: true, modificationAllowed: true, shareAlike: true });
    expect(res[3].license.code).toBe("unknown"); // collection missing
  });

  it("commercialOnly drops unknown-licence icons", async () => {
    fetchJson.mockResolvedValueOnce(ICONIFY);
    const res = await iconifyProvider.search("mountain", { commercialOnly: true });
    expect(res.map((c) => c.providerId)).toEqual(["mdi:mountain", "tabler:mountain", "gpl-set:peak"]);
  });
});

describe("searchAssets", () => {
  it("skips unconfigured providers, records per-provider errors and de-duplicates", async () => {
    const dup = { ...OPENVERSE, results: [OPENVERSE.results[0], { ...OPENVERSE.results[0], id: "dup" }] };
    fetchJson.mockImplementation(async (url: string) => {
      if (url.includes("openverse")) return dup;
      if (url.includes("wikimedia")) throw new Error("HTTP 503 from commons.wikimedia.org");
      throw new Error(`unexpected ${url}`);
    });
    const { candidates, errors } = await searchAssets("alps", { kinds: ["photo"], perPage: 5 });
    expect(candidates.map((c) => c.providerId)).toEqual(["4bc43a04-ef46-4544-a0c1-63c63f56e276"]);
    expect(errors).toEqual([{ provider: "wikimedia", message: "HTTP 503 from commons.wikimedia.org" }]);
    // iconify not queried for photo kinds; unsplash/pexels unconfigured
    expect(fetchJson.mock.calls.map(([u]) => new URL(u).hostname).sort()).toEqual(["api.openverse.org", "commons.wikimedia.org"]);
  });

  it("respects the providers filter and reports status", async () => {
    fetchJson.mockResolvedValue(ICONIFY);
    const { candidates } = await searchAssets("mountain", { providers: ["iconify"] });
    expect(candidates.every((c) => c.provider === "iconify")).toBe(true);
    const status = providerStatus();
    expect(status.find((s) => s.id === "unsplash")).toMatchObject({ configured: false });
    expect(status.find((s) => s.id === "openverse")).toMatchObject({ configured: true, setupHint: null });
  });
});
