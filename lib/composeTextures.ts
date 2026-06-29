import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  carPartTextureConfig,
  type PartTextureConfig,
  paintableParts,
} from "./carPartConfig";
import { partPatternPhase } from "./patternSeed";
import type { BrandProfile, PaintablePart, WrapDesign } from "./types";

interface ComposeTexturesResult {
  textures: Partial<Record<PaintablePart, string>>;
  graphics: WrapDesign["graphics"];
}

/**
 * Stage 6: brand profile + generated graphics (Stage 5) -> one final PNG
 * texture per paintable car part.
 *
 * This is the "product magic": instead of slapping one image on the car, we
 * composite a fixed-dimension texture for each part: the full-bleed livery
 * pattern tile as the canvas, then any part-specific graphic (side ad decal,
 * lockup text, etc.) on top.
 *
 * Outputs land in `public/textures/generated/<design.id>/<part>.png` so Stage 7
 * (Three.js) can apply them to the matching meshes by URL.
 */
export async function composeTextures(
  design: WrapDesign,
  brand?: BrandProfile,
): Promise<ComposeTexturesResult> {
  const dir = path.join(GENERATED_DIR, design.id);
  await mkdir(dir, { recursive: true });

  const [entries, hoodUrl, trunkUrl] = await Promise.all([
    Promise.all(
      paintableParts.map(async (part) => {
        const url = await composePart(part, design, brand, dir);
        return [part, url] as const;
      }),
    ),
    composeHoodGraphic(design, brand, dir),
    composeTrunkGraphic(design, brand, dir),
  ]);

  return {
    textures: Object.fromEntries(entries),
    graphics: { ...design.graphics, hoodUrl, trunkUrl },
  };
}

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);
const TRUNK_CTA_SIZE = { width: 2048, height: 640 };

/** Front doors get the wide ad decal. */
const SIDE_PARTS = new Set<PaintablePart>(["door_left", "door_right"]);

/** Rear panels get the brand avatar/mascot centered on the base coat. */
const AVATAR_PARTS = new Set<PaintablePart>(["panel_left", "panel_right"]);

/** Compose, write, and return the public URL of one part's texture. */
async function composePart(
  part: PaintablePart,
  design: WrapDesign,
  brand: BrandProfile | undefined,
  dir: string,
): Promise<string> {
  const cfg = carPartTextureConfig[part];
  const baseColor = brand?.colors[0] ?? design.baseColor;

  if (
    AVATAR_PARTS.has(part) &&
    design.graphics.avatarUrl &&
    !isAiAdDesign(design)
  ) {
    await composeAvatarPart(part, design, brand, dir, cfg, baseColor);
    return `/textures/generated/${design.id}/${part}.png`;
  }

  // Pattern tiles are full-bleed (base tone + marks). Use them as the canvas —
  // overlaying the same hue on a solid base coat collapsed everything to one color.
  const pattern = await loadPatternLayer(
    design.graphics.patternUrl,
    cfg,
    design.id,
    part,
  );
  const layers: sharp.OverlayOptions[] = [];

  if (SIDE_PARTS.has(part) && !isAiAdDesign(design)) {
    const graphicSource = await readFile(
      publicPathToFs(design.graphics.decalUrl),
    );
    const graphic = await sharp(graphicSource, { density: 200 })
      .resize(cfg.width, cfg.height, { fit: "fill" })
      .png()
      .toBuffer();
    layers.push({ input: graphic, top: 0, left: 0, blend: "over" });
  }
  // The AI ad already bakes the company name into its graphic; stamping the
  // lockup on top of it would double the wordmark. Only procedural designs
  // (whose SVG graphics carry no text) get the lockup.
  if (brand && cfg.logoPosition && !graphicHasName(design)) {
    layers.push({
      input: Buffer.from(lockupSvg(cfg, baseColor, brand)),
      top: 0,
      left: 0,
    });
  }

  const outPath = path.join(dir, `${part}.png`);
  await sharp(pattern).composite(layers).png().toFile(outPath);
  return `/textures/generated/${design.id}/${part}.png`;
}

