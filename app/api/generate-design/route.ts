import { NextResponse } from "next/server";
import { normalizeBrandProfile } from "@/lib/brandProfile";
import { generateWrapDesigns } from "@/lib/generateWrapGraphics";

/** Stage 5: brand -> wrap concepts with generated graphics. */
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
    const designs = await generateWrapDesigns(normalizedBrand);
    return NextResponse.json({ designs });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Wrap generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
