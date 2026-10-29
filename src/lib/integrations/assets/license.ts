import type { AssetLicense, LicenseVerdict } from "./types";

export const UNKNOWN_LICENSE: AssetLicense = {
  code: "unknown",
  name: "Unknown licence",
  url: null,
  commercialUse: null,
  modificationAllowed: null,
  attributionRequired: false,
  shareAlike: false,
  notes: null,
};

export const UNSPLASH_LICENSE: AssetLicense = {
  code: "unsplash",
  name: "Unsplash License",
  url: "https://unsplash.com/license",
  commercialUse: true,
  modificationAllowed: true,
  attributionRequired: false,
  shareAlike: false,
  notes:
    "Attribution not required but appreciated. Do not sell unaltered copies, do not compile photos to replicate a competing service, and do not imply endorsement by the photographer or people depicted.",
};

export const PEXELS_LICENSE: AssetLicense = {
  code: "pexels",
  name: "Pexels License",
  url: "https://www.pexels.com/license/",
  commercialUse: true,
  modificationAllowed: true,
  attributionRequired: false,
  shareAlike: false,
  notes:
    "Attribution not required but appreciated. Do not sell unaltered copies, do not imply endorsement by people or brands depicted, and do not redistribute on other stock platforms.",
};

interface CcTerms {
  nc: boolean;
  nd: boolean;
  sa: boolean;
}

function ccTerms(parts: string): CcTerms | null {
  const tokens = parts.split("-").filter(Boolean);
  if (tokens[0] !== "by" || tokens.some((t) => !["by", "sa", "nc", "nd"].includes(t))) return null;
  return { nc: tokens.includes("nc"), nd: tokens.includes("nd"), sa: tokens.includes("sa") };
}

function ccLicense(parts: string, version: string | null, url: string | null, jurisdiction?: string): AssetLicense | null {
  const t = ccTerms(parts);
  if (!t) return null;
  const slug = ["by", t.nc && "nc", t.nd && "nd", t.sa && "sa"].filter(Boolean).join("-");
  const v = version ?? "4.0";
  const juris = jurisdiction ? ` ${jurisdiction.toUpperCase()}` : "";
  return {
    code: `cc-${slug}`,
    name: `CC ${slug.toUpperCase()} ${v}${juris}`.trim(),
    url: url ?? `https://creativecommons.org/licenses/${slug}/${v}/${jurisdiction ? `${jurisdiction.toLowerCase()}/` : ""}`,
    commercialUse: !t.nc,
    modificationAllowed: !t.nd,
    attributionRequired: true,
    shareAlike: t.sa,
    notes: null,
  };
}

