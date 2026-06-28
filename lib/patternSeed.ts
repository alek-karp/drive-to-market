import type { BrandProfile, PaintablePart, PatternType } from "./types";

export interface PatternVariant {
  seed: number;
  type: Exclude<PatternType, "ai" | "none">;
  spacingScale: number;
  phaseX: number;
  phaseY: number;
  twirlTurn: number;
}

/** FNV-1a — stable numeric seed from any string. */
export function patternSeed(source: string): number {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const MOTIF_POOL: Exclude<PatternType, "ai" | "none">[] = [
  "shards",
  "speedlines",
  "fracture",
];

function motifPoolForBrand(
  brand: BrandProfile,
): Exclude<PatternType, "ai" | "none">[] {
  const lower =
    `${brand.category} ${brand.tone} ${brand.keywords.join(" ")}`.toLowerCase();

  if (
    /sport|fitness|athletic|racing|adventure|outdoor|automotive/.test(lower)
  ) {
    return ["fracture", "shards", "speedlines"];
  }
  if (/tech|software|saas|ai|electronics|startup/.test(lower)) {
    return ["shards", "speedlines", "fracture"];
  }

  return MOTIF_POOL;
}

/** Same brand + design id → same variant; different brands → different motifs/layout. */
export function derivePatternVariant(
  brand: BrandProfile,
  designId?: string,
): PatternVariant {
  const seed = patternSeed(`${designId ?? brand.name}|${brand.category}`);
  const rng = seededRandom(seed);
  const pool = motifPoolForBrand(brand);
  const type =
    rng() < 0.55
      ? "fracture"
      : (pool[Math.floor(rng() * pool.length)] ?? "fracture");

  return {
    seed,
    type,
    spacingScale: 1.22 + rng() * 0.38,
    phaseX: rng() * 640,
    phaseY: rng() * 640,
    twirlTurn: rng() * 360,
  };
}

export function partPatternPhase(
  designId: string,
  part: PaintablePart,
): { x: number; y: number } {
  const rng = seededRandom(patternSeed(`${designId}:${part}`));
  return {
    x: Math.floor(rng() * 640),
    y: Math.floor(rng() * 640),
  };
}

export function motifLabel(type: Exclude<PatternType, "ai" | "none">): string {
  return (
    {
      shards: "angular shard panels and tapered fragments",
      speedlines: "clusters of parallel speed lines following curves",
      fracture: "mixed angular shards with parallel speed-line bursts",
      none: "solid fill",
    } as const
  )[type];
}
