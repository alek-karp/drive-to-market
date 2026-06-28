import type { BaseCoat, BrandProfile } from "./types";

/**
 * Stage 2: BrandProfile -> BaseCoat (color + PBR material properties).
 *
 * The base color is the brand's primary color. Metalness and roughness are
 * inferred from the brand's industry category and tone — a luxury brand gets
 * a high-gloss metallic finish; a food brand gets a matte one.
 */
export function deriveBaseCoat(brand: BrandProfile): BaseCoat {
  const color = brand.colors[0] ?? "#111111";
  const profile = categoryProfile(brand.category);

  const metalness = clamp(
    profile.metalness + toneNudge(brand.tone, "metalness"),
    0,
    1,
  );
  const roughness = clamp(
    profile.roughness + toneNudge(brand.tone, "roughness"),
    0.05,
    1,
  );

  return { color, metalness, roughness };
}

interface MaterialProfile {
  metalness: number;
  roughness: number;
}

const CATEGORY_PROFILES: Array<{
  keywords: string[];
  profile: MaterialProfile;
}> = [
  {
    keywords: [
      "luxury",
      "jewelry",
      "jewellery",
      "watches",
      "fashion",
      "designer",
    ],
    profile: { metalness: 0.85, roughness: 0.12 },
  },
  {
    keywords: ["automotive", "industrial", "manufacturing", "aerospace"],
    profile: { metalness: 0.7, roughness: 0.25 },
  },
  {
    keywords: ["tech", "technology", "software", "saas", "electronics", "ai"],
    profile: { metalness: 0.15, roughness: 0.6 },
  },
  {
    keywords: ["finance", "banking", "insurance", "fintech", "investment"],
    profile: { metalness: 0.5, roughness: 0.3 },
  },
  {
    keywords: ["sports", "fitness", "athletic", "outdoor", "adventure"],
    profile: { metalness: 0.25, roughness: 0.5 },
  },
  {
    keywords: ["health", "wellness", "medical", "dental", "pharmacy"],
    profile: { metalness: 0.15, roughness: 0.55 },
  },
  {
    keywords: ["food", "restaurant", "cafe", "bakery", "beverage", "coffee"],
    profile: { metalness: 0.1, roughness: 0.7 },
  },
];

const DEFAULT_PROFILE: MaterialProfile = { metalness: 0.4, roughness: 0.35 };

function categoryProfile(category: string): MaterialProfile {
  const lower = category.toLowerCase();
  for (const { keywords, profile } of CATEGORY_PROFILES) {
    if (keywords.some((k) => lower.includes(k))) return profile;
  }
  return DEFAULT_PROFILE;
}

/** Adjust metalness/roughness slightly based on tone keywords. */
function toneNudge(tone: string, property: "metalness" | "roughness"): number {
  const lower = tone.toLowerCase();
  const isPremium = /\b(premium|luxury|elegant|sophisticated|high.end)\b/.test(
    lower,
  );
  const isCasual = /\b(casual|fun|playful|friendly|approachable)\b/.test(lower);

  if (property === "metalness") {
    if (isPremium) return 0.1;
    if (isCasual) return -0.1;
    return 0;
  }
  // roughness
  if (isPremium) return -0.05;
  if (isCasual) return 0.1;
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
