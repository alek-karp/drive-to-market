import { NextResponse } from "next/server";
import { deriveBaseCoat } from "@/lib/baseColor";
import { normalizeBrandProfile } from "@/lib/brandProfile";

/** Stage 2: brand profile -> base coat color + PBR material properties. */
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

  const baseCoat = deriveBaseCoat(normalizedBrand);
  return NextResponse.json({ baseCoat });
};
