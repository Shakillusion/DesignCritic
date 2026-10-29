import { describe, expect, it } from "vitest";
import {
  buildAttribution,
  licenseVerdict,
  normalizeCcLicense,
  normalizeSpdxLicense,
  PEXELS_LICENSE,
  UNSPLASH_LICENSE,
} from "@/lib/integrations/assets/license";

describe("normalizeCcLicense — Openverse codes", () => {
  it.each([
    ["cc0", "1.0", "cc0", "auto-ok", false],
    ["pdm", "1.0", "pdm", "auto-ok", false],
    ["by", "4.0", "cc-by", "auto-ok", true],
    ["by-sa", "4.0", "cc-by-sa", "needs-review", true],
    ["by-nc", "2.0", "cc-by-nc", "blocked", true],
    ["by-nd", "3.0", "cc-by-nd", "blocked", true],
    ["by-nc-sa", "2.0", "cc-by-nc-sa", "blocked", true],
    ["by-nc-nd", "4.0", "cc-by-nc-nd", "blocked", true],
    ["sampling+", "1.0", "cc-sampling+", "needs-review", true],
    ["nc-sampling+", "1.0", "cc-nc-sampling+", "blocked", true],
    ["something-weird", null, "unknown", "needs-review", false],
  ] as const)("%s → %s / %s", (code, version, expected, verdict, attribution) => {
    const l = normalizeCcLicense(code, version);
    expect(l.code).toBe(expected);
    expect(licenseVerdict(l)).toBe(verdict);
    expect(l.attributionRequired).toBe(attribution);
  });

  it("builds a canonical CC URL and name, but prefers the provided URL", () => {
    const l = normalizeCcLicense("by-sa", "2.0");
    expect(l.name).toBe("CC BY-SA 2.0");
    expect(l.url).toBe("https://creativecommons.org/licenses/by-sa/2.0/");
    expect(l.shareAlike).toBe(true);
    expect(normalizeCcLicense("by", "4.0", "https://x.org/l").url).toBe("https://x.org/l");
  });

  it("unknown has null permissions", () => {
    const l = normalizeCcLicense("");
    expect(l).toMatchObject({ code: "unknown", commercialUse: null, modificationAllowed: null });
  });
});

describe("normalizeCcLicense — Wikimedia LicenseShortName", () => {
  it.each([
    ["CC BY-SA 4.0", "cc-by-sa", "CC BY-SA 4.0", "needs-review"],
    ["CC BY-SA 3.0 DE", "cc-by-sa", "CC BY-SA 3.0 DE", "needs-review"],
    ["CC-BY-SA-3.0", "cc-by-sa", "CC BY-SA 3.0", "needs-review"],
    ["CC BY 2.0", "cc-by", "CC BY 2.0", "auto-ok"],
    ["CC BY 4.0", "cc-by", "CC BY 4.0", "auto-ok"],
    ["CC BY-NC-SA 2.0", "cc-by-nc-sa", "CC BY-NC-SA 2.0", "blocked"],
    ["CC0", "cc0", "CC0 1.0", "auto-ok"],
    ["CC0 1.0", "cc0", "CC0 1.0", "auto-ok"],
    ["Public domain", "pdm", "Public Domain", "auto-ok"],
    ["PD-old", "pdm", "Public Domain", "auto-ok"],
    ["No restrictions", "pdm", "Public Domain", "auto-ok"],
    ["GFDL", "gfdl", "GNU Free Documentation License", "needs-review"],
    ["Attribution", "attribution", "Attribution", "auto-ok"],
    ["Copyrighted free use? Maybe", "unknown", "Copyrighted free use? Maybe", "needs-review"],
  ] as const)("%s", (short, code, name, verdict) => {
    const l = normalizeCcLicense(short);
    expect(l.code).toBe(code);
    expect(l.name).toBe(name);
    expect(licenseVerdict(l)).toBe(verdict);
  });
});

describe("provider licences", () => {
  it("Unsplash and Pexels are auto-ok with official URLs and no required attribution", () => {
    expect(licenseVerdict(UNSPLASH_LICENSE)).toBe("auto-ok");
    expect(licenseVerdict(PEXELS_LICENSE)).toBe("auto-ok");
    expect(UNSPLASH_LICENSE.url).toBe("https://unsplash.com/license");
    expect(PEXELS_LICENSE.url).toBe("https://www.pexels.com/license/");
    expect(UNSPLASH_LICENSE.attributionRequired).toBe(false);
    expect(PEXELS_LICENSE.notes).toMatch(/unaltered/);
  });
});

describe("normalizeSpdxLicense", () => {
  it.each([
    ["MIT", "mit", "auto-ok"],
    ["Apache-2.0", "apache-2.0", "auto-ok"],
    ["ISC", "isc", "auto-ok"],
    ["CC-BY-4.0", "cc-by", "auto-ok"],
    ["CC-BY-SA-4.0", "cc-by-sa", "needs-review"],
    ["CC0-1.0", "cc0", "auto-ok"],
    ["OFL-1.1", "ofl", "auto-ok"],
    ["GPL-3.0", "gpl-3.0", "needs-review"],
    ["GPL-2.0-only", "gpl-2.0-only", "needs-review"],
    ["Proprietary", "unknown", "needs-review"],
    [null, "unknown", "needs-review"],
  ] as const)("%s", (spdx, code, verdict) => {
    const l = normalizeSpdxLicense(spdx, null, null);
    expect(l.code).toBe(code);
    expect(licenseVerdict(l)).toBe(verdict);
  });
});

describe("buildAttribution", () => {
  it("formats title, creator, licence and provider", () => {
    expect(buildAttribution("Matterhorn at dawn", "Jane Doe", "Wikimedia Commons", normalizeCcLicense("CC BY 4.0"))).toBe(
      '"Matterhorn at dawn" by Jane Doe, CC BY 4.0, via Wikimedia Commons',
    );
  });
  it("handles a missing creator and title", () => {
    expect(buildAttribution(null, null, "Openverse", normalizeCcLicense("cc0"))).toBe("Untitled, CC0 1.0, via Openverse");
  });
});
