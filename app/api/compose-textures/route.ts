import { NextResponse } from "next/server";
import { composeTextures } from "@/lib/composeTextures";
import type { BrandProfile, WrapDesign } from "@/lib/types";

/** Stage 6: brand + design -> one composed PNG texture per car part. */
export const POST = async (request: Request) => {
  let design: unknown;
  let brand: unknown;
  try {
    ({ design, brand } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedDesign = normalizeWrapDesign(design);
  if (!normalizedDesign) {
    return NextResponse.json({ error: "Missing 'design'" }, { status: 400 });
  }

  const normalizedBrand = normalizeBrandProfile(brand);

  try {
    // brand is optional: without it we still compose the graphic, just no name.
    const textures = await composeTextures(normalizedDesign, normalizedBrand);
    return NextResponse.json({ textures });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Texture composition failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

const normalizeWrapDesign = (value: unknown): WrapDesign | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<WrapDesign>;
  const id = candidate.id?.trim();
  const style = candidate.style?.trim();
  const description = candidate.description?.trim();
  const baseColor = candidate.baseColor?.trim();
  const graphics = normalizeGraphics(candidate.graphics);

  if (!id || !style || !description || !baseColor || !graphics) return null;

  return {
    id,
    style,
    description,
    baseColor,
    graphics,
    textures:
      candidate.textures && typeof candidate.textures === "object"
        ? candidate.textures
        : {},
  };
};

const normalizeGraphics = (
  value: WrapDesign["graphics"] | unknown,
): WrapDesign["graphics"] | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<WrapDesign["graphics"]>;
  const decalUrl = candidate.decalUrl?.trim();
  const patternUrl = candidate.patternUrl?.trim();

  if (!decalUrl || !patternUrl) return null;

  return { decalUrl, patternUrl };
};

const normalizeBrandProfile = (value: unknown): BrandProfile | undefined => {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as Partial<BrandProfile>;
  const name = candidate.name?.trim();
  if (!name) return undefined;

  return {
    name,
    description: candidate.description?.trim() ?? "",
    colors: sanitizeColors(candidate.colors),
    logoUrl: normalizeNullableString(candidate.logoUrl),
    screenshotPath: normalizeNullableString(candidate.screenshotPath),
    headlineText: candidate.headlineText?.trim() ?? "",
    keywords: sanitizeKeywords(candidate.keywords),
  };
};

const sanitizeColors = (value: BrandProfile["colors"] | unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(entry))
    .map((entry) =>
      entry.startsWith("#") ? entry.toUpperCase() : `#${entry.toUpperCase()}`,
    );
};

const sanitizeKeywords = (
  value: BrandProfile["keywords"] | unknown,
): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeNullableString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
};
