import type { PaintablePart } from "./types";

/**
 * The mesh/material names on the prepared car model that we paint.
 * Stage 2 produces a model whose meshes use exactly these names.
 */
export const paintableParts: PaintablePart[] = [
  "door_left",
  "door_right",
  "hood",
  "roof",
  "trunk",
  "panel_left",
  "panel_right",
];

/** Texture dimensions + placement anchors per part (Stage 6). */
export interface PartTextureConfig {
  width: number;
  height: number;
  /** [x, y] in texture pixels, where applicable. */
  logoPosition?: [number, number];
  decalPosition?: [number, number];
}

export const carPartTextureConfig: Record<PaintablePart, PartTextureConfig> = {
  door_left: {
    width: 2048,
    height: 1024,
    logoPosition: [200, 300],
    decalPosition: [700, 100],
  },
  door_right: {
    width: 2048,
    height: 1024,
    logoPosition: [200, 300],
    decalPosition: [700, 100],
  },
  hood: {
    width: 1024,
    height: 1024,
    logoPosition: [400, 400],
  },
  roof: {
    width: 1024,
    height: 1024,
  },
  trunk: {
    width: 1024,
    height: 1024,
    logoPosition: [400, 400],
  },
  panel_left: {
    width: 2048,
    height: 1024,
    decalPosition: [600, 200],
  },
  panel_right: {
    width: 2048,
    height: 1024,
    decalPosition: [600, 200],
  },
};
