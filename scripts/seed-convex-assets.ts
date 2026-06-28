/**
 * Upload local seed assets from public/Logos and public/models into Convex.
 *
 * Usage:
 *   bun run seed:assets
 *
 * Requires NEXT_PUBLIC_CONVEX_URL in .env.local (from `bunx convex dev`).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const ROOT = process.cwd();
const LOGOS_DIR = process.env.LOGOS_DIR ?? path.join(ROOT, "public", "Logos");
const MODELS_DIR =
  process.env.MODELS_DIR ?? path.join(ROOT, "public", "models");
/** Only seed the default wrap car unless MODEL_FILES is set (comma-separated). */
const MODEL_FILES = (process.env.MODEL_FILES ?? "tesla.glb")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ORG_ID = process.env.CONVEX_SEED_ORG_ID ?? "drive-to-market";

const LOGO_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".webp",
  ".gif",
]);

type AssetType = "logo" | "car_model";

async function main() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is not set. Run `bunx convex dev` once to create .env.local.",
    );
  }

  const client = new ConvexHttpClient(convexUrl);
  const uploaded: Array<{ type: AssetType; filename: string; id: string }> = [];

  const logoFiles = await listFilesIfExists(LOGOS_DIR, LOGO_EXTENSIONS);
  if (logoFiles.length === 0) {
    console.warn(
      `No logos found in ${LOGOS_DIR}. Restore public/Logos/ or pass LOGOS_DIR=...`,
    );
  }
  for (const filePath of logoFiles) {
    const id = await uploadLocalFile(client, filePath, "logo");
    uploaded.push({
      type: "logo",
      filename: path.basename(filePath),
      id,
    });
    console.log(`✓ logo  ${path.basename(filePath)}`);
  }

  const allModelFiles = await listFilesIfExists(
    MODELS_DIR,
    new Set([".glb", ".gltf"]),
  );
  const modelFiles = allModelFiles.filter((filePath) =>
    MODEL_FILES.includes(path.basename(filePath)),
  );
  for (const filePath of modelFiles) {
    const id = await uploadLocalFile(client, filePath, "car_model");
    uploaded.push({
      type: "car_model",
      filename: path.basename(filePath),
      id,
    });
    console.log(`✓ model ${path.basename(filePath)}`);
  }

  console.log(`\nUploaded ${uploaded.length} assets to org "${ORG_ID}".`);
  console.log("Verify in dashboard: Data → assets, Storage");
}

async function listFilesIfExists(
  dir: string,
  extensions: Set<string>,
): Promise<string[]> {
  try {
    return await listFiles(dir, extensions);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function listFiles(
  dir: string,
  extensions: Set<string>,
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => extensions.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name))
    .sort();
}

async function uploadLocalFile(
  client: ConvexHttpClient,
  filePath: string,
  type: AssetType,
): Promise<string> {
  const filename = path.basename(filePath);
  const bytes = await readFile(filePath);
  const contentType = contentTypeFor(filename);

  const uploadUrl = await client.mutation(api.assets.generateUploadUrl, {});
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!uploadRes.ok) {
    throw new Error(
      `Upload failed for ${filename}: ${uploadRes.status} ${uploadRes.statusText}`,
    );
  }

  const { storageId } = (await uploadRes.json()) as {
    storageId: Id<"_storage">;
  };

  const assetId = await client.mutation(api.assets.createAsset, {
    orgId: ORG_ID,
    type,
    storageId,
    filename,
    contentType,
    sizeBytes: bytes.length,
    source: "seed_asset",
  });

  return assetId as string;
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".glb":
      return "model/gltf-binary";
    case ".gltf":
      return "model/gltf+json";
    default:
      return "application/octet-stream";
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
