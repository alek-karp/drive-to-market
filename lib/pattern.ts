import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrandProfile, Pattern, PatternType } from "./types";

/**
 * Stage 3: BrandProfile -> Pattern (type selection + SVG texture generation).
 *
 * Selects a PatternType that fits the brand's category and tone, then
 * generates a tileable SVG overlay. The pattern sits on top of the Stage 2
 * base color — it sets the vibe, not the message.
 *
 * SVG is written to public/textures/generated/<brandSlug>/pattern.svg so
 * Stage 6 composition (Sharp) and Three.js can consume it as a URL.
 */
export async function derivePattern(brand: BrandProfile): Promise<Pattern> {
  const type = selectPatternType(brand);
  if (type === "none") return { type, textureUrl: "" };

  const palette = resolvePalette(brand.colors);
  const svg = renderPattern(type, palette);
  const textureUrl = await writePatternTexture(slug(brand.name), svg);

  return { type, textureUrl };
}

// --- type selection ---------------------------------------------------------

const CATEGORY_PATTERNS: Array<{ keywords: string[]; type: PatternType }> = [
  {
    keywords: [
      "sports",
      "fitness",
      "athletic",
      "outdoor",
      "adventure",
      "racing",
    ],
    type: "stripes",
  },
  {
    keywords: [
      "tech",
      "technology",
      "software",
      "saas",
      "ai",
      "electronics",
      "startup",
    ],
    type: "gradient",
  },
  {
    keywords: [
      "food",
      "restaurant",
      "cafe",
      "bakery",
      "beverage",
      "coffee",
      "wellness",
      "health",
    ],
    type: "abstract",
  },
  {
    keywords: [
      "luxury",
      "jewelry",
      "jewellery",
      "fashion",
      "designer",
      "watches",
    ],
    type: "none",
  },
  {
    keywords: [
      "finance",
      "banking",
      "insurance",
      "fintech",
      "investment",
      "legal",
    ],
    type: "none",
  },
];

function selectPatternType(brand: BrandProfile): PatternType {
  const lower =
    `${brand.category} ${brand.tone} ${brand.keywords.join(" ")}`.toLowerCase();

  for (const { keywords, type } of CATEGORY_PATTERNS) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }

  // Default: branded overlay when there are at least two distinct brand colors.
  return brand.colors.length >= 2 ? "branded" : "abstract";
}

// --- SVG renderer -----------------------------------------------------------

const W = 1024;
const H = 1024;

function renderPattern(type: Exclude<PatternType, "none">, p: Palette): string {
  const body = {
    stripes: () => stripePattern(p),
    gradient: () => gradientOverlay(p),
    abstract: () => abstractShapes(p),
    branded: () => brandedDiamonds(p),
  }[type]();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

function stripePattern(p: Palette): string {
  const lines: string[] = [];
  const spacing = 96;
  const thickness = 28;
  for (let i = -W; i < W * 2; i += spacing) {
    lines.push(
      `<rect x="${i}" y="0" width="${thickness}" height="${H * 2}"
        transform="rotate(-30 ${W / 2} ${H / 2})"
        fill="${p.accent}" opacity="0.7"/>`,
    );
  }
  return lines.join("");
}

function gradientOverlay(p: Palette): string {
  return `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.85"/>
        <stop offset="60%" stop-color="${p.base}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="${p.ink}" stop-opacity="0.45"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>`;
}

function abstractShapes(p: Palette): string {
  const shapes: string[] = [];
  const seed = [
    [W * 0.2, H * 0.3, 180],
    [W * 0.75, H * 0.15, 140],
    [W * 0.55, H * 0.7, 220],
    [W * 0.1, H * 0.8, 100],
    [W * 0.85, H * 0.6, 160],
  ];
  for (const [cx, cy, r] of seed) {
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.accent}" opacity="0.5"/>`,
    );
  }
  return shapes.join("");
}

function brandedDiamonds(p: Palette): string {
  const cells: string[] = [];
  const size = 120;
  for (let y = 0; y < H + size; y += size) {
    for (let x = (y / size) % 2 === 0 ? 0 : size / 2; x < W + size; x += size) {
      cells.push(
        `<polygon
          points="${x},${y - size / 2} ${x + size / 2},${y} ${x},${y + size / 2} ${x - size / 2},${y}"
          fill="${p.accent}" opacity="0.55"/>`,
      );
    }
  }
  return cells.join("");
}

// --- file output ------------------------------------------------------------

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

async function writePatternTexture(
  brandSlug: string,
  svg: string,
): Promise<string> {
  const dir = path.join(GENERATED_DIR, brandSlug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pattern.svg"), svg, "utf8");
  return `/textures/generated/${brandSlug}/pattern.svg`;
}

// --- palette ----------------------------------------------------------------

interface Palette {
  base: string;
  accent: string;
  ink: string;
}

const FALLBACK: Palette = {
  base: "#111111",
  accent: "#F4C542",
  ink: "#FFFFFF",
};

function resolvePalette(colors: string[]): Palette {
  const hexes = colors.map(normalizeHex).filter((c): c is string => c !== null);
  const base = hexes[0] ?? FALLBACK.base;
  const accent =
    hexes.slice(1).find((c) => contrast(c, base) >= 1.6) ??
    (isLight(base) ? shade(base, -0.45) : FALLBACK.accent);
  const ink = isLight(base) ? "#111111" : "#FFFFFF";
  return { base, accent, ink };
}

function normalizeHex(raw: string): string | null {
  const m = raw.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return `#${hex.toUpperCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isLight(hex: string): boolean {
  return luminance(hex) > 0.6;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  const adj = (v: number) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  const to = (v: number) =>
    Math.max(0, Math.min(255, adj(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand"
  );
}
