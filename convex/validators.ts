import { v } from "convex/values";

export const assetTypeValidator = v.union(
  v.literal("logo"),
  v.literal("styleguide"),
  v.literal("car_model"),
  v.literal("texture"),
  v.literal("render"),
  v.literal("mask"),
  v.literal("reference_image"),
);

export const assetSourceValidator = v.union(
  v.literal("user_upload"),
  v.literal("generated"),
  v.literal("seed_asset"),
  v.literal("external"),
);

export const assetStatusValidator = v.union(
  v.literal("uploaded"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("deleted"),
);