const publicDomain = (code: "cc0" | "pdm", url: string | null, version: string | null): AssetLicense => ({
  code,
  name: code === "cc0" ? `CC0 ${version ?? "1.0"}` : "Public Domain",
  url: url ?? (code === "cc0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : "https://creativecommons.org/publicdomain/mark/1.0/"),
  commercialUse: true,
  modificationAllowed: true,
  attributionRequired: false,
  shareAlike: false,
  notes: null,
});

/**
 * Normalise an Openverse licence code (`by-sa`, `cc0`, `pdm`, `sampling+`…) or a Wikimedia
 * `LicenseShortName` ("CC BY-SA 4.0", "Public domain", "GFDL"…). Unknown input → `unknown`.
 */
export function normalizeCcLicense(code: string, version?: string | null, url?: string | null): AssetLicense {
  const raw = code.trim().toLowerCase();
  const v = version?.trim() || null;
  const u = url?.trim() || null;
  if (!raw) return { ...UNKNOWN_LICENSE, url: u };

  if (raw === "cc0" || /^cc[- ]?zero/.test(raw) || /^cc0[ -]/.test(raw)) {
    return publicDomain("cc0", u, v ?? /(\d\.\d)/.exec(raw)?.[1] ?? null);
  }
  if (raw === "pdm" || /^(public[ -]domain|pd($|[- ])|no restrictions|no known copyright)/.test(raw)) return publicDomain("pdm", u, v);

  if (raw === "sampling+" || raw === "nc-sampling+") {
    const nc = raw.startsWith("nc");
    return {
      code: nc ? "cc-nc-sampling+" : "cc-sampling+",
      name: nc ? `CC NC-Sampling+ ${v ?? "1.0"}` : `CC Sampling+ ${v ?? "1.0"}`,
      url: u ?? `https://creativecommons.org/licenses/${raw}/${v ?? "1.0"}/`,
      // Sampling+ permits commercial sampling/transformation but not commercial use of the whole work.
      commercialUse: nc ? false : null,
      modificationAllowed: true,
      attributionRequired: true,
      shareAlike: false,
      notes: "Sampling licence: whole-work commercial use and advertising are restricted.",
    };
  }

  // Openverse short form: "by", "by-nc-sa"…
  const openverse = ccLicense(raw, v, u);
  if (openverse) return openverse;

  // Wikimedia short names: "CC BY-SA 4.0", "CC-BY-SA-3.0-DE", "CC BY 2.5 NL"
  const wm = /^cc[- ]((?:by)(?:-(?:nc|nd|sa))*)(?:[- ](\d\.\d))?(?:[- ]([a-z]{2,3}))?$/.exec(raw);
  if (wm) {
    const l = ccLicense(wm[1], v ?? wm[2] ?? null, u, wm[3]);
    if (l) return l;
  }

  if (/^gfdl/.test(raw) || raw.includes("gnu free documentation")) {
    return {
      code: "gfdl",
      name: "GNU Free Documentation License",
      url: u ?? "https://www.gnu.org/licenses/fdl-1.3.html",
      commercialUse: true,
      modificationAllowed: true,
      attributionRequired: true,
      shareAlike: true,
      notes: "Copyleft: derivatives must be released under the GFDL and include the licence text.",
    };
  }
  if (raw === "attribution" || raw === "attribution only") {
    return { code: "attribution", name: "Attribution", url: u, commercialUse: true, modificationAllowed: true, attributionRequired: true, shareAlike: false, notes: null };
  }
  return { ...UNKNOWN_LICENSE, name: code.trim() || UNKNOWN_LICENSE.name, url: u };
}

/** Map an SPDX identifier (as used by Iconify collections) to an AssetLicense. */
export function normalizeSpdxLicense(spdx: string | null | undefined, title?: string | null, url?: string | null): AssetLicense {
  const id = (spdx ?? "").trim();
  const lower = id.toLowerCase();
  const name = title?.trim() || id || UNKNOWN_LICENSE.name;
  const u = url?.trim() || null;
  const permissive = (code: string, attributionRequired = true): AssetLicense => ({
    code, name, url: u, commercialUse: true, modificationAllowed: true, attributionRequired, shareAlike: false, notes: null,
  });

  if (["mit", "apache-2.0", "isc", "bsd-2-clause", "bsd-3-clause", "unlicense"].includes(lower)) {
    return permissive(lower, lower !== "unlicense");
  }
  if (lower === "cc0-1.0") return { ...publicDomain("cc0", u, "1.0"), name };
  if (/^cc-by(-(nc|nd|sa))*-\d\.\d$/.test(lower)) {
    const m = /^cc-(by(?:-(?:nc|nd|sa))*)-(\d\.\d)$/.exec(lower);
    const l = m ? ccLicense(m[1], m[2], u) : null;
    if (l) return { ...l, name };
  }
  if (lower.startsWith("ofl-")) {
    return { ...permissive("ofl"), notes: "SIL Open Font License: may not be sold on its own; derivatives stay under OFL." };
  }
  if (/^(a|l)?gpl-/.test(lower)) {
    return {
      ...permissive(lower),
      shareAlike: true,
      notes: "Copyleft licence: derivatives may need to be released under the same licence.",
    };
  }
  if (lower === "mpl-2.0") return { ...permissive(lower), shareAlike: true, notes: "File-level copyleft." };
  return { ...UNKNOWN_LICENSE, name, url: u };
}

/** auto-ok: commercial + modification permitted and no share-alike; blocked: NC/ND; otherwise needs-review. */
export function licenseVerdict(l: AssetLicense): LicenseVerdict {
  if (l.commercialUse === false || l.modificationAllowed === false) return "blocked";
  if (l.code === "unknown" || l.commercialUse === null || l.modificationAllowed === null || l.shareAlike) return "needs-review";
  return "auto-ok";
}

/** e.g. `"Matterhorn at dawn" by Jane Doe, CC BY 4.0, via Wikimedia Commons`. */
export function buildAttribution(title: string | null, creator: string | null, providerLabel: string, license: AssetLicense): string {
  const t = title?.trim() ? `"${title.trim()}"` : "Untitled";
  const by = creator?.trim() ? ` by ${creator.trim()}` : "";
  return `${t}${by}, ${license.name}, via ${providerLabel}`;
}
