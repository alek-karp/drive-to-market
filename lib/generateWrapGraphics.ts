import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type WrapStyle, wrapStyles } from "./generateWrapPrompt";
import type { BrandProfile, WrapDesign } from "./types";

/**
 * Stage 5: brand profile -> generated wrap graphics (the creative "style"),
 * one concept per {@link wrapStyles} entry.
 *
 * The graphics are generated *procedurally* as SVG rather than via an image
 * model. This is deliberate per the demo plan: image models can't be relied on
 * for the demo (no key required, deterministic output, and — crucially — no
 * unreadable AI text). The image-model path is a drop-in swap: feed
 * `generateWrapPrompt(brand, style)` to the model and write its PNG where we
 * currently write the SVG. Text/logo are added later in Stage 6 composition.
 *
 * Graphics are written under `public/textures/generated/<designId>/` so Stage 6
 * (Sharp composition) and Stage 7 (Three.js) can consume them as URLs. SVG is
 * used because it stays crisp at any texture size; Stage 6 rasterizes to PNG
 * when it composites per-part textures.
 */
export async function generateWrapDesigns(
  brand: BrandProfile,
): Promise<WrapDesign[]> {
  const brandSlug = slug(brand.name);

  return Promise.all(
    wrapStyles.map(async (style): Promise<WrapDesign> => {
      const palette = resolvePalette(brand.colors);
      const id = `${brandSlug}-${style.toLowerCase()}`;

      const decalSvg = renderDecal(style, palette);
      const patternSvg = renderPattern(style, palette);
      const [decalUrl, patternUrl] = await Promise.all([
        writeGraphic(id, "decal", decalSvg),
        writeGraphic(id, "pattern", patternSvg),
      ]);

      return {
        id,
        style,
        description: STYLE_DESCRIPTIONS[style],
        baseColor: palette.base,
        graphics: { decalUrl, patternUrl },
        textures: {},
      };
    }),
  );
}

const STYLE_DESCRIPTIONS: Record<WrapStyle, string> = {
  Clean: "Minimal wrap — brand color with a single crisp accent line.",
  Bold: "High-energy diagonal graphics in your brand colors.",
  Luxury: "Understated finish with fine accent pinstriping.",
  Tech: "Angular grid motif with a modern, technical feel.",
};

// --- file output ------------------------------------------------------------

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

/** Write one SVG graphic and return its public URL. Overwrites on regenerate. */
async function writeGraphic(
  designId: string,
  name: "decal" | "pattern",
  svg: string,
): Promise<string> {
  const dir = path.join(GENERATED_DIR, designId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.svg`), svg, "utf8");
  return `/textures/generated/${designId}/${name}.svg`;
}

// --- SVG generators ---------------------------------------------------------

const DECAL_W = 2048;
const DECAL_H = 1024;
const PATTERN = 1024;

/** Wide side decal, applied across the door/panel parts. */
function renderDecal(style: WrapStyle, p: Palette): string {
  const body = {
    Clean: () => `
      <rect x="0" y="${DECAL_H - 150}" width="${DECAL_W}" height="36" fill="${p.accent}"/>
      <rect x="0" y="${DECAL_H - 104}" width="${DECAL_W}" height="10" fill="${p.ink}" opacity="0.35"/>`,
    Bold: () => `
      <polygon points="0,${DECAL_H} 760,0 1080,0 320,${DECAL_H}" fill="${p.accent}"/>
      <polygon points="980,${DECAL_H} 1740,0 1980,0 1220,${DECAL_H}" fill="${p.ink}" opacity="0.85"/>`,
    Luxury: () => `
      <rect width="${DECAL_W}" height="${DECAL_H}" fill="url(#sheen)"/>
      ${pinstripes(DECAL_W, DECAL_H, p.accent)}`,
    Tech: () => `
      ${hexField(DECAL_W, DECAL_H, p.accent)}
      <polygon points="1500,${DECAL_H} 1820,0 1960,0 1640,${DECAL_H}" fill="${p.accent}" opacity="0.55"/>`,
  }[style]();

  return svgDoc(
    DECAL_W,
    DECAL_H,
    `
    <defs>
      <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p.base}"/>
        <stop offset="55%" stop-color="${shade(p.base, -0.12)}"/>
        <stop offset="100%" stop-color="${shade(p.base, 0.08)}"/>
      </linearGradient>
    </defs>
    <rect width="${DECAL_W}" height="${DECAL_H}" fill="${p.base}"/>
    ${body}`,
  );
}

/** Square hood/roof pattern. */
function renderPattern(style: WrapStyle, p: Palette): string {
  const c = PATTERN / 2;
  const body = {
    Clean: () =>
      `<polygon points="${c},${c - 180} ${c + 170},${c + 120} ${c - 170},${c + 120}" fill="${p.accent}"/>`,
    Bold: () =>
      `<polygon points="0,${PATTERN} ${PATTERN},0 ${PATTERN},${PATTERN * 0.45} ${PATTERN * 0.45},${PATTERN}" fill="${p.accent}"/>`,
    Luxury: () =>
      [0.18, 0.3, 0.42]
        .map(
          (r) =>
            `<circle cx="${c}" cy="${c}" r="${PATTERN * r}" fill="none" stroke="${p.accent}" stroke-width="6" opacity="0.7"/>`,
        )
        .join(""),
    Tech: () => hexField(PATTERN, PATTERN, p.accent),
  }[style]();

  return svgDoc(
    PATTERN,
    PATTERN,
    `<rect width="${PATTERN}" height="${PATTERN}" fill="${p.base}"/>${body}`,
  );
}

function svgDoc(w: number, h: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

/** Repeating thin accent pinstripes across the full width (Luxury). */
function pinstripes(w: number, h: number, color: string): string {
  const lines: string[] = [];
  for (let y = 120; y < h; y += 180) {
    lines.push(
      `<rect x="0" y="${y}" width="${w}" height="3" fill="${color}" opacity="0.5"/>`,
    );
  }
  return lines.join("");
}

/** Tiled angular hex motif (Tech). */
function hexField(w: number, h: number, color: string): string {
  const r = 46;
  const dx = r * 1.5;
  const dy = r * Math.sqrt(3);
  const cells: string[] = [];
  let row = 0;
  for (let y = 0; y < h + dy; y += dy / 2, row++) {
    const offset = row % 2 ? dx : 0;
    for (let x = offset; x < w + dx; x += dx * 2) {
      cells.push(
        `<polygon points="${hexPoints(x, y, r)}" fill="none" stroke="${color}" stroke-width="3" opacity="0.28"/>`,
      );
    }
  }
  return cells.join("");
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(
      `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`,
    );
  }
  return pts.join(" ");
}

// --- palette ----------------------------------------------------------------

interface Palette {
  /** Base coat / background. */
  base: string;
  /** Brand accent used for the graphic. */
  accent: string;
  /** High-contrast color for fine line work. */
  ink: string;
}

const FALLBACK = { base: "#111111", accent: "#F4C542", ink: "#FFFFFF" };

/**
 * Turn the brand's color list (primary first) into a usable wrap palette:
 * a base coat, a distinct accent, and a contrasting ink for line work.
 */
function resolvePalette(colors: string[]): Palette {
  const hexes = colors.map(normalizeHex).filter((c): c is string => c !== null);
  const base = hexes[0] ?? FALLBACK.base;

  // Pick the first remaining color that reads clearly against the base.
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

/** Rough relative-contrast ratio between two colors (>= 1). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lighten (amount > 0) or darken (amount < 0) a hex color. */
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