async function composeAvatarPart(
  part: PaintablePart,
  design: WrapDesign,
  _brand: BrandProfile | undefined,
  dir: string,
  cfg: PartTextureConfig,
  _baseColor: string,
): Promise<void> {
  const pattern = await loadPatternLayer(
    design.graphics.patternUrl,
    cfg,
    design.id,
    part,
  );

  const avatarSource = await readFile(
    publicPathToFs(design.graphics.avatarUrl as string),
  );
  const avatarSize = Math.round(Math.min(cfg.width, cfg.height) * 0.72);
  const avatar = await sharp(avatarSource, { density: 200 })
    .resize(avatarSize, avatarSize, { fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(avatar).metadata();
  const aw = meta.width ?? avatarSize;
  const ah = meta.height ?? avatarSize;

  const outPath = path.join(dir, `${part}.png`);
  await sharp(pattern)
    .composite([
      {
        input: avatar,
        top: Math.round((cfg.height - ah) / 2),
        left: Math.round((cfg.width - aw) / 2),
        blend: "over",
      },
    ])
    .png()
    .toFile(outPath);
}

async function composeHoodGraphic(
  design: WrapDesign,
  brand: BrandProfile | undefined,
  dir: string,
): Promise<string> {
  const cfg = carPartTextureConfig.hood;
  const brandLogo =
    (await loadBrandLogo(brand?.logoUrl)) ??
    (await loadBrandLogo(faviconUrlFor(brand?.websiteUrl)));

  const outPath = path.join(dir, "hood-logo.png");
  const input = brandLogo
    ? await brandLogoHoodPng(cfg, brandLogo)
    : await transparentPng(cfg.width, cfg.height);

  await sharp(input, { density: 200 }).png().toFile(outPath);

  return `/textures/generated/${design.id}/hood-logo.png`;
}

async function composeTrunkGraphic(
  design: WrapDesign,
  brand: BrandProfile | undefined,
  dir: string,
): Promise<string> {
  const baseColor = brand?.colors[0] ?? design.baseColor;
  const trunkCta = design.graphics.trunkCta?.trim();
  if (!trunkCta) {
    throw new Error("Missing LLM-generated trunk CTA copy.");
  }

  const outPath = path.join(dir, "trunk-cta.png");
  await sharp({
    create: {
      width: TRUNK_CTA_SIZE.width,
      height: TRUNK_CTA_SIZE.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          generatedTrunkCtaSvg(TRUNK_CTA_SIZE, baseColor, trunkCta),
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(outPath);

  return `/textures/generated/${design.id}/trunk-cta.png`;
}

/** The AI ad design composites the company name into its own graphic. */
function isAiAdDesign(design: WrapDesign): boolean {
  return design.style === "AI Ad";
}

function graphicHasName(design: WrapDesign): boolean {
  return isAiAdDesign(design);
}

/** Map a `/public`-relative URL back to its filesystem path. */
function publicPathToFs(url: string): string {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
}

async function loadPatternLayer(
  patternUrl: string,
  cfg: PartTextureConfig,
  designId: string,
  part: PaintablePart,
): Promise<Buffer> {
  const patternSource = await readFile(publicPathToFs(patternUrl));
  const resized = await sharp(patternSource, { density: 200 })
    .resize(cfg.width, cfg.height, { fit: "fill" })
    .png()
    .toBuffer();
  const { x, y } = partPatternPhase(designId, part);
  const phased = await phaseShiftPattern(resized, cfg.width, cfg.height, x, y);
  return boostPatternContrast(phased);
}

/** Slide the tiled pattern so each body panel starts at a different phase. */
async function phaseShiftPattern(
  pattern: Buffer,
  width: number,
  height: number,
  phaseX: number,
  phaseY: number,
): Promise<Buffer> {
  const ox = Math.floor(phaseX % width);
  const oy = Math.floor(phaseY % height);
  if (ox === 0 && oy === 0) return pattern;

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: pattern, left: -ox, top: -oy },
      { input: pattern, left: width - ox, top: -oy },
      { input: pattern, left: -ox, top: height - oy },
      { input: pattern, left: width - ox, top: height - oy },
    ])
    .png()
    .toBuffer();
}

/** Lift greyscale motif brightness so marks survive PBR lighting in the viewer. */
function boostPatternContrast(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .linear(1.28, -12)
    .modulate({ brightness: 1.12 })
    .png()
    .toBuffer();
}

// --- text lockup -------------------------------------------------------------

/**
 * Render the brand name as an SVG overlay sized to the full part. Square tops
 * center the lockup; wide sides anchor it left, matching the per-part anchors
 * in {@link carPartTextureConfig}.
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

  const nameSize = Math.round(height * 0.11);
  const name = esc(brand.name.toUpperCase());

  const anchor = centered ? "middle" : "start";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${nameSize}" letter-spacing="${nameSize * 0.06}" fill="${ink}">${name}</text>
  </svg>`;
}

function generatedTrunkCtaSvg(
  size: { width: number; height: number },
  baseColor: string,
  trunkCta: string,
): string {
  const { width, height } = size;
  const ink = readableInk(baseColor);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const headline = esc(trunkCta.toUpperCase());
  const headlineSize = fitSingleLineText(trunkCta, {
    maxWidth: width * 0.78,
    maxSize: height * 0.28,
    minSize: height * 0.16,
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <g>
      <text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${headlineSize}" letter-spacing="${headlineSize * 0.04}" fill="${ink}">${headline}</text>
    </g>
  </svg>`;
}

/** Google's favicon service — a reliable real brand mark by domain. */
function faviconUrlFor(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${host}&sz=256`;
  } catch {
    return null;
  }
}

async function loadBrandLogo(logoUrl: string | null | undefined) {
  if (!logoUrl) return null;

  try {
    if (logoUrl.startsWith("/")) {
      return await readFile(publicPathToFs(logoUrl));
    }

    const url = new URL(logoUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const response = await fetch(url, {
      headers: { accept: "image/avif,image/webp,image/svg+xml,image/*,*/*" },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("image/")) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function brandLogoHoodPng(
  cfg: PartTextureConfig,
  logoSource: Buffer,
): Promise<Buffer> {
  // Trim any uniform/transparent padding around the mark so it fills the badge
  // area consistently regardless of the source's built-in margins.
  const trimmed = await sharp(logoSource, { density: 300 })
    .rotate()
    .ensureAlpha()
    .trim({ threshold: 10 })
    .png()
    .toBuffer()
    .catch(() => logoSource);

  const maxLogoWidth = Math.round(cfg.width * 0.7);
  const maxLogoHeight = Math.round(cfg.height * 0.7);
  const logo = await sharp(trimmed, { density: 300 })
    .resize(maxLogoWidth, maxLogoHeight, {
      fit: "inside",
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  const metadata = await sharp(logo).metadata();
  const logoWidth = metadata.width ?? maxLogoWidth;
  const logoHeight = metadata.height ?? maxLogoHeight;

  return sharp({
    create: {
      width: cfg.width,
      height: cfg.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: logo,
        top: Math.round((cfg.height - logoHeight) / 2),
        left: Math.round((cfg.width - logoWidth) / 2),
      },
    ])
    .png()
    .toBuffer();
}

async function transparentPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

function fitSingleLineText(
  value: string,
  options: { maxWidth: number; maxSize: number; minSize: number },
): number {
  const estimatedWidthPerEm = 0.68;
  const normalizedLength = Math.max(1, value.replace(/\s+/g, " ").length);
  const fitted = options.maxWidth / (normalizedLength * estimatedWidthPerEm);
  return Math.round(
    Math.max(options.minSize, Math.min(options.maxSize, fitted)),
  );
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
