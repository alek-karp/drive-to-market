"use node";

import { v } from "convex/values";
import Exa from "exa-js";
import { action } from "./_generated/server";

/** Matches `BrandProfile` in lib/types.ts */
export type BrandProfileResult = {
  name: string;
  description: string;
  colors: string[];
  logoUrl: string | null;
  websiteUrl: string | null;
  screenshotPath: string | null;
  headlineText: string;
  keywords: string[];
  audience: string;
  offer: string;
  category: string;
  tone: string;
  differentiators: string[];
  requiredCta: string;
  mascotName: string | null;
  mascotDescription: string | null;
};

const BRAND_OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    headlineText: { type: "string" },
    category: { type: "string" },
    tone: { type: "string" },
    audience: { type: "string" },
    offer: { type: "string" },
    requiredCta: { type: "string" },
    logoUrl: { type: "string" },
    colors: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    mascotName: { type: "string" },
    mascotDescription: { type: "string" },
  },
  required: ["name", "description"],
};

type ExaBrandFields = {
  name?: string;
  description?: string;
  headlineText?: string;
  category?: string;
  tone?: string;
  audience?: string;
  offer?: string;
  requiredCta?: string;
  logoUrl?: string;
  colors?: string[];
  keywords?: string[];
  mascotName?: string;
  mascotDescription?: string;
};

/** Stage 1: URL → brand profile via Exa (contents + structured search). */
export const extractFromUrl = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }): Promise<BrandProfileResult> => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EXA_API_KEY is not set. Run: bunx convex env set EXA_API_KEY <key>",
      );
    }

    const normalizedUrl = normalizeWebsiteUrl(url);
    if (!normalizedUrl) {
      throw new Error("Invalid website URL");
    }

    const host = safeHostname(normalizedUrl);
    const fallbackName = hostToName(host);
    const exa = new Exa(apiKey);

    let pageText = "";
    let pageFavicon: string | null = null;
    let extracted: ExaBrandFields | null = null;

    // Single grounded call: text + a structured summary extracted from the
    // ACTUAL page (more reliable than a web search with outputSchema).
    try {
      const contents = await exa.getContents([normalizedUrl], {
        text: { maxCharacters: 6000 },
        summary: {
          query:
            "Extract the brand identity for a vehicle wrap. " +
            "colors: the brand's official palette as hex codes (e.g. #FF7A00), the primary/most-recognizable brand color FIRST, then secondary/accent colors — the colors used in the logo and brand identity, NOT generic page background colors. " +
            "logoUrl: a direct https URL to the company's actual logo image file (.svg/.png/.webp). Do NOT use a hero image, product screenshot, social share/og:image, or marketing banner. Omit if unknown. " +
            "mascotName: the brand's well-known mascot/character name if it has one (e.g. PostHog has 'Max the hedgehog', GitHub has 'Octocat', Duolingo has 'Duo the owl'). Omit if the brand has no real mascot. " +
            "mascotDescription: a precise visual description of that real mascot (species/character, colors, distinctive features) so it can be recreated faithfully. Omit if no real mascot.",
          schema: BRAND_OUTPUT_SCHEMA,
        },
        livecrawl: "fallback",
      });
      const page = contents.results[0];
      if (page) {
        pageText = page.text ?? "";
        // Favicon is a real brand mark; `image` is usually a hero/og screenshot,
        // so we intentionally do NOT use it as the logo.
        const extras = page as { favicon?: string; summary?: string };
        pageFavicon = normalizeUrlOrNull(extras.favicon);
        extracted = parseStructuredOutput(extras.summary);
      }
    } catch {
      extracted = null;
    }

    const name = truncate(extracted?.name?.trim() || fallbackName, 60);

    // These need web research (not just the homepage), so run dedicated searches.
    const [kitColors, mascot] = await Promise.all([
      findBrandKitColors(exa, name, host),
      findMascot(exa, name, host),
    ]);

    const description = truncate(
      collapse(
        extracted?.description ||
          pageText ||
          `${name} — brand summary from web research.`,
      ),
      200,
    );
    const headlineText = truncate(
      collapse(
        extracted?.headlineText ||
          extracted?.name ||
          firstSentence(pageText) ||
          `Welcome to ${name}`,
      ),
      120,
    );
    const keywords = sanitizeList(extracted?.keywords, 6);
    // Brand-kit hexes lead (most authoritative), then the summary's colors,
    // then any hexes spotted in the page text.
    const colors = resolveColors(
      [...kitColors, ...(extracted?.colors ?? [])],
      pageText,
    );
    // Logo/colors are finalized client-side from a real logo mark
    // (lib/brandVisuals). Pass through any explicit logo or the favicon as hints.
    const logoUrl = normalizeUrlOrNull(extracted?.logoUrl) ?? pageFavicon;

    return {
      name,
      description,
      colors,
      logoUrl,
      websiteUrl: normalizedUrl,
      screenshotPath: null,
      headlineText,
      keywords:
        keywords.length > 0 ? keywords : ["premium", "local", "fast", "modern"],
      audience:
        extracted?.audience?.trim() || "local customers ready to take action",
      offer: truncate(
        extracted?.offer?.trim() || "a clear reason to choose the brand",
        90,
      ),
      category: extracted?.category?.trim() || "business",
      tone: extracted?.tone?.trim() || "confident and approachable",
      differentiators:
        keywords.length > 0
          ? keywords.slice(0, 4)
          : ["premium", "local", "fast", "modern"],
      requiredCta: extracted?.requiredCta?.trim() || "Get Started",
      mascotName: mascot.name ?? cleanMascot(extracted?.mascotName),
      mascotDescription:
        mascot.description ?? cleanMascot(extracted?.mascotDescription),
    };
  },
});

