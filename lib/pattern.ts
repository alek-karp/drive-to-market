import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  DEBUG_PATTERN_PNG,
  DEBUG_PATTERN_SVG,
  useHardcodedPattern,
} from "./debugPattern";
import { buildPatternSvgPrompt } from "./generateAdPrompt";
import {
  derivePatternVariant,
  type PatternVariant,
  seededRandom,
} from "./patternSeed";
import type { BrandProfile, Pattern, PatternType } from "./types";

const XAI_BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const XAI_TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? "grok-3-mini";
const W = 2048;
const H = 2048;

/**
 * Stage 3: BrandProfile -> AI-generated SVG livery pattern (with procedural fallback).
 *
 * Grok writes a seamless, edge-to-edge SVG in tonal variations of the primary
 * color. The SVG tiles across the whole car body in Three.js and Sharp.
 */
export async function derivePattern(
  brand: BrandProfile,
  designId?: string,
  apiKey?: string,
): Promise<Pattern> {
  if (useHardcodedPattern()) {
    return {
      type: "fracture",
      textureUrl: DEBUG_PATTERN_PNG,
      svgUrl: DEBUG_PATTERN_SVG,
    };
  }

  const slug = designId ?? slugify(brand.name);
  const variant = derivePatternVariant(brand, slug);
  const palette = resolvePalette(brand.colors);

  // Seeded procedural wrap graphics (shards / speed lines). Grok defaults to dot
  // grids, so AI patterns stay opt-in via XAI_PATTERN=true.
  if (apiKey && process.env.XAI_PATTERN === "true") {
    try {
      const svg = await requestPatternSvg(apiKey, brand, variant);
      try {
        const textureUrl = await writePatternTexture(slug, svg);
        return { type: "ai", textureUrl, svgUrl: textureUrlToSvg(textureUrl) };
      } catch {
        // AI SVG failed validation or rasterization — use procedural fallback.
      }
    } catch {
      // Fall back to deterministic SVG when the model returns invalid markup.
    }
  }

  const svg = renderPattern(variant.type, palette, variant);
  const textureUrl = await writePatternTexture(slug, svg);
  return {
    type: variant.type,
    textureUrl,
    svgUrl: textureUrlToSvg(textureUrl),
  };
}

async function requestPatternSvg(
  apiKey: string,
  brand: BrandProfile,
  variant: PatternVariant,
): Promise<string> {
  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: XAI_TEXT_MODEL,
      temperature: 0.65,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SVG artist for large-format vehicle wraps. Output only valid SVG markup.",
        },
        { role: "user", content: buildPatternSvgPrompt(brand, variant) },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Grok pattern request failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Grok returned no SVG pattern.");
  return normalizeSvgDocument(extractSvg(raw));
}

function extractSvg(raw: string): string {
  const fenced = raw.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i);
  const content = (fenced?.[1] ?? raw).trim();
  const start = content.search(/<svg[\s>]/i);
  const end = content.lastIndexOf("</svg>");
  if (start === -1 || end === -1) {
    throw new Error("Response did not contain SVG markup.");
  }
  return content.slice(start, end + "</svg>".length);
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|xlink:href)\s*=\s*("|')https?:[^"']+\2/gi, "");
}

function normalizeSvgDocument(svg: string): string {
  let doc = sanitizeSvg(svg);
  if (!/<svg[\s>]/i.test(doc)) {
    throw new Error("Invalid SVG root element.");
  }

  if (!/xmlns=/.test(doc)) {
    doc = doc.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (!/\bwidth\s*=/.test(doc)) {
    doc = doc.replace(/<svg/i, `<svg width="${W}" height="${H}"`);
  }
  if (!/\bviewBox\s*=/.test(doc)) {
    doc = doc.replace(/<svg/i, `<svg viewBox="0 0 ${W} ${H}"`);
  }

  return doc;
}

function renderPattern(
  type: Exclude<PatternType, "ai">,
  palette: Palette,
  variant: PatternVariant,
): string {
  const body = {
    none: () => solidFill(palette),
    shards: () => shardsPattern(palette, variant),
    speedlines: () => speedlinesPattern(palette, variant),
    fracture: () => fracturePattern(palette, variant),
  }[type]();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

function solidFill(p: Palette): string {
  return `<rect width="${W}" height="${H}" fill="${p.base}"/>`;
}

/** Evenly spaced anchors with jitter — keeps the tile readable, not cluttered. */
function gridAnchors(
  rng: () => number,
  count: number,
  phaseX: number,
  phaseY: number,
): Array<{ x: number; y: number }> {
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / cols);
  const cellW = W / cols;
  const cellH = H / rows;
  const anchors: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = (rng() - 0.5) * cellW * 0.35;
    const jitterY = (rng() - 0.5) * cellH * 0.35;
    anchors.push({
      x: (col * cellW + cellW * 0.5 + jitterX + phaseX) % W,
      y: (row * cellH + cellH * 0.5 + jitterY + phaseY) % H,
    });
  }

  return anchors;
}

