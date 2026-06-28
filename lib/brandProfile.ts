import type { BrandProfile } from "./types";

export function normalizeBrandProfile(value: unknown): BrandProfile | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<BrandProfile>;
  const name = candidate.name?.trim();
  if (!name) return null;

  return {
    name,
    description: candidate.description?.trim() ?? "",
    colors: sanitizeColors(candidate.colors),
    logoUrl: normalizeNullableString(candidate.logoUrl),
    websiteUrl: normalizeNullableString(candidate.websiteUrl),
    screenshotPath: normalizeNullableString(candidate.screenshotPath),
    headlineText: candidate.headlineText?.trim() ?? "",
    keywords: sanitizeKeywords(candidate.keywords),
    audience: candidate.audience?.trim() ?? "local customers",
    offer: candidate.offer?.trim() ?? "a clear reason to choose the brand",
    category: candidate.category?.trim() ?? "business",
    tone: candidate.tone?.trim() ?? "confident and approachable",
    differentiators: sanitizeKeywords(candidate.differentiators),
    requiredCta: candidate.requiredCta?.trim() ?? "Get Started",
  };
}

export function normalizeOptionalBrandProfile(
  value: unknown,
): BrandProfile | undefined {
  return normalizeBrandProfile(value) ?? undefined;
}

export function sanitizeColors(value: BrandProfile["colors"] | unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(entry))
    .map((entry) =>
      entry.startsWith("#") ? entry.toUpperCase() : `#${entry.toUpperCase()}`,
    );
}

export function sanitizeKeywords(value: string[] | unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed || null;
}
