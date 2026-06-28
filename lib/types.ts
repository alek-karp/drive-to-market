// Shared types for the vehicle-wrap demo pipeline.

/** Stage 2 output: car paint material properties derived from a BrandProfile. */
export interface BaseCoat {
  /** Hex color for the car body paint. */
  color: string;
  /** PBR metalness 0–1. 0 = matte/plastic, 1 = mirror-metal. */
  metalness: number;
  /** PBR roughness 0–1. 0 = mirror, 1 = fully diffuse. */
  roughness: number;
}

/** Brand data extracted from a website (Stage 4). */
export interface BrandProfile {
  name: string;
  description: string;
  /** Primary first, then accents. Hex strings. */
  colors: string[];
  logoUrl: string | null;
  websiteUrl: string | null;
  screenshotPath: string | null;
  headlineText: string;
  keywords: string[];
  audience: string;
  offer: string;
  category: string;
  tone: string;
  differentiators: string[];
  requiredCta: string;
}

/** Deterministic marketing plan used before asking an image model for art. */
export interface AdConcept {
  id: string;
  hook: string;
  subheader: string;
  cta: string;
  visualDirection: string;
  focalArea: "left" | "center" | "right";
  score: number;
}

/** Raw wrap graphics generated for a concept (Stage 5). */
export interface WrapGraphics {
  /** Wide side decal, applied across the door/panel parts. */
  decalUrl: string;
  /** Square hood/roof pattern. */
  patternUrl: string;
  /** Dedicated transparent hood badge/logo graphic generated from brand data. */
  hoodUrl?: string;
  /** Dedicated transparent trunk CTA graphic generated from brand data. */
  trunkUrl?: string;
  /** Short LLM-generated trunk CTA copy rendered into the trunk graphic. */
  trunkCta?: string;
}

/** A generated wrap concept the user can pick (Stage 5/8). */
export interface WrapDesign {
  id: string;
  /** Style label shown in the picker: Clean / Bold / Luxury / Tech. */
  style: string;
  /** Short human description of the concept. */
  description: string;
  /** Dominant color used for the design swatch / base coat. */
  baseColor: string;
  /** PBR metalness applied to paint materials when this design is active. */
  metalness: number;
  /** PBR roughness applied to paint materials when this design is active. */
  roughness: number;
  /** Generated wrap graphics (Stage 5): the creative style, pre-composition. */
  graphics: WrapGraphics;
  /** Per-part texture URLs once composed (Stage 6). Empty until composed. */
  textures: Partial<Record<PaintablePart, string>>;
}

/** Mesh/material names of the paintable parts on the prepared car model. */
export type PaintablePart =
  | "door_left"
  | "door_right"
  | "hood"
  | "roof"
  | "trunk"
  | "panel_left"
  | "panel_right";
