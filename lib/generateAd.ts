import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { deriveBaseCoat } from "./baseColor";
import {
  buildAdBackgroundPrompt,
  buildAdConcepts,
  buildAvatarPrompt,
} from "./generateAdPrompt";
import { derivePattern } from "./pattern";
import type { AdConcept, BrandProfile, WrapDesign } from "./types";

/**
 * AI-assisted ad generation.
 *
 * The image model creates background art only. Copy strategy is generated
 * first and candidate backgrounds are ranked. Final copy is composited
 * deterministically after generation so brand text stays controlled.
 */
export async function generateAdDesign(
  brand: BrandProfile,
): Promise<WrapDesign> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY is not set — add it to .env.local to enable Grok ad generation.",
    );
  }

  const candidateCount = resolveCandidateCount();
  const concepts = buildAdConcepts(brand, candidateCount);
  const batches = concepts.slice(0, 2);
  const n = Math.max(2, Math.ceil(candidateCount / batches.length));

  const generated = (
    await Promise.all(
      batches.map(async (concept) => {
        const prompt = buildAdBackgroundPrompt(brand, concept);
        const images = await requestGrokImages(apiKey, prompt, n);
        return images.map((image, index): AdCandidate => {
          return {
            id: `${concept.id}-${index + 1}`,
            concept,
            b64: image.b64,
            revisedPrompt: image.revisedPrompt,
            score: rankCandidate(concept, image.revisedPrompt),
          };
        });
      }),
    )
  )
    .flat()
    .slice(0, candidateCount);

  const winner = generated.sort((a, b) => b.score - a.score)[0];
  if (!winner) throw new Error("Grok returned no image data.");

  const id = `${slug(brand.name)}-ai-ad`;
  const [adUrl, baseCoat, trunkCta, avatarUrl, pattern] = await Promise.all([
    saveAd(id, winner, brand),
    Promise.resolve(deriveBaseCoat(brand)),
    requestTrunkCta(apiKey, brand, winner.concept),
    generateAvatar(apiKey, id, brand),
    derivePattern(brand, id, apiKey),
  ]);

  return {
    id,
    style: "AI Ad",
    description: `${winner.concept.hook} · ${winner.concept.cta}`,
    baseColor: baseCoat.color,
    metalness: baseCoat.metalness,
    roughness: baseCoat.roughness,
    graphics: {
      decalUrl: adUrl,
      patternUrl: pattern.textureUrl,
      trunkCta,
      avatarUrl,
    },
    textures: {},
  };
}

/** Where Grok's image model is reached. Overridable for self-hosting/tests. */
const XAI_BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const XAI_IMAGE_MODEL = process.env.XAI_IMAGE_MODEL ?? "grok-imagine-image";
const XAI_TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? "grok-3-mini";
const OUTPUT_W = 2048;
const OUTPUT_H = 1024;

interface GrokImage {
  b64: string;
  revisedPrompt?: string;
}

interface AdCandidate extends GrokImage {
  id: string;
  concept: AdConcept;
  score: number;
}

