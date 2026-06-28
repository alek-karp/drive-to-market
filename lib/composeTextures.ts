import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  carPartTextureConfig,
  type PartTextureConfig,
  paintableParts,
} from "./carPartConfig";
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
 * composite a fixed-dimension texture for each part: full base coat, then the
 * generated wrap graphic, then a crisp company-name lockup rendered as text.
 * Per the demo
 * plan, text is drawn here with SVG (never relied on from an image model) so
 * the brand name always stays legible.
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
  const baseColor = brand?.colors[0] ?? design.baseColor;

  // Always start with a solid base coat so sparse or transparent graphics never
  // reveal the model's default paint. Then apply the generated graphic over it.
  const graphicSource = await readFile(publicPathToFs(graphicUrl));
  const graphic = await sharp(graphicSource, { density: 200 })
    .resize(cfg.width, cfg.height, { fit: "fill" })
    .png()
    .toBuffer();

  // Build the full overlay stack in one composite call. sharp's `composite()`
  // replaces — not appends — its layer list on each call, so the graphic and
  // the lockup must go in together or the last call would drop the graphic.
  const layers: sharp.OverlayOptions[] = [
    { input: graphic, top: 0, left: 0, blend: "over" },
  ];
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

  const texture = sharp({
    create: {
      width: cfg.width,
      height: cfg.height,
      channels: 4,
      background: baseColor,
    },
  }).composite(layers);

  const outPath = path.join(dir, `${part}.png`);
  await texture.png().toFile(outPath);
  return `/textures/generated/${design.id}/${part}.png`;
}

async function composeHoodGraphic(
  design: WrapDesign,
  brand: BrandProfile | undefined,
  dir: string,
): Promise<string> {
  const cfg = carPartTextureConfig.hood;
  const baseColor = brand?.colors[0] ?? design.baseColor;

  const outPath = path.join(dir, "hood-logo.png");
  await sharp({
    create: {
      width: cfg.width,
      height: cfg.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(generatedHoodLogoSvg(cfg, baseColor, brand)),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(outPath);

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
function graphicHasName(design: WrapDesign): boolean {
  return design.style === "AI Ad";
}

/** Map a `/public`-relative URL back to its filesystem path. */
function publicPathToFs(url: string): string {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
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

function generatedHoodLogoSvg(
  cfg: PartTextureConfig,
  baseColor: string,
  brand: BrandProfile | undefined,
): string {
  const { width, height } = cfg;
  const ink = readableInk(baseColor);
  const accent = pickAccent(baseColor, brand);
  const name = esc((brand?.name ?? "BRAND").toUpperCase());
  const initials = esc(initialsFor(brand?.name ?? "BR"));
  const markSize = Math.round(width * 0.34);
  const centerX = Math.round(width / 2);
  const markY = Math.round(height * 0.42);
  const wordY = Math.round(height * 0.68);
  const wordSize = Math.round(height * 0.085);
  const mono = Math.round(markSize * 0.36);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <g transform="translate(${centerX} ${markY})">
      <path d="M 0 ${-markSize / 2} L ${markSize / 2} 0 L 0 ${markSize / 2} L ${-markSize / 2} 0 Z" fill="none" stroke="${ink}" stroke-width="${Math.max(18, Math.round(markSize * 0.08))}" stroke-linejoin="round"/>
      <path d="M ${-markSize * 0.3} ${markSize * 0.15} C ${-markSize * 0.08} ${-markSize * 0.35}, ${markSize * 0.08} ${markSize * 0.35}, ${markSize * 0.3} ${-markSize * 0.15}" fill="none" stroke="${accent}" stroke-width="${Math.max(16, Math.round(markSize * 0.07))}" stroke-linecap="round"/>
      <circle cx="0" cy="0" r="${markSize * 0.23}" fill="${ink}"/>
      <text x="0" y="${mono * 0.34}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${mono}" fill="${baseColor}" letter-spacing="0">${initials}</text>
    </g>
    <text x="${centerX}" y="${wordY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${wordSize}" letter-spacing="${wordSize * 0.08}" fill="${ink}">${name}</text>
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

function initialsFor(name: string): string {
  const parts = name
    .replace(/[^a-z0-9 ]/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : (parts[0] ?? name).slice(0, 2);
  return initials.toUpperCase();
}

function pickAccent(
  baseColor: string,
  brand: BrandProfile | undefined,
): string {
  const candidate = brand?.colors.find(
    (color) => color.toLowerCase() !== baseColor.toLowerCase(),
  );
  return (
    candidate ?? (readableInk(baseColor) === "#FFFFFF" ? "#93C5FD" : "#2563EB")
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