function flowAngle(v: PatternVariant, rng: () => number): number {
  return v.twirlTurn + (rng() - 0.5) * 18;
}

/** Angular shard panels — tapered fragments like performance wrap graphics. */
function shardsPattern(p: Palette, v: PatternVariant, density = 1): string {
  const g = wrapMarks(p);
  const rng = seededRandom(v.seed);
  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="${p.base}"/>`,
  ];
  const count = Math.max(2, Math.round((3 + 2 * v.spacingScale) * density));
  const anchors = gridAnchors(rng, count, v.phaseX, v.phaseY);

  for (const { x: cx, y: cy } of anchors) {
    const size = (220 + rng() * 180) * v.spacingScale;
    const angle = (flowAngle(v, rng) * Math.PI) / 180;
    const points = taperedShardPoints(rng, cx, cy, size, angle);
    const opacity = g.brightOpacity * (0.88 + rng() * 0.1);
    parts.push(
      `<polygon points="${points}" fill="${g.bright}" opacity="${opacity.toFixed(3)}"/>`,
    );
  }

  return parts.join("");
}

/** Clusters of parallel curved speed lines. */
function speedlinesPattern(p: Palette, v: PatternVariant, density = 1): string {
  const g = wrapMarks(p);
  const rng = seededRandom(v.seed ^ 0x9e3779b9);
  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="${p.base}"/>`,
  ];
  const clusters = Math.max(2, Math.round((3 + 2 * v.spacingScale) * density));
  const anchors = gridAnchors(rng, clusters, v.phaseX + 180, v.phaseY + 180);

  for (const { x: cx, y: cy } of anchors) {
    parts.push(
      speedlineCluster(rng, cx, cy, flowAngle(v, rng), g, v.spacingScale),
    );
  }

  return parts.join("");
}

/** A few shards plus a couple of line bursts — sparse race-wrap livery. */
function fracturePattern(p: Palette, v: PatternVariant): string {
  const g = wrapMarks(p);
  const rng = seededRandom(v.seed);
  const parts: string[] = [
    `<rect width="${W}" height="${H}" fill="${p.base}"/>`,
  ];
  const shardCount = Math.round(2 + v.spacingScale);
  const lineCount = Math.round(2 + v.spacingScale * 0.75);
  const shardAnchors = gridAnchors(rng, shardCount, v.phaseX, v.phaseY);
  const lineAnchors = gridAnchors(
    seededRandom(v.seed + 1),
    lineCount,
    v.phaseX + 320,
    v.phaseY + 320,
  );

  for (const { x: cx, y: cy } of shardAnchors) {
    const size = (240 + rng() * 200) * v.spacingScale;
    const angle = (flowAngle(v, rng) * Math.PI) / 180;
    const points = taperedShardPoints(rng, cx, cy, size, angle);
    const opacity = g.brightOpacity * (0.9 + rng() * 0.08);
    parts.push(
      `<polygon points="${points}" fill="${g.bright}" opacity="${opacity.toFixed(3)}"/>`,
    );
  }

  const lineRng = seededRandom(v.seed ^ 0x9e3779b9);
  for (const { x: cx, y: cy } of lineAnchors) {
    parts.push(
      speedlineCluster(
        lineRng,
        cx,
        cy,
        flowAngle(v, lineRng),
        g,
        v.spacingScale,
      ),
    );
  }

  return parts.join("");
}

