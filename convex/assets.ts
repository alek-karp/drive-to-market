import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_ORG_ID, SEED_USER_ID } from "./constants";
import { assetSourceValidator, assetTypeValidator } from "./validators";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createAsset = mutation({
  args: {
    orgId: v.string(),
    projectId: v.optional(v.id("projects")),
    type: assetTypeValidator,
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.optional(v.number()),
    source: assetSourceValidator,
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("assets", {
      orgId: args.orgId,
      projectId: args.projectId,
      type: args.type,
      storageId: args.storageId,
      filename: args.filename,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      source: args.source,
      status: "ready",
      createdBy: args.createdBy ?? SEED_USER_ID,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listByOrgAndType = query({
  args: {
    orgId: v.optional(v.string()),
    type: assetTypeValidator,
  },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEFAULT_ORG_ID;
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", orgId).eq("type", args.type),
      )
      .collect();

    const ready = rows.filter((row) => row.status !== "deleted");
    return Promise.all(
      ready.map(async (row) => ({
        id: row._id,
        filename: row.filename,
        contentType: row.contentType,
        type: row.type,
        url: await ctx.storage.getUrl(row.storageId),
      })),
    );
  },
});

/** Logo picker shape: id, display name, HTTPS URL. */
export const listLogos = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEFAULT_ORG_ID;
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("type", "logo"))
      .collect();

    const ready = rows.filter((row) => row.status !== "deleted");
    return Promise.all(
      ready.map(async (row) => ({
        id: row._id,
        name: displayNameFromFilename(row.filename),
        logoUrl: await ctx.storage.getUrl(row.storageId),
        file: row.filename,
      })),
    );
  },
});

/** Default wrap car: `tesla.glb` in Convex storage, or null to fall back to `/models/tesla.glb`. */
export const getTeslaModelUrl = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const orgId = args.orgId ?? DEFAULT_ORG_ID;
    const rows = await ctx.db
      .query("assets")
      .withIndex("by_org_type", (q) =>
        q.eq("orgId", orgId).eq("type", "car_model"),
      )
      .collect();

    const tesla = rows.find(
      (row) =>
        row.status !== "deleted" && row.filename.toLowerCase() === "tesla.glb",
    );
    if (!tesla) return null;

    return await ctx.storage.getUrl(tesla.storageId);
  },
});

export const getAssetWithUrl = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.status === "deleted") return null;

    // TODO: org/project permission checks before returning URL.
    const url = await ctx.storage.getUrl(asset.storageId);
    return { ...asset, url };
  },
});

function displayNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/i, "").replace(/[_-]+/g, " ");
  return base
    .replace(/\d+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
