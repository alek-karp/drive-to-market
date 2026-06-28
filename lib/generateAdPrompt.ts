import type { BrandProfile } from "./types";

/**
 * Build the text prompt for the wrap ad. We hand Grok the brand identity and
 * ask for standalone flat production artwork. The generated image is mapped
 * onto the 3D car later, so the model must not include a car mockup itself.
 */
export function buildAdPrompt(brand: BrandProfile): string {
  const colors = brand.colors.slice(0, 4).join(", ") || "bold brand colors";
  const subheader = brand.headlineText || brand.description;
  return [
    `Create standalone flat 2D vehicle-wrap decal artwork for the brand "${brand.name}".`,
    brand.description ? `Brand context: ${brand.description}.` : "",
    `Use the brand colors ${colors}.`,
    "The artwork should look like a wide horizontal vinyl decal sheet: transparent or plain background, bold vector-style shapes, clean negative space, high contrast, dynamic accent lines, and a professional commercial wrap layout.",
    `Include only two text elements: the brand logo/name "${brand.name}" and one very short subheader${subheader ? ` inspired by "${subheader}"` : ""}. The subheader must be 2 to 5 words maximum.`,
    "Do not include paragraphs, body copy, bullet points, addresses, phone numbers, URLs, disclaimers, fine print, labels, or repeated text.",
    "Do not render a car, truck, van, car door, door handle, window, wheel, road, garage, showroom, photo background, mockup, or any vehicle surface.",
    "Output only the flat decal graphic artwork that will later be placed onto a 3D car.",
  ]
    .filter(Boolean)
    .join(" ");
}
