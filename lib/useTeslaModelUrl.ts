"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { MODEL_PATH } from "@/lib/carModel";

/**
 * Tesla GLB URL from Convex when seeded; falls back to the local static file.
 */
export function useTeslaModelUrl(): string {
  const hasConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const convexUrl = useQuery(
    api.assets.getTeslaModelUrl,
    hasConvex ? {} : "skip",
  );
  return convexUrl ?? MODEL_PATH;
}
