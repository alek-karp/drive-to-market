import type { BrandProfile } from "./types";

/** The fixed set of concept styles offered in the demo (Stage 8). */
export const wrapStyles = ["Clean", "Bold", "Luxury", "Tech"] as const;
export type WrapStyle = (typeof wrapStyles)[number];

/**
 * Stage 5 (brand -> image-model prompt) lives here.
 *
 * Builds the text prompt for a given style. The demo generates graphics
 * procedurally (see {@link ./generateWrapGraphics}), but this is the seam where
 * a real image model would be called: feed this prompt to the model and write
 * the returned PNG instead of the procedural SVG.
 */
export function generateWrapPrompt(
  brand: BrandProfile,
  style: WrapStyle,
): string {
  const colors = brand.colors.join(", ");
  return [
    `Create a modern commercial vehicle wrap design for a sedan in a ${style.toLowerCase()} style.`,
    `Use the brand colors (${colors}) and the visual identity of "${brand.name}".`,
    "Flat wrap graphic / decal style with bold side graphics, hood accent and clean advertising layout.",
    "No realistic car render, no embedded text — text is added separately.",
  ].join(" ");
}
