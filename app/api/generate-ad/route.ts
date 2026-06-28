import { NextResponse } from "next/server";
import { normalizeBrandProfile } from "@/lib/brandProfile";
import { generateAdDesign } from "@/lib/generateAd";

/** Live ad generation via Grok: brand strategy -> ranked/composited wrap ad. */
export const POST = async (request: Request) => {
  let brand: unknown;
  try {
    ({ brand } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedBrand = normalizeBrandProfile(brand);
  if (!normalizedBrand) {
    return NextResponse.json({ error: "Missing 'brand'" }, { status: 400 });
  }

  try {
    const design = await generateAdDesign(normalizedBrand);
    return NextResponse.json({ design });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ad generation failed";
    return NextResponse.json(
      { error: message },
      { status: resolveErrorStatus(message) },
    );
  }
};

const resolveErrorStatus = (message: string): number => {
  if (message.includes("XAI_API_KEY is not set")) return 503;
  if (message.includes("Grok image request failed")) return 502;
  return 500;
};
