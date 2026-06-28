import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { normalizeBrandProfile } from "@/lib/brandProfile";
import { enhanceBrandVisuals } from "@/lib/brandVisuals";
import { scrapeWebsite } from "@/lib/scrapeWebsite";
import type { BrandProfile } from "@/lib/types";

/**
 * Brand extraction: Exa via Convex for rich brand copy, HTML scrape as fallback.
 * Both paths are then visually enhanced so the logo and palette are on-brand
 * (real logo mark + colors derived from it) rather than a hero screenshot/black.
 */
export async function extractBrandFromUrl(url: string): Promise<BrandProfile> {
  const brand = await extractBaseBrand(url);
  try {
    return await enhanceBrandVisuals(brand);
  } catch {
    return brand;
  }
}

async function extractBaseBrand(url: string): Promise<BrandProfile> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl);
      const raw = await client.action(api.brand.extractFromUrl, { url });
      const brand = normalizeBrandProfile(raw);
      if (brand) return brand;
    } catch (error) {
      console.warn(
        "[extractBrand] Convex/Exa failed, falling back to HTML scrape:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return scrapeWebsite(url);
}