const MASCOT_SCHEMA = {
  type: "object" as const,
  properties: {
    hasMascot: { type: "boolean" },
    mascotName: { type: "string" },
    mascotDescription: { type: "string" },
  },
  required: ["hasMascot"],
};

/**
 * Research whether a brand has a real, well-known mascot (e.g. PostHog → "Max
 * the hedgehog", GitHub → "Octocat"). Uses a web search so the model can draw
 * on knowledge beyond the brand's homepage. Returns nulls when none is found.
 */
async function findMascot(
  exa: Exa,
  name: string,
  host: string,
): Promise<{ name: string | null; description: string | null }> {
  try {
    const result = await exa.search(
      `Does the company ${name} (${host}) have an official mascot or brand character? What is its name and what does it look like?`,
      {
        type: "auto",
        numResults: 5,
        contents: {
          text: { maxCharacters: 1500 },
          highlights: {
            query: `${name} official mascot character name appearance`,
            numSentences: 3,
            highlightsPerUrl: 3,
          },
        },
        outputSchema: MASCOT_SCHEMA,
        systemPrompt:
          "Determine if the company has a REAL, officially recognized mascot or brand character. " +
          "hasMascot must be true only for an actual named mascot the company uses (not a logo, not the founder, not a generic icon). " +
          "mascotName: the mascot's name. mascotDescription: species/character, colors, and distinctive visual features. " +
          "If there is no real mascot, set hasMascot to false and omit the other fields.",
      },
    );

    const parsed = parseStructuredOutput(result.output?.content) as {
      hasMascot?: boolean;
      mascotName?: string;
      mascotDescription?: string;
    } | null;

    if (!parsed?.hasMascot) return { name: null, description: null };
    return {
      name: cleanMascot(parsed.mascotName),
      description: cleanMascot(parsed.mascotDescription),
    };
  } catch {
    return { name: null, description: null };
  }
}

/**
 * Find the brand's official palette by searching brand-guideline / press / kit
 * pages, which usually spell out exact hex codes in their text. Returns hexes
 * ordered by frequency (most-cited brand color first).
 */
async function findBrandKitColors(
  exa: Exa,
  name: string,
  host: string,
): Promise<string[]> {
  try {
    const result = await exa.search(
      `${name} (${host}) official brand guidelines color palette hex codes brand kit press`,
      {
        type: "auto",
        numResults: 4,
        contents: {
          text: { maxCharacters: 2500 },
          highlights: {
            query: "official brand colors hex codes palette",
            numSentences: 3,
            highlightsPerUrl: 3,
          },
        },
      },
    );

    const counts = new Map<string, number>();
    for (const r of result.results) {
      const haystack = `${r.text ?? ""} ${(r.highlights ?? []).join(" ")}`;
      for (const m of haystack.matchAll(
        /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
      )) {
        const hex = normalizeHex(m[0]);
        if (!hex) continue;
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([hex]) => hex)
      .filter((hex) => !isNeutral(hex))
      .slice(0, 4);
  } catch {
    return [];
  }
}

function cleanMascot(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^(none|n\/a|null|unknown|no mascot)$/i.test(text)) return null;
  return truncate(collapse(text), 240);
}

function parseStructuredOutput(content: unknown): ExaBrandFields | null {
  if (!content) return null;
  if (typeof content === "object") {
    return content as ExaBrandFields;
  }
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as ExaBrandFields;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeWebsiteUrl(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
    );
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname || /\s/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}

function hostToName(host: string): string {
  const base = host.split(".")[0] || host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function normalizeUrlOrNull(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeList(value: string[] | undefined, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const word = entry.trim().toLowerCase();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Brand palette, primary color first. Prefers the colors Exa extracted from the
 * brand identity; falls back to any hex codes found in page text, then defaults.
 * Leads with a saturated (non-neutral) brand color so the car body isn't a dull
 * black/white default.
 */
function resolveColors(
  modelColors: string[] | undefined,
  pageText: string,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const hex = normalizeHex(raw);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      ordered.push(hex);
    }
  };

  if (Array.isArray(modelColors)) {
    for (const c of modelColors) {
      if (typeof c === "string") add(c);
    }
  }

  if (ordered.length === 0) {
    for (const m of pageText.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      add(m[0]);
      if (ordered.length >= 4) break;
    }
  }

  if (ordered.length === 0) {
    return ["#F4C542", "#111111", "#FFFFFF"];
  }

  ordered.sort((a, b) => (isNeutral(a) ? 1 : 0) - (isNeutral(b) ? 1 : 0));

  if (!ordered.some(isLight)) ordered.push("#FFFFFF");
  if (!ordered.some(isDark)) ordered.push("#111111");
  return ordered.slice(0, 4);
}

function isNeutral(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

function normalizeHex(raw: string): string | null {
  const m = raw.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return `#${hex.toUpperCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 200;
}

function isDark(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 55;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function firstSentence(text: string): string | null {
  const clean = collapse(text);
  if (!clean) return null;
  const match = clean.match(/^[^.!?]+[.!?]?/);
  return match?.[0]?.trim() || null;
}
