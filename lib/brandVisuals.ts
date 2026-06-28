import sharp from "sharp";
import type { BrandProfile } from "./types";

/**
 * Make a brand's logo + color palette reliable and on-brand.
 *
 * Why this exists: scraped/AI-extracted brand data often returns a hero/og
 * screenshot as the "logo" and guesses colors (frequently defaulting to black).
 * Here we resolve a real brand mark (an explicit logo/icon, else Google's
 * favicon service) and derive the palette from that image, so the painted car
 * body genuinely reflects the company's brand color.
 */
export async function enhanceBrandVisuals(
  brand: BrandProfile,
): Promise<BrandProfile> {
  const host = hostnameOf(brand.websiteUrl);
  const logoUrl = resolveLogoUrl(brand.logoUrl, host);

  const derived = logoUrl
    ? await paletteFromImage((await fetchImage(logoUrl)) ?? Buffer.alloc(0))
    : [];

  // Official brand-kit colors (from Exa) are authoritative when we actually
  // found some; otherwise fall back to colors derived from the real logo.
  const hasKitColors =
    !isDefaultPalette(brand.colors) && brand.colors.some((c) => !isNeutral(c));

  const colors = hasKitColors
    ? mergePalette(brand.colors, derived)
    : derived.length > 0
      ? mergePalette(derived, brand.colors)
      : brand.colors;

  return { ...brand, logoUrl: logoUrl ?? brand.logoUrl, colors };
}

/** The hardcoded fallback palette returned when no real colors were found. */
function isDefaultPalette(colors: string[]): boolean {
  const sentinel = ["#F4C542", "#111111", "#FFFFFF"];
  return (
    colors.length === sentinel.length &&
    colors.every((c, i) => c.toUpperCase() === sentinel[i])
  );
}

/**
 * A usable logo URL. Keeps an explicit logo/icon if the source provided one,
 * but rejects hero/og/banner screenshots, then falls back to Google's favicon
 * service (always a real brand mark, never a marketing screenshot).
 */
function resolveLogoUrl(
  current: string | null | undefined,
  host: string | null,
): string | null {
  if (current && isRealLogoUrl(current)) return current;
  if (host) return `https://www.google.com/s2/favicons?domain=${host}&sz=256`;
  return current ?? null;
}

function isRealLogoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Hero/social/share images masquerading as logos.
  if (/\b(og|hero|banner|share|screenshot|preview|cover)\b/.test(lower)) {
    return false;
  }
  if (/[?&]title=/.test(lower) || lower.includes("/api/og")) return false;
  // .ico favicons don't decode reliably for color extraction; prefer the
  // Google favicon service (PNG) instead.
  if (/\.ico(\?|$)/.test(lower)) return false;
  // Explicit logo/icon assets are trustworthy.
  if (/\b(logo|icon|brandmark|wordmark)\b/.test(lower)) return true;
  // SVGs are almost always vector brand marks.
  if (/\.svg(\?|$)/.test(lower)) return true;
  return false;
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Dominant saturated colors in a logo image, most frequent first. Neutral
 * (near-grayscale) pixels are ignored so we surface the actual brand hue.
 */
async function paletteFromImage(buf: Buffer): Promise<string[]> {
  try {
    const { data, info } = await sharp(buf)
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += channels) {
      const alpha = channels === 4 ? data[i + 3] : 255;
      if (alpha < 200) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 30) continue; // neutral
      // Quantize to merge near-identical shades into one bucket.
      const key = quantize(r, g, b);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hex]) => hex);
  } catch {
    return [];
  }
}

function quantize(r: number, g: number, b: number): string {
  const q = (c: number) => Math.round(c / 24) * 24;
  return rgbToHex(
    Math.min(q(r), 255),
    Math.min(q(g), 255),
    Math.min(q(b), 255),
  );
}

/** Primary palette leads, secondary enriches; light + dark anchors for contrast. */
function mergePalette(primary: string[], secondary: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const up = hex.toUpperCase();
    if (!seen.has(up)) {
      seen.add(up);
      ordered.push(up);
    }
  };

  for (const hex of primary) add(hex);
  for (const hex of secondary) {
    if (!isNeutral(hex)) add(hex);
  }
  if (!ordered.some(isLight)) add("#FFFFFF");
  if (!ordered.some(isDark)) add("#111111");
  return ordered.slice(0, 4);
}

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isLight(hex: string): boolean {
  return luminance(hex) > 200;
}

function isDark(hex: string): boolean {
  return luminance(hex) < 55;
}

function isNeutral(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}
