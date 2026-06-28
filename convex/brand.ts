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
    keywords: { type: "array", items: { type: "string" } },
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
  keywords?: string[];
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
    let pageImage: string | null = null;

    try {
      const contents = await exa.getContents([normalizedUrl], {
        text: { maxCharacters: 6000 },
        highlights: {
          query: "brand logo colors tagline product mission",
          numSentences: 5,
          highlightsPerUrl: 5,
        },
        livecrawl: "fallback",
      });
      const page = contents.results[0];
      if (page) {
        pageText = page.text ?? "";
        const extras = page as { image?: string; favicon?: string };
        pageImage = extras.image ?? extras.favicon ?? null;
      }
    } catch {
      // Continue with structured search only.
    }

    let extracted: ExaBrandFields | null = null;
    try {
      const search = await exa.search(
        `${fallbackName} (${host}) company brand overview colors logo tagline`,
        {
          type: "auto",
          category: "company",
          numResults: 5,
          includeDomains: [host],
          contents: false,
          outputSchema: BRAND_OUTPUT_SCHEMA,
          systemPrompt:
            "Extract factual brand information for vehicle wrap design. logoUrl must be a direct https image URL when known; otherwise omit.",
        },
      );
      extracted = parseStructuredOutput(search.output?.content);
    } catch {
      extracted = null;
    }

    const name = truncate(extracted?.name?.trim() || fallbackName, 60);
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
    const colors = extractColors(pageText, description);

    return {
      name,
      description,
      colors,
      logoUrl: normalizeUrlOrNull(extracted?.logoUrl) ?? pageImage,
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
    };
  },
});

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

function extractColors(text: string, description: string): string[] {
  const haystack = `${text} ${description}`;
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const match of haystack.matchAll(
    /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
  )) {
    const hex = normalizeHex(match[0]);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      ordered.push(hex);
      if (ordered.length >= 4) break;
    }
  }

  if (ordered.length === 0) {
    return ["#111111", "#F4C542", "#FFFFFF"];
  }
  if (!ordered.some(isLight)) ordered.push("#FFFFFF");
  if (!ordered.some(isDark)) ordered.push("#111111");
  return ordered.slice(0, 4);
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
