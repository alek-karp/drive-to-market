import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  assetSourceValidator,
  assetStatusValidator,
  assetTypeValidator,
} from "./validators";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    orgId: v.string(),
    createdBy: v.string(),
    carModelAssetId: v.optional(v.id("assets")),
    status: v.union(
      v.literal("draft"),
      v.literal("rendering"),
      v.literal("complete"),
      v.literal("archived"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_createdBy", ["createdBy"]),

  assets: defineTable({
    orgId: v.string(),
    projectId: v.optional(v.id("projects")),
    type: assetTypeValidator,
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    source: assetSourceValidator,
    status: assetStatusValidator,
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_type", ["type"])
    .index("by_org_type", ["orgId", "type"]),

  carSegments: defineTable({
    carModelAssetId: v.id("assets"),
    segmentKey: v.string(),
    displayName: v.string(),
    bodyRegion: v.union(
      v.literal("hood"),
      v.literal("roof"),
      v.literal("left_door"),
      v.literal("right_door"),
      v.literal("front_bumper"),
      v.literal("rear_bumper"),
      v.literal("left_fender"),
      v.literal("right_fender"),
      v.literal("rear_quarter"),
      v.literal("trunk"),
      v.literal("other"),
    ),
    isPaintable: v.boolean(),
    uvBounds: v.optional(
      v.object({
        minU: v.number(),
        minV: v.number(),
        maxU: v.number(),
        maxV: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_carModel", ["carModelAssetId"])
    .index("by_segmentKey", ["segmentKey"]),

  placements: defineTable({
    projectId: v.id("projects"),
    assetId: v.id("assets"),
    carSegmentId: v.id("carSegments"),
    projectionMode: v.union(
      v.literal("decal"),
      v.literal("uv"),
      v.literal("planar"),
      v.literal("cylindrical"),
    ),
    preserveAspectRatio: v.boolean(),
    position: v.object({
      x: v.number(),
      y: v.number(),
      z: v.optional(v.number()),
    }),
    rotation: v.object({
      x: v.optional(v.number()),
      y: v.optional(v.number()),
      z: v.number(),
    }),
    scale: v.object({
      x: v.number(),
      y: v.number(),
    }),
    opacity: v.optional(v.number()),
    zIndex: v.optional(v.number()),
    locked: v.optional(v.boolean()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_asset", ["assetId"])
    .index("by_segment", ["carSegmentId"]),

  renders: defineTable({
    projectId: v.id("projects"),
    assetId: v.id("assets"),
    renderType: v.union(
      v.literal("screenshot"),
      v.literal("turntable"),
      v.literal("texture_bake"),
      v.literal("final_export"),
    ),
    cameraAngle: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("rendering"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_asset", ["assetId"]),
});