/** Spear-like shard with one long tapered point and a wide trailing edge. */
function taperedShardPoints(
  rng: () => number,
  cx: number,
  cy: number,
  size: number,
  angle: number,
): string {
  const tipLen = size * (0.9 + rng() * 0.25);
  const baseLen = size * (0.2 + rng() * 0.12);
  const baseWidth = size * (0.2 + rng() * 0.14);
  const skew = (rng() - 0.5) * 0.12;

  const tipX = cx + Math.cos(angle) * tipLen;
  const tipY = cy + Math.sin(angle) * tipLen;
  const backX = cx - Math.cos(angle) * baseLen;
  const backY = cy - Math.sin(angle) * baseLen;
  const perp = angle + Math.PI / 2 + skew;

  const leftX = backX + Math.cos(perp) * baseWidth;
  const leftY = backY + Math.sin(perp) * baseWidth;
  const rightX = backX - Math.cos(perp) * baseWidth * 0.75;
  const rightY = backY - Math.sin(perp) * baseWidth * 0.75;

  return [
    `${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    `${leftX.toFixed(1)},${leftY.toFixed(1)}`,
    `${rightX.toFixed(1)},${rightY.toFixed(1)}`,
  ].join(" ");
}

function speedlineCluster(
  rng: () => number,
  cx: number,
  cy: number,
  angleDeg: number,
  g: WrapMarks,
  spacingScale: number,
): string {
  const lines: string[] = [];
  const count = 4;
  const rad = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad + Math.PI / 2);
  const ny = Math.sin(rad + Math.PI / 2);
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const gap = (18 + rng() * 8) * spacingScale;

  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * gap;
    const len = (160 + rng() * 140) * spacingScale;
    const x1 = cx + nx * offset;
    const y1 = cy + ny * offset;
    const curve = (rng() - 0.5) * 32 * spacingScale;
    const x2 = x1 + dx * len;
    const y2 = y1 + dy * len;
    const cx1 = x1 + dx * len * 0.45 + nx * curve;
    const cy1 = y1 + dy * len * 0.45 + ny * curve;
    const width = i === 0 || i === count - 1 ? 4.5 : 2.5;
    const opacity = g.brightOpacity * (0.82 + rng() * 0.12);
    lines.push(
      `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx1.toFixed(1)} ${cy1.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"
        fill="none" stroke="${g.bright}" stroke-width="${width.toFixed(1)}" stroke-linecap="round" opacity="${opacity.toFixed(3)}"/>`,
    );
  }

  return lines.join("");
}

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

async function writePatternTexture(
  designSlug: string,
  svg: string,
): Promise<string> {
  const dir = path.join(GENERATED_DIR, designSlug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pattern.svg"), svg, "utf8");

  // WebGL/Three.js cannot reliably sample SVG textures — rasterize for the viewer.
  const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
  await writeFile(path.join(dir, "pattern.png"), png);
  return `/textures/generated/${designSlug}/pattern.png`;
}

function textureUrlToSvg(textureUrl: string): string {
  return textureUrl.replace(/pattern\.png$/i, "pattern.svg");
}

interface Palette {
  base: string;
  accent: string | null;
}

interface WrapMarks {
  bright: string;
  mid: string;
  dim: string;
  brightOpacity: number;
  midOpacity: number;
  dimOpacity: number;
}

/**
 * Graphic mark tones for wrap overlays. Dark bases use the brand accent when
 * available (GT-R-style neon-on-black); light bases stay greyscale for contrast.
 */
function wrapMarks(palette: Palette): WrapMarks {
  if (isLight(palette.base)) {
    return {
      bright: "#FFFFFF",
      mid: "#F0F0F0",
      dim: "#2E2E2E",
      brightOpacity: 0.58,
      midOpacity: 0.45,
      dimOpacity: 0.65,
    };
  }

  const accent =
    palette.accent && !isLight(palette.accent) ? palette.accent : null;
  const bright = accent ?? "#FFFFFF";
  const mid = accent ? lightenHex(bright, 0.18) : "#EEEEEE";

  return {
    bright,
    mid,
    dim: "#444444",
    brightOpacity: 0.92,
    midOpacity: 0.78,
    dimOpacity: 0.35,
  };
}

function resolvePalette(colors: string[]): Palette {
  const hexes = colors.map(normalizeHex).filter((c): c is string => c !== null);
  const accent =
    hexes[1] && hexes[1] !== hexes[0] ? hexes[1] : (hexes[2] ?? null);
  return { base: hexes[0] ?? "#111111", accent };
}

function lightenHex(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * Math.min(1, Math.max(0, amount)));
  return `#${[mix(r), mix(g), mix(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
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

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand"
  );
}
