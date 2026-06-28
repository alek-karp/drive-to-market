// Shared types for the vehicle-wrap demo pipeline.

/** Brand data extracted from a website (Stage 4). */
export interface BrandProfile {
  name: string;
  description: string;
  /** Primary first, then accents. Hex strings. */
  colors: string[];
  logoUrl: string | null;
  screenshotPath: string | null;
  headlineText: string;
  keywords: string[];
}

/** Raw wrap graphics generated for a concept (Stage 5). */
export interface WrapGraphics {
  /** Wide side decal, applied across the door/panel parts. */
  decalUrl: string;
  /** Square hood/roof pattern. */
  patternUrl: string;
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
