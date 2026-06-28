// Stage 2: model inspection + part classification.
//
// The prepared models are NOT separated into named body parts (door_left, hood,
// roof, ...) the way the original plan assumed. They are typical assets grouped
// mostly by material, so we classify mesh materials into semantic categories.
//
// The wrap renderer then paints only the `body` category; everything else
// (wheels, glass, chrome, lights, trim) is left untouched.

export const MODEL_PATH = "/models/tesla.glb";

/** Semantic groups every mesh in the model is sorted into. */
export type CarPartCategory =
  | "body"
  | "wheels"
  | "glass"
  | "chrome"
  | "lights"
  | "trim"
  | "accents"
  | "other";

/** Categories whose surfaces receive the generated wrap textures (Stage 7). */
export const PAINTABLE_CATEGORIES: readonly CarPartCategory[] = ["body"];

/** Human labels for the viewer overlay. */
export const CATEGORY_LABELS: Record<CarPartCategory, string> = {
  body: "Body (paintable)",
  wheels: "Wheels",
  glass: "Glass",
  chrome: "Chrome",
  lights: "Lights",
  trim: "Trim",
  accents: "Accents",
  other: "Other",
};

/**
 * Exact material-name → category map for this model. Material names come from
 * the GLB (see the meshes' `_<material>` suffixes).
 */
const MATERIAL_CATEGORY: Record<string, CarPartCategory> = {
  // Datsun asset
  paint: "body",
  coat: "body",
  tire: "wheels",
  alloy: "wheels",
  glass: "glass",
  orange_glass: "glass",
  red_glass: "glass",
  chrome: "chrome",
  headlights: "lights",
  black_paint: "trim",
  black_matte: "trim",
  license: "accents",
  stickers: "accents",

  // Tesla asset
  material_2125765635: "body",
  material_2125767099: "trim", // wheel-arch / lower rocker — at rim height, must not be painted
  rubber_rough: "wheels",
  rubber_rough222: "wheels",
  black222: "wheels",
  glass_base: "glass",
  glass_headlight222: "glass",
  glass_roof_panorama: "glass",
  front_white_light: "lights",
  back_red_light: "lights",
  red_plastic: "lights",
  iron_clean_distorted: "chrome",
  mirror: "trim",
  black: "trim",
  black_base: "trim",
  black_reflection: "trim",
  "black.001": "trim",
  "black.002": "trim",
  material_111: "trim",
  "04_-_default": "trim",
  material: "accents",
};

/**
 * Classify a mesh into a category from its material name. Falls back to
 * substring heuristics so an unexpected/renamed material still lands somewhere
 * sensible rather than breaking targeting.
 */
export function categoryForMaterial(
  materialName: string | undefined | null,
): CarPartCategory {
  if (!materialName) return "other";
  const name = materialName.toLowerCase();

  const exact = MATERIAL_CATEGORY[name];
  if (exact) return exact;

  if (name.includes("tire") || name.includes("alloy") || name.includes("rim")) {
    return "wheels";
  }
  if (name.includes("glass")) return "glass";
  if (name.includes("chrome")) return "chrome";
  if (name.includes("headlight") || name.includes("light")) return "lights";
  if (
    name.includes("sticker") ||
    name.includes("license") ||
    name.includes("decal")
  ) {
    return "accents";
  }
  // "black_paint"/"black_matte" are trim, plain "paint"/"coat" are the body.
  if (name.includes("black") || name.includes("matte")) return "trim";
  if (name.includes("coat") || name.includes("paint")) return "body";

  return "other";
}

/**
 * Tesla interior cabin uses a smaller `black_base` mesh (~7 m³) than the
 * exterior panels (~11–14 m³). Only exterior panels receive wrap textures.
 */
const EXTERIOR_PANEL_VOLUME = 10;

/**
 * Meshes that receive wrap paint / livery patterns.
 */
export function isWrappableMesh(
  materialName: string,
  meshVolume: number,
): boolean {
  const name = materialName.toLowerCase();
  if (name === "paint" || name === "material_2125765635") return true;
  if (name === "black_base") return meshVolume >= EXTERIOR_PANEL_VOLUME;
  return false;
}

/**
 * Opaque reflective windshield shell — hide while a wrap is active so the paint
 * layer underneath stays visible. Interior `black_base` meshes are never hidden.
 */
export function isReflectiveOverlayShell(
  materialName: string,
  meshVolume: number,
): boolean {
  return (
    materialName.toLowerCase() === "black_reflection" &&
    meshVolume >= EXTERIOR_PANEL_VOLUME
  );
}
