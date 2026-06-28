import type { BrandProfile } from "./types";

/**
 * Stage 4: website -> brand profile.
 *
 * Fetches the page HTML server-side and extracts just enough brand signal to
 * generate a plausible wrap: name, description, dominant colors, a logo
 * candidate, a headline, and keywords. Deliberately lightweight (regex over the
 * raw HTML, no headless browser) per the demo plan's "do not overbuild
 * scraping" guidance.
 *
 * Reliability is the priority: any failure (bad URL, non-HTML, network/timeout,
 * bot block) falls back to a deterministic hostname-derived profile so the rest
 * of the pipeline always has something to render.
 */
export async function scrapeWebsite(url: string): Promise<BrandProfile> {
  const normalized = normalizeUrl(url);
  const host = safeHostname(normalized);
  const fallbackName = hostToName(host);

  const html = await fetchHtml(normalized);
  if (!html) return fallbackProfile(fallbackName);

  const meta = parseMeta(html);
  const name = pickName(meta, fallbackName);

  const colors = extractColors(html, meta);
  const logoUrl = extractLogo(html, meta, normalized);
  const headlineText =
    firstHeading(html) ??
    meta["og:title"] ??
    meta.title ??
    `Welcome to ${name}`;
  const description =
    meta.description ??
    meta["og:description"] ??
    `${name} — ${truncate(stripTags(headlineText), 140)}`;
  const keywords = extractKeywords(meta, html);

  return {
    name,
    description: truncate(collapse(description), 200),
    colors,
    logoUrl,
    screenshotPath: null,
    headlineText: truncate(collapse(stripTags(headlineText)), 120),
    keywords,
  };
}

/** Map of lowercased meta/og names -> content, plus a `title` key. */
type Meta = Record<string, string>;

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Many sites serve a stripped page to non-browser agents.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMeta(html: string): Meta {
  const meta: Meta = {};

  const title = matchOne(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta.title = collapse(stripTags(title));

  // <meta name|property="..." content="..."> in either attribute order.
  const tagRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(tagRe) ?? []) {
    const key = (
      attr(tag, "name") ??
      attr(tag, "property") ??
      attr(tag, "itemprop")
    )?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && !(key in meta)) meta[key] = collapse(content);
  }
  return meta;
}

function pickName(meta: Meta, fallback: string): string {
  const candidate =
    meta["og:site_name"] ??
    meta["application-name"] ??
    cleanTitle(meta.title) ??
    fallback;
  return truncate(candidate, 60);
}

/** Titles are usually "Page — Brand" or "Brand | Tagline"; take the brand-ish side. */
function cleanTitle(title?: string): string | undefined {
  if (!title) return undefined;
  const parts = title.split(/\s[|–—\-:·]\s/);
  if (parts.length < 2) return title.trim() || undefined;
  // Prefer the shorter segment — usually the brand name, not the page/tagline.
  const sorted = [...parts].map((p) => p.trim()).filter(Boolean);
  sorted.sort((a, b) => a.length - b.length);
  return sorted[0] || title.trim();
}

function extractColors(html: string, meta: Meta): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (raw?: string | null) => {
    const hex = normalizeHex(raw);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      ordered.push(hex);
    }
  };

  // Explicit brand-color hints win.
  add(meta["theme-color"]);
  add(meta["msapplication-tilecolor"]);

  // Then the most frequently used hex colors in the page's styles.
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(m[0]);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const byFrequency = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Favor a saturated, non-neutral color as the primary accent if we don't
  // already have an explicit theme color.
  if (ordered.length === 0) {
    const accent = byFrequency.find(([hex]) => !isNeutral(hex));
    if (accent) add(accent[0]);
  }
  for (const [hex] of byFrequency) {
    if (ordered.length >= 4) break;
    add(hex);
  }

  if (ordered.length === 0) return ["#111111", "#F4C542", "#FFFFFF"];
  // Ensure light + dark anchors exist so textures have contrast to work with.
  if (!ordered.some(isLight)) add("#FFFFFF");
  if (!ordered.some(isDark)) add("#111111");
  return ordered.slice(0, 4);
}

function extractLogo(html: string, meta: Meta, baseUrl: string): string | null {
  // 1. An <img> that advertises itself as a logo is the strongest signal.
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const haystack = `${attr(tag, "src") ?? ""} ${attr(tag, "alt") ?? ""} ${
      attr(tag, "class") ?? ""
    } ${attr(tag, "id") ?? ""}`.toLowerCase();
    const src = attr(tag, "src");
    if (src && haystack.includes("logo")) return absolutize(src, baseUrl);
  }

  // 2. Apple touch icon / og:image are decent, reasonably large fallbacks.
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (href && rel.includes("apple-touch-icon"))
      return absolutize(href, baseUrl);
  }
  if (meta["og:image"]) return absolutize(meta["og:image"], baseUrl);

  // 3. Last resort: a regular favicon.
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = attr(tag, "href");
    if (href && rel.includes("icon")) return absolutize(href, baseUrl);
  }
  return null;
}

function extractKeywords(meta: Meta, html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (word: string) => {
    const w = word.trim().toLowerCase();
    if (w.length >= 3 && w.length <= 24 && !STOP_WORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  };

  if (meta.keywords) {
    for (const k of meta.keywords.split(",")) add(k);
  }
  // Supplement from the most prominent headings.
  if (out.length < 4) {
    for (const h of headings(html).slice(0, 6)) {
      for (const word of stripTags(h).split(/\s+/))
        add(word.replace(/[^a-z0-9]/gi, ""));
      if (out.length >= 6) break;
    }
  }
  if (out.length === 0) return ["premium", "local", "fast", "modern"];
  return out.slice(0, 6);
}

// --- small HTML helpers -----------------------------------------------------

function firstHeading(html: string): string | undefined {
  return headings(html)[0];
}

function headings(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) {
    const text = collapse(stripTags(m[1]));
    if (text) out.push(text);
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = tag.match(re);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

function matchOne(html: string, re: RegExp): string | undefined {
  return html.match(re)?.[1];
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " "));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// --- url + color helpers ----------------------------------------------------

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
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

function normalizeHex(raw?: string | null): string | null {
  if (!raw) return null;
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

/** Near-grayscale (low saturation) colors make weak brand accents. */
function isNeutral(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 24;
}

function fallbackProfile(name: string): BrandProfile {
  return {
    name,
    description: `${name} — brand summary unavailable (site could not be read); using defaults.`,
    colors: ["#111111", "#F4C542", "#FFFFFF"],
    logoUrl: null,
    screenshotPath: null,
    headlineText: `Welcome to ${name}`,
    keywords: ["premium", "local", "fast", "modern"],
  };
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "our",
  "with",
  "from",
  "this",
  "that",
  "are",
  "was",
  "home",
  "welcome",
  "page",
  "more",
  "all",
  "get",
  "new",
]);
