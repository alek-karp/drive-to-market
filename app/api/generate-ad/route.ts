import { NextResponse } from "next/server";
import { generateAdDesign } from "@/lib/generateAd";
import type { BrandProfile } from "@/lib/types";

/** Single live ad generation via Grok: brand -> one AI wrap concept. */
export const POST = async (request: Request) => {
  let brand: unknown;
  try {
    ({ brand } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedBrand = normalizeBrandProfile(brand);
  if (!normalizedBrand) {
    return NextResponse.json({ error: "Missing 'brand'" }, { status: 400 });
  }

  try {
    const design = await generateAdDesign(normalizedBrand);
    return NextResponse.json({ design });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ad generation failed";
    return NextResponse.json(
      { error: message },
      { status: resolveErrorStatus(message) },
    );
  }
};

const normalizeBrandProfile = (value: unknown): BrandProfile | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<BrandProfile>;
  const name = candidate.name?.trim();
  if (!name) return null;

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

const resolveErrorStatus = (message: string): number => {
  if (message.includes("XAI_API_KEY is not set")) return 503;
  if (message.includes("Grok image request failed")) return 502;
  return 500;
};
