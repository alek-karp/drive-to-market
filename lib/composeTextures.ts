import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  carPartTextureConfig,
  type PartTextureConfig,
  paintableParts,
} from "./carPartConfig";
import type { BrandProfile, PaintablePart, WrapDesign } from "./types";

/**
 * Stage 6: brand profile + generated graphics (Stage 5) -> one final PNG
 * texture per paintable car part.
 *
 * This is the "product magic": instead of slapping one image on the car, we
 * composite a fixed-dimension texture for each part — base coat + the generated
 * wrap graphic + a crisp company-name lockup rendered as text. Per the demo
 * plan, text is drawn here with SVG (never relied on from an image model) so
 * the brand name always stays legible.
 *
 * Outputs land in `public/textures/generated/<design.id>/<part>.png` so Stage 7
 * (Three.js) can apply them to the matching meshes by URL.
 */
export async function composeTextures(
  design: WrapDesign,
  brand?: BrandProfile,
): Promise<Partial<Record<PaintablePart, string>>> {
  const dir = path.join(GENERATED_DIR, design.id);
  await mkdir(dir, { recursive: true });

  const entries = await Promise.all(
    paintableParts.map(async (part) => {
      const url = await composePart(part, design, brand, dir);
      return [part, url] as const;
    }),
  );

  return Object.fromEntries(entries);
}

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

/** Long side surfaces get the wide decal; tops get the square pattern. */
const SIDE_PARTS = new Set<PaintablePart>([
  "door_left",
  "door_right",
  "panel_left",
  "panel_right",
]);

/** Compose, write, and return the public URL of one part's texture. */
async function composePart(
  part: PaintablePart,
  design: WrapDesign,
  brand: BrandProfile | undefined,
  dir: string,
): Promise<string> {
  const cfg = carPartTextureConfig[part];
  const graphicUrl = SIDE_PARTS.has(part)
    ? design.graphics.decalUrl
    : design.graphics.patternUrl;

  // The Stage 5 graphic is an opaque, full-canvas SVG (base coat + motif), so
  // it doubles as the texture background. Rasterize it to the part's exact size.
  const graphicSvg = await readFile(publicPathToFs(graphicUrl));
  const texture = sharp(graphicSvg, { density: 200 }).resize(
    cfg.width,
    cfg.height,
    { fit: "fill" },
  );

  // Overlay a company-name lockup wherever the part config anchors a logo.
  if (brand && cfg.logoPosition) {
    const overlay = Buffer.from(lockupSvg(cfg, design.baseColor, brand));
    texture.composite([{ input: overlay, top: 0, left: 0 }]);
  }

  const outPath = path.join(dir, `${part}.png`);
  await texture.png().toFile(outPath);
  return `/textures/generated/${design.id}/${part}.png`;
}

/** Map a `/public`-relative URL back to its filesystem path. */
function publicPathToFs(url: string): string {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
}

// --- text lockup -------------------------------------------------------------

/**
 * Render the brand name (and a short tagline) as an SVG overlay sized to the
 * full part. Square tops center the lockup; wide sides anchor it left, matching
 * the per-part anchors in {@link carPartTextureConfig}. A translucent plate
 * keeps the text readable over any graphic.
 */
function lockupSvg(
  cfg: PartTextureConfig,
  baseColor: string,
  brand: BrandProfile,
): string {
  // logoPosition is guaranteed by the caller.
  const [x, y] = cfg.logoPosition as [number, number];
  const { width, height } = cfg;
  const centered = width === height;

  const ink = readableInk(baseColor);
  const plate =
    ink === "#FFFFFF" ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.32)";

  const nameSize = Math.round(height * 0.11);
  const tagSize = Math.round(height * 0.05);
  const name = esc(brand.name.toUpperCase());
  const tagline = esc(truncate(brand.headlineText || brand.description, 42));

  const anchor = centered ? "middle" : "start";
  // Backing plate spans the text block; sized generously and clipped softly.
  const plateW = centered ? width * 0.8 : width * 0.42;
  const plateH = nameSize + (tagline ? tagSize * 1.6 : 0) + nameSize * 0.7;
  const plateX = centered ? (width - plateW) / 2 : x - nameSize * 0.35;
  const plateY = y - nameSize;

  const taglineEl = tagline
    ? `<text x="${x}" y="${y + tagSize * 1.5}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" font-size="${tagSize}" letter-spacing="${tagSize * 0.12}" fill="${ink}" opacity="0.85">${tagline}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect x="${plateX.toFixed(0)}" y="${plateY.toFixed(0)}" width="${plateW.toFixed(0)}" height="${plateH.toFixed(0)}" rx="${(nameSize * 0.25).toFixed(0)}" fill="${plate}"/>
    <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${nameSize}" letter-spacing="${nameSize * 0.06}" fill="${ink}">${name}</text>
    ${taglineEl}
  </svg>`;
}

/** Black or white text, whichever reads better on the base coat. */
function readableInk(baseColor: string): string {
  const m = baseColor.replace("#", "");
  const n = Number.parseInt(
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m,
    16,
  );
  if (Number.isNaN(n)) return "#FFFFFF";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#FFFFFF";
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
