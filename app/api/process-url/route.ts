import { NextResponse } from "next/server";
import { scrapeWebsite } from "@/lib/scrapeWebsite";

/** Stage 4: URL -> brand profile (live extraction with graceful fallback). */
export const POST = async (request: Request) => {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof url !== "string" || url.trim().length === 0) {
    return NextResponse.json({ error: "Missing 'url'" }, { status: 400 });
  }

  const normalizedUrl = normalizeWebsiteUrl(url);
  if (!normalizedUrl) {
    return NextResponse.json(
      { error: "Invalid 'url' — provide a valid website URL" },
      { status: 400 },
    );
  }

  try {
    const brand = await scrapeWebsite(normalizedUrl);
    return NextResponse.json({ brand, normalizedUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Website processing failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
};

const normalizeWebsiteUrl = (raw: string): string | null => {
  const candidate = raw.trim();
  if (!candidate) return null;

  try {
    const url = new URL(
      /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
    );
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!url.hostname || /\s/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
};