/** Call xAI's OpenAI-compatible image endpoint and return all images. */
async function requestGrokImages(
  apiKey: string,
  prompt: string,
  n: number,
): Promise<GrokImage[]> {
  const res = await fetch(`${XAI_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: XAI_IMAGE_MODEL,
      prompt,
      n,
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Grok image request failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const images =
    json.data
      ?.filter((entry) => entry.b64_json)
      .map((entry) => ({
        b64: entry.b64_json as string,
        revisedPrompt: entry.revised_prompt,
      })) ?? [];

  if (images.length === 0) throw new Error("Grok returned no image data.");
  return images;
}

async function requestTrunkCta(
  apiKey: string,
  brand: BrandProfile,
  concept: AdConcept,
): Promise<string> {
  const res = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: XAI_TEXT_MODEL,
      temperature: 0.9,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content:
            "You write concise outdoor ad copy for vehicle wraps. Return only one CTA line. No quotation marks. No punctuation except apostrophes. No hashtags. No URLs.",
        },
        {
          role: "user",
          content: [
            "Write a catchy CTA for the rear trunk decal of a branded car wrap.",
            "It should relate to driving, roads, speed, parking, lanes, miles, or motion only when that metaphor fits the brand.",
            "Do not mechanically prepend words like Drive to an existing website CTA.",
            "Do not use generic web button text like Get Started, Learn More, Sign Up, Contact Us, or Book Now.",
            "Keep it 3 to 5 words, readable at a distance, punchy, and brand-relevant.",
            `Brand name: ${brand.name}`,
            `Brand description: ${brand.description}`,
            `Headline: ${brand.headlineText}`,
            `Offer: ${brand.offer}`,
            `Audience: ${brand.audience}`,
            `Differentiators: ${brand.differentiators.slice(0, 3).join(", ")}`,
            `Ad hook: ${concept.hook}`,
            `Ad subheader: ${concept.subheader}`,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Grok trunk CTA request failed (${res.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = cleanTrunkCta(json.choices?.[0]?.message?.content);
  if (!text) throw new Error("Grok returned no trunk CTA copy.");
  return text;
}

function cleanTrunkCta(value: string | undefined): string {
  return (value ?? "")
    .replace(/["“”]/g, "")
    .replace(/[^\w' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join(" ")
    .toUpperCase();
}

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

async function generateAvatar(
  apiKey: string,
  designId: string,
  brand: BrandProfile,
): Promise<string | undefined> {
  try {
    const prompt = buildAvatarPrompt(brand);
    const images = await requestGrokImages(apiKey, prompt, 1);
    const image = images[0];
    if (!image) return undefined;

    const dir = path.join(GENERATED_DIR, designId);
    await mkdir(dir, { recursive: true });

    const avatar = await removeWhiteBackground(
      Buffer.from(image.b64, "base64"),
    );
    await writeFile(path.join(dir, "avatar.png"), avatar);
    return `/textures/generated/${designId}/avatar.png`;
  } catch {
    return undefined;
  }
}

async function removeWhiteBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Buffer may be a slice of a Node pool — copy it so we own the ArrayBuffer.
  const pixels = Buffer.from(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    if (brightness > 230) {
      pixels[i + 3] = 0;
    } else if (brightness > 200) {
      pixels[i + 3] = Math.round(((230 - brightness) / 30) * 255);
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function saveAd(
  designId: string,
  winner: AdCandidate,
  brand: BrandProfile,
): Promise<string> {
  const dir = path.join(GENERATED_DIR, designId);
  await mkdir(dir, { recursive: true });

  await writeFile(path.join(dir, "ad.png"), await renderAd(winner, brand));
  return `/textures/generated/${designId}/ad.png`;
}

function normalizeBackground(b64: string, baseColor: string): Promise<Buffer> {
  // Flatten any transparency onto the brand's base color so transparent areas
  // blend with the car's base coat instead of showing as white edges.
  return sharp(Buffer.from(b64, "base64"))
    .flatten({ background: baseColor })
    .resize(OUTPUT_W, OUTPUT_H, { fit: "cover" })
    .png()
    .toBuffer();
}

async function renderAd(
  winner: AdCandidate,
  brand: BrandProfile,
): Promise<Buffer> {
  const baseColor = brand.colors[0] ?? "#ffffff";
  const background = await normalizeBackground(winner.b64, baseColor);
  const overlay = Buffer.from(adTextOverlaySvg(winner.concept, brand));
  return sharp(background)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function adTextOverlaySvg(concept: AdConcept, brand: BrandProfile): string {
  const align = concept.focalArea === "right" ? "right" : "left";
  const x = align === "right" ? OUTPUT_W - 140 : 140;
  const anchor = align === "right" ? "end" : "start";
  const ink = readableInk(brand.colors[0] ?? "#111111");
  const brandName = esc(brand.name.toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_W}" height="${OUTPUT_H}" viewBox="0 0 ${OUTPUT_W} ${OUTPUT_H}">
    <text x="${x}" y="${OUTPUT_H / 2}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="800" letter-spacing="4" fill="${ink}">${brandName}</text>
  </svg>`;
}

function rankCandidate(concept: AdConcept, revisedPrompt?: string): number {
  const prompt = revisedPrompt?.toLowerCase() ?? "";
  const textPenalty = /\b(text|word|letter|logo|typography|slogan)\b/.test(
    prompt,
  )
    ? 12
    : 0;
  const compositionBonus = /\b(clean|space|contrast|vector|abstract)\b/.test(
    prompt,
  )
    ? 6
    : 0;

  return concept.score + compositionBonus - textPenalty;
}

function resolveCandidateCount(): number {
  const raw = Number.parseInt(process.env.XAI_AD_CANDIDATES ?? "4", 10);
  if (Number.isNaN(raw)) return 4;
  return Math.max(4, Math.min(8, raw));
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

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand"
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
