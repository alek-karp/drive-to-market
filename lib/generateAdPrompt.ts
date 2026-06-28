import type { AdConcept, BrandProfile } from "./types";

export function buildAdConcepts(brand: BrandProfile, count = 4): AdConcept[] {
  const base = [
    concept(brand, "proof", "left", 92),
    concept(brand, "offer", "right", 88),
    concept(brand, "category", "center", 82),
    concept(brand, "speed", "left", 78),
    concept(brand, "premium", "right", 74),
    concept(brand, "local", "center", 70),
  ];

  return base.slice(0, Math.max(1, Math.min(count, base.length)));
}

export function buildAdBackgroundPrompt(
  brand: BrandProfile,
  concept: AdConcept,
): string {
  const primaryColor = brand.colors[0] ?? "the primary brand color";
  const accentColor = brand.colors[1] ?? "one subtle accent color";
  const differentiators = brand.differentiators.slice(0, 3).join(", ");

  return [
    `Create a sparse flat 2D vehicle-wrap background for ${brand.category} brand "${brand.name}".`,
    `Audience: ${brand.audience}. Tone: ${brand.tone}.`,
    `Visual direction: ${concept.visualDirection}.`,
    differentiators ? `Brand proof points: ${differentiators}.` : "",
    `Fill the entire background field edge-to-edge with solid ${primaryColor} as the dominant color covering roughly 80% of the image, so it blends seamlessly with a car painted ${primaryColor}.`,
    `Add only small accents of ${accentColor}; do not use white, gray, or any light neutral as the background.`,
    `The negative space and base field must be ${primaryColor}, not a light or neutral color.`,
    "Use one simple abstract shape family sitting on that solid color field.",
    "Prefer smooth bands, broad gradients, or one oversized geometric form.",
    "No arrows unless the brand identity explicitly uses arrows.",
    "No checkerboards, zebra stripes, maze patterns, dense line fields, tangled shapes, scattered icons, high-frequency detail, or visual clutter.",
    "No more than two dominant colors in the final image.",
    "Do not reserve space for text; this texture must work as background art only.",
    "Do not generate any words, letters, logos, fake typography, tiny labels, UI, paragraphs, URLs, phone numbers, addresses, badges, watermarks, signatures, or repeated text.",
    "Do not render a car, truck, van, door handle, wheel, road, garage, showroom, photo background, or mockup.",
    "Output only clean abstract background artwork.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildAvatarPrompt(brand: BrandProfile): string {
  const primaryColor = brand.colors[0] ?? "the primary brand color";
  const accentColor = brand.colors[1] ?? "a complementary accent color";

  return [
    `Create a bold, friendly mascot or character avatar for the brand "${brand.name}" (${brand.category}).`,
    `Audience: ${brand.audience}. Tone: ${brand.tone}.`,
    `The mascot should visually embody the brand's personality and be instantly recognizable.`,
    `Design it as a single centered character or creature illustration — clean, vector-style, with strong outlines.`,
    `Use ${primaryColor} as the dominant color and ${accentColor} as an accent.`,
    `The character should fill the center of the image with generous white padding around it.`,
    "Make it charming, simple, and memorable — the kind of mascot you'd put on a vehicle decal.",
    "No text, no logos, no typography, no speech bubbles, no backgrounds with scenes or gradients.",
    "Output only the mascot character centered on a pure solid white background. The background must be fully white (#FFFFFF) with no shadows, gradients, or vignettes.",
    "High contrast against white, clean edges, suitable for large-format vehicle wrap printing.",
  ]
    .filter(Boolean)
    .join(" ");
}

function concept(
  brand: BrandProfile,
  angle: "proof" | "offer" | "category" | "speed" | "premium" | "local",
  focalArea: AdConcept["focalArea"],
  score: number,
): AdConcept {
  const category = titleCase(brand.category);
  const differentiator = brand.differentiators[0] ?? brand.offer;

  const copy = {
    proof: {
      hook: shortLine(brand.headlineText || `${brand.name} That Delivers`, 34),
      subheader: shortLine(differentiator, 46),
      visualDirection:
        "one oversized soft geometric form with generous calm space",
    },
    offer: {
      hook: shortLine(brand.offer, 34),
      subheader: shortLine(`Built for ${brand.audience}`, 46),
      visualDirection:
        "a simple broad diagonal color field with restrained contrast",
    },
    category: {
      hook: shortLine(`${category}, Made Clear`, 34),
      subheader: shortLine(brand.description, 46),
      visualDirection:
        "one crisp category-neutral graphic anchor on a quiet field",
    },
    speed: {
      hook: shortLine(`Move Faster With ${brand.name}`, 34),
      subheader: shortLine(brand.offer, 46),
      visualDirection:
        "a single smooth sweep suggesting motion without arrows or busy lines",
    },
    premium: {
      hook: shortLine(`Choose ${brand.name}`, 34),
      subheader: shortLine(differentiator, 46),
      visualDirection:
        "restrained premium background with one precise accent shape",
    },
    local: {
      hook: shortLine(`${brand.name} Near You`, 34),
      subheader: shortLine(`For ${brand.audience}`, 46),
      visualDirection:
        "friendly simple campaign background with one memorable shape",
    },
  }[angle];

  return {
    id: angle,
    hook: copy.hook,
    subheader: copy.subheader,
    cta: shortLine(carWrapCta(brand), 28),
    visualDirection: copy.visualDirection,
    focalArea,
    score,
  };
}

function carWrapCta(brand: BrandProfile): string {
  const domain = displayDomain(brand.websiteUrl);
  if (domain) return domain;

  const cta = brand.requiredCta.trim();
  if (/quote|estimate|consult/i.test(cta)) return cta;
  if (/book|schedule|appointment/i.test(cta)) return "Book by phone";
  if (/shop|order|menu/i.test(cta)) return "Visit online";
  return "Call for a quote";
}

function displayDomain(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}

function shortLine(value: string, max: number): string {
  const text = value.replace(/[|•]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "Ready When You Are";
  if (text.length <= max) return text;

  const words = text.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return out || text.slice(0, max).trim();
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
