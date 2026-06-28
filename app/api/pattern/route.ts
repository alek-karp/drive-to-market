import { NextResponse } from "next/server";
import { normalizeBrandProfile } from "@/lib/brandProfile";
import { derivePattern } from "@/lib/pattern";

/** Stage 3: brand profile -> subtle full-coverage livery pattern texture. */
export const POST = async (request: Request) => {
  let brand: unknown;
  let designId: unknown;
  try {
    ({ brand, designId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedBrand = normalizeBrandProfile(brand);
  if (!normalizedBrand) {
    return NextResponse.json({ error: "Missing 'brand'" }, { status: 400 });
  }

  const pattern = await derivePattern(
    normalizedBrand,
    typeof designId === "string" ? designId : undefined,
    process.env.XAI_API_KEY,
  );
  return NextResponse.json({ pattern });
};
