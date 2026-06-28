import { NextResponse } from "next/server";
import { normalizeOptionalBrandProfile } from "@/lib/brandProfile";
import { composeTextures } from "@/lib/composeTextures";
import type { WrapDesign } from "@/lib/types";

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

  const normalizedBrand = normalizeOptionalBrandProfile(brand);

  try {
    // brand is optional: without it we still compose the graphic, just no name.
    const result = await composeTextures(normalizedDesign, normalizedBrand);
    return NextResponse.json(result);
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
  const hoodUrl = candidate.hoodUrl?.trim();
  const trunkUrl = candidate.trunkUrl?.trim();
  const trunkCta = candidate.trunkCta?.trim();

  if (!decalUrl || !patternUrl) return null;

  return {
    decalUrl,
    patternUrl,
    ...(hoodUrl ? { hoodUrl } : {}),
    ...(trunkUrl ? { trunkUrl } : {}),
    ...(trunkCta ? { trunkCta } : {}),
  };
};
