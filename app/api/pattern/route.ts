import { NextResponse } from "next/server";
import { normalizeBrandProfile } from "@/lib/brandProfile";
import { derivePattern } from "@/lib/pattern";

/** Stage 3: brand profile -> pattern type + generated overlay texture URL. */
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

  const pattern = await derivePattern(normalizedBrand);
  return NextResponse.json({ pattern });
};
