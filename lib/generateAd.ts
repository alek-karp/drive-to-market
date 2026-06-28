import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildAdPrompt } from "./generateAdPrompt";
import type { BrandProfile, WrapDesign } from "./types";

/**
 * Real AI ad generation via xAI's Grok image model.
 *
 * This is the first live image-model integration in the pipeline. Everywhere
 * else the demo fabricates wrap graphics procedurally (see
 * {@link ./generateWrapGraphics}); here we actually call Grok to generate a
 * single advertising graphic from the brand profile and apply it to the car.
 *
 * The returned {@link WrapDesign} points its decal *and* pattern at the one
 * generated image, so Stage 7 ({@link ../components/CarModel}) paints it onto
 * every body part directly — no Stage 6 composition needed for this test path.
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

  const prompt = buildAdPrompt(brand);
  const { b64, revisedPrompt } = await requestGrokImage(apiKey, prompt);

  const id = `${slug(brand.name)}-ai-ad`;
  const adUrl = await saveAd(id, b64);

  return {
    id,
    style: "AI Ad",
    description: revisedPrompt
      ? truncate(revisedPrompt, 90)
      : "Live ad generated from your brand by Grok.",
    baseColor: brand.colors[0] ?? "#111111",
    graphics: { decalUrl: adUrl, patternUrl: adUrl },
    textures: {},
  };
}

/** Where Grok's image model is reached. Overridable for self-hosting/tests. */
const XAI_BASE_URL = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
const XAI_IMAGE_MODEL = process.env.XAI_IMAGE_MODEL ?? "grok-imagine-image";

interface GrokImage {
  b64: string;
  revisedPrompt?: string;
}

/** Call xAI's OpenAI-compatible image endpoint and return the first image. */
async function requestGrokImage(
  apiKey: string,
  prompt: string,
): Promise<GrokImage> {
  const res = await fetch(`${XAI_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: XAI_IMAGE_MODEL,
      prompt,
      n: 1,
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
  const first = json.data?.[0];
  if (!first?.b64_json) {
    throw new Error("Grok returned no image data.");
  }

  return { b64: first.b64_json, revisedPrompt: first.revised_prompt };
}

const GENERATED_DIR = path.join(
  process.cwd(),
  "public",
  "textures",
  "generated",
);

/**
 * Normalize Grok's image to PNG (it may return JPEG) and write it under the
 * design's generated folder. Returns the public URL Stage 7 loads.
 */
async function saveAd(designId: string, b64: string): Promise<string> {
  const dir = path.join(GENERATED_DIR, designId);
  await mkdir(dir, { recursive: true });
  const png = await sharp(Buffer.from(b64, "base64")).png().toBuffer();
  await writeFile(path.join(dir, "ad.png"), png);
  return `/textures/generated/${designId}/ad.png`;
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

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
