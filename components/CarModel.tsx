"use client";

import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Box3,
  BufferAttribute,
  Color,
  Euler,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import {
  type CarPartCategory,
  categoryForMaterial,
  MODEL_PATH,
} from "@/lib/carModel";
import type { PaintablePart, WrapDesign } from "@/lib/types";

interface CarModelProps {
  /** The selected wrap concept to paint onto the body, or null for stock paint. */
  design?: WrapDesign | null;
  /** Category to highlight, or null for none. */
  highlight?: CarPartCategory | null;
  /** Fires once after the model loads with the categories actually present. */
  onPartsReady?: (categories: CarPartCategory[]) => void;
  /** Fires when the user clicks a mesh, with that mesh's category. */
  onSelect?: (category: CarPartCategory) => void;
}

const HIGHLIGHT_COLOR = new Color("#fbbf24"); // amber-400
const NO_EMISSIVE = new Color("#000000");

/** Side surfaces carry the wide decal; tops carry the square pattern. Mirrors
 *  the split in {@link composeTextures} so fallbacks match composed textures. */
const SIDE_PARTS = new Set<PaintablePart>([
  "door_left",
  "door_right",
  "panel_left",
  "panel_right",
]);

/** Raw Stage 5 graphic to use when a part has no composed texture yet. */
function fallbackGraphic(part: PaintablePart, design: WrapDesign): string {
  return SIDE_PARTS.has(part)
    ? design.graphics.decalUrl
    : design.graphics.patternUrl;
}

function isAiAdDesign(design: WrapDesign): boolean {
  return design.style === "AI Ad";
}

function isPaintMaterial(material: MeshStandardMaterial): boolean {
  return (
    categoryForMaterial(material.name) === "body" && !isCoatMaterial(material)
  );
}

function isCoatMaterial(material: MeshStandardMaterial): boolean {
  return material.name.toLowerCase() === "coat";
}

/**
 * Assign each body mesh to a logical wrap part from where it sits on the car.
 *
 * The prepared model is grouped by material, not split into named parts, so we
 * derive the parts geometrically: take the combined body bounds, then classify
 * every mesh by its normalized center. Up is +Y (glTF); the longer horizontal
 * axis is the car's length, the other its width. Top surfaces become
 * hood/roof/trunk front-to-back; lower surfaces become door (front half) or
 * panel (rear half) on the left/right. Classification is relative, so any
 * uniform transform applied by the scene (centering/scaling) cancels out.
 */
function assignBodyParts(meshes: Mesh[]): Map<Mesh, PaintablePart> {
  const result = new Map<Mesh, PaintablePart>();
  if (meshes.length === 0) return result;

  const whole = new Box3();
  const centers = new Map<Mesh, Vector3>();
  for (const mesh of meshes) {
    const box = new Box3().setFromObject(mesh);
    if (box.isEmpty()) continue;
    centers.set(mesh, box.getCenter(new Vector3()));
    whole.union(box);
  }

  const min = whole.min;
  const size = whole.getSize(new Vector3());
  const lengthAxis: "x" | "z" = size.x >= size.z ? "x" : "z";
  const widthAxis: "x" | "z" = lengthAxis === "x" ? "z" : "x";
  const norm = (v: number, lo: number, span: number) =>
    span > 0 ? (v - lo) / span : 0.5;

  for (const [mesh, c] of centers) {
    const along = norm(c[lengthAxis], min[lengthAxis], size[lengthAxis]); // 0 rear → 1 front
    const up = norm(c.y, min.y, size.y); // 0 floor → 1 roof
    const left = c[widthAxis] < min[widthAxis] + size[widthAxis] / 2;

    let part: PaintablePart;
    if (up > 0.66) {
      part = along > 0.62 ? "hood" : along < 0.38 ? "trunk" : "roof";
    } else if (along >= 0.5) {
      part = left ? "door_left" : "door_right";
    } else {
      part = left ? "panel_left" : "panel_right";
    }
    result.set(mesh, part);
  }
  return result;
}

/**
 * Loads the prepared car GLB and makes every surface individually targetable.
 *
 * Each mesh keeps its own cloned material (so highlighting one part never
 * leaks into another or into the cached GLTF), and is tagged with the semantic
 * category derived from its material name. That tagging is the foundation
 * Stage 7 uses to swap textures onto the `body` meshes.
 */
export function CarModel({
  design,
  highlight,
  onPartsReady,
  onSelect,
}: CarModelProps) {
  const { scene } = useGLTF(MODEL_PATH);

  // Clone so multiple mounts / HMR don't share mutable material state.
  const root = useMemo(() => scene.clone(true), [scene]);

  // Map every mesh to its category and give it an isolated material.
  const meshCategory = useMemo(() => {
    const map = new Map<Mesh, CarPartCategory>();
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const material = obj.material;
      const materialName = Array.isArray(material)
        ? material[0]?.name
        : material?.name;
      const category = categoryForMaterial(materialName);
      map.set(obj, category);

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map((m) => m.clone());
      } else if (obj.material) {
        obj.material = obj.material.clone();
      }
      obj.geometry = obj.geometry.clone();
      obj.castShadow = true;
      obj.receiveShadow = true;
    });
    return map;
  }, [root]);

  // Sort the body materials into the logical wrap parts (door/hood/roof/…) by
  // where each mesh sits on the car, and snapshot each material's stock
  // color/map so we can restore the original look when no design is selected.
  // The model isn't separated into named parts, so this spatial pass is how
  // Stage 7 targets a different composed texture per surface.
  const body = useMemo(() => {
    const bodyMeshes: Mesh[] = [];
    for (const [mesh, category] of meshCategory) {
      if (category === "body") bodyMeshes.push(mesh);
    }
    const partOf = assignBodyParts(bodyMeshes);

    const byPart = new Map<PaintablePart, MeshStandardMaterial[]>();
    const paintMeshes: Mesh[] = [];
    const originalUvs = new Map<Mesh, Float32Array | null>();
    const stock = new Map<
      MeshStandardMaterial,
      {
        color: Color;
        map: Texture | null;
        metalness: number;
        roughness: number;
      }
    >();
    for (const mesh of bodyMeshes) {
      const part = partOf.get(mesh);
      if (!part) continue;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      if (
        materials.some(
          (material) =>
            material instanceof MeshStandardMaterial &&
            isPaintMaterial(material),
        )
      ) {
        paintMeshes.push(mesh);
        const uv = mesh.geometry.getAttribute("uv");
        originalUvs.set(
          mesh,
          uv ? new Float32Array(uv.array as ArrayLike<number>) : null,
        );
      }
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (!stock.has(material)) {
          stock.set(material, {
            color: material.color.clone(),
            map: material.map,
            metalness: material.metalness,
            roughness: material.roughness,
          });
        }
        const list = byPart.get(part) ?? [];
        list.push(material);
        byPart.set(part, list);
      }
    }
    return { byPart, originalUvs, paintMeshes, stock };
  }, [meshCategory]);

  // Report which categories the model actually contains.
  useEffect(() => {
    if (!onPartsReady) return;
    const present = Array.from(new Set(meshCategory.values()));
    onPartsReady(present);
  }, [meshCategory, onPartsReady]);

  // Paint the selected design onto the body: each logical part gets its own
  // composed texture (Stage 6) as the material map, tinted by baseColor until
  // it loads. Designs whose textures haven't been composed fall back to the raw
  // Stage 5 decal/pattern. Clearing the design restores the model's stock paint.
  useEffect(() => {
    const { byPart, originalUvs, paintMeshes, stock } = body;

    if (!design) {
      restoreOriginalUvs(originalUvs);
      for (const [material, original] of stock) {
        material.color.copy(original.color);
        material.map = original.map;
        material.metalness = original.metalness;
        material.roughness = original.roughness;
        material.needsUpdate = true;
      }
      return;
    }

    // Paint the whole body in the brand base coat. The ad is no longer baked
    // into the body texture — it is projected on as decals (below), so the body
    // only needs the right color/finish underneath each placement.
    restoreOriginalUvs(originalUvs);
    const base = new Color(design.baseColor);
    for (const [material] of stock) {
      material.map = null;
      if (isCoatMaterial(material)) {
        material.color.set("#ffffff");
      } else if (isPaintMaterial(material)) {
        material.color.copy(base);
        material.metalness = design.metalness;
        material.roughness = design.roughness;
      }
      material.needsUpdate = true;
    }

    // The AI ad goes on as projected decals over specific panels so the artwork
    // keeps its aspect ratio, conforms to body curvature, and never spills onto
    // glass or wheels.
    if (isAiAdDesign(design)) {
      return applyAdDecals(paintMeshes, design.graphics.decalUrl, design);
    }

    // Legacy per-part wrap textures (procedural concepts). Each logical part
    // gets its own composed texture as the material map, falling back to the raw
    // Stage 5 graphic when a part hasn't been composed yet.
    let cancelled = false;
    const loader = new TextureLoader();
    const loaded: Texture[] = [];

    for (const [part, materials] of byPart) {
      const url = design.textures?.[part] ?? fallbackGraphic(part, design);
      const texture = loader.load(url, (t) => {
        if (cancelled) {
          t.dispose();
          return;
        }
        t.colorSpace = SRGBColorSpace;
        t.flipY = false;
        for (const material of materials) {
          if (!isPaintMaterial(material)) continue;
          material.map = t;
          material.color.set("#ffffff");
          material.needsUpdate = true;
        }
      });
      loaded.push(texture);
    }

    return () => {
      cancelled = true;
      for (const t of loaded) t.dispose();
    };
  }, [design, body]);

  // Apply/clear the emissive highlight whenever the selection changes.
  useEffect(() => {
    for (const [mesh, category] of meshCategory) {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const on = highlight != null && category === highlight;
      for (const material of materials) {
        if (material instanceof MeshStandardMaterial) {
          material.emissive.copy(on ? HIGHLIGHT_COLOR : NO_EMISSIVE);
          material.emissiveIntensity = on ? 0.6 : 1;
          material.needsUpdate = true;
        }
      }
    }
  }, [highlight, meshCategory]);

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (!onSelect) return;
    const target = event.object;
    if (!(target instanceof Mesh)) return;
    const category = meshCategory.get(target);
    if (!category) return;
    event.stopPropagation();
    onSelect(category);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f object, not DOM; onClick is a raycast handler.
    <primitive object={root} onClick={handleClick} />
  );
}

useGLTF.preload(MODEL_PATH);

function restoreOriginalUvs(originalUvs: Map<Mesh, Float32Array | null>): void {
  for (const [mesh, uv] of originalUvs) {
    if (!uv) {
      mesh.geometry.deleteAttribute("uv");
      continue;
    }
    mesh.geometry.setAttribute("uv", new BufferAttribute(uv.slice(), 2));
  }
}

/** Aspect ratio of the generated ad (2048×1024). Decal footprints match it so
 *  the artwork is never stretched. */
const AD_ASPECT = 2;

/**
 * An ad placement, described geometrically so it works on any car the scene
 * centers/scales. `along` runs 0 (rear) → 1 (front); `side` is -1 (left),
 * +1 (right), or 0 (top, centered on width).
 */
interface DecalSlot {
  along: number;
  side: -1 | 0 | 1;
  surface: "side" | "top" | "rear";
  /** Side/rear slots: normalized height up the body (0 floor → 1 roof). */
  heightFrac?: number;
  /** Decal width as a fraction of the body's length (sides) or width (tops/rear). */
  widthFrac: number;
}

const AD_DECAL_SLOTS: DecalSlot[] = [
  { along: 0.6, side: -1, surface: "side", heightFrac: 0.46, widthFrac: 0.34 },
  { along: 0.6, side: 1, surface: "side", heightFrac: 0.46, widthFrac: 0.34 },
  { along: 0.32, side: -1, surface: "side", heightFrac: 0.46, widthFrac: 0.3 },
  { along: 0.32, side: 1, surface: "side", heightFrac: 0.46, widthFrac: 0.3 },
  { along: 0.8, side: 0, surface: "top", widthFrac: 0.55 },
  { side: 0, surface: "rear", along: 0, heightFrac: 0.42, widthFrac: 0.4 },
];

/**
 * Project the AI ad onto fixed-size panels as Three.js decals.
 *
 * Each slot raycasts from outside the car toward a panel to find a real surface
 * point, then builds a {@link DecalGeometry} clipped to a box whose footprint
 * matches the ad's aspect ratio. Because the box clips the projection, the decal
 * conforms to body curvature, never spills onto glass/wheels, and keeps the
 * artwork undistorted. Each decal is built in its target mesh's local frame
 * (its world matrix is zeroed during construction, the way drei's `<Decal>`
 * does it) so the scene's centering/scaling re-applies when it is added as a
 * child.
 *
 * Returns a cleanup that detaches and disposes every decal.
 */
function applyAdDecals(
  meshes: Mesh[],
  textureUrl: string,
  design: WrapDesign,
): () => void {
  if (meshes.length === 0) return () => {};

  for (const mesh of meshes) mesh.updateWorldMatrix(true, false);

  const bounds = new Box3();
  for (const mesh of meshes) bounds.union(new Box3().setFromObject(mesh));
  if (bounds.isEmpty()) return () => {};

  const min = bounds.min;
  const max = bounds.max;
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const lengthAxis: "x" | "z" = size.x >= size.z ? "x" : "z";
  const widthAxis: "x" | "z" = lengthAxis === "x" ? "z" : "x";

  const raycaster = new Raycaster();
  const decals: Mesh[] = [];

  for (const slot of AD_DECAL_SLOTS) {
    const origin = new Vector3();
    const direction = new Vector3();
    const normalWorld = new Vector3();
    const upWorld = new Vector3();
    origin[lengthAxis] = min[lengthAxis] + slot.along * size[lengthAxis];

    if (slot.surface === "side") {
      const outward = slot.side < 0 ? -1 : 1;
      origin.y = min.y + (slot.heightFrac ?? 0.45) * size.y;
      origin[widthAxis] = center[widthAxis] + outward * size[widthAxis];
      direction[widthAxis] = -outward; // aim inward at the panel
      normalWorld[widthAxis] = outward; // the panel faces outward
      upWorld.set(0, 1, 0); // text stays upright
    } else if (slot.surface === "rear") {
      // The tailgate is a near-vertical surface at the back facing −length.
      origin.y = min.y + (slot.heightFrac ?? 0.42) * size.y;
      origin[widthAxis] = center[widthAxis];
      origin[lengthAxis] = min[lengthAxis] - size[lengthAxis]; // behind the car
      direction[lengthAxis] = 1; // aim forward at the tailgate
      normalWorld[lengthAxis] = -1; // the tailgate faces rearward
      upWorld.set(0, 1, 0); // text stays upright
    } else {
      origin.y = max.y + size.y;
      origin[widthAxis] = center[widthAxis];
      direction.y = -1;
      normalWorld.set(0, 1, 0);
      // Point the text top toward the car's center so it reads upright when
      // viewed from the front (hood → toward the windshield).
      upWorld[lengthAxis] = slot.along > 0.5 ? -1 : 1;
    }

    raycaster.set(origin, direction.normalize());
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit?.face) continue;

    const widthWorld =
      slot.widthFrac *
      (slot.surface === "side" ? size[lengthAxis] : size[widthAxis]);
    // Keep the box shallow along the projection normal so it grabs only the
    // near panel, never the far side of the body.
    const depthWorld =
      slot.surface === "side"
        ? 0.4 * size[widthAxis]
        : slot.surface === "rear"
          ? 0.12 * size[lengthAxis]
          : 0.4 * size.y;

    const decal = buildDecal(
      hit.object as Mesh,
      hit.point,
      normalWorld,
      upWorld,
      {
        width: widthWorld,
        height: widthWorld / AD_ASPECT,
        depth: depthWorld,
      },
    );
    if (!decal) continue;

    const material = decal.material as MeshStandardMaterial;
    material.color.copy(new Color(design.baseColor));
    material.metalness = design.metalness;
    material.roughness = design.roughness;
    (hit.object as Mesh).add(decal);
    decals.push(decal);
  }

  let cancelled = false;
  const loader = new TextureLoader();
  const texture = loader.load(textureUrl, (t) => {
    if (cancelled) {
      t.dispose();
      return;
    }
    t.colorSpace = SRGBColorSpace;
    for (const decal of decals) {
      const material = decal.material as MeshStandardMaterial;
      material.map = t;
      material.color.set("#ffffff");
      material.needsUpdate = true;
    }
  });

  return () => {
    cancelled = true;
    texture.dispose();
    for (const decal of decals) {
      decal.parent?.remove(decal);
      decal.geometry.dispose();
      const material = decal.material as MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
    }
  };
}

/**
 * Build one decal mesh on `target` from a world-space anchor and orientation.
 * Returns null if the orientation basis degenerates. The caller parents it.
 */
function buildDecal(
  target: Mesh,
  pointWorld: Vector3,
  normalWorld: Vector3,
  upWorld: Vector3,
  size: { width: number; height: number; depth: number },
): Mesh | null {
  // World basis: +Z along the surface normal (projection depth), +X the image's
  // horizontal, +Y its vertical.
  const z = normalWorld.clone().normalize();
  const x = new Vector3().crossVectors(upWorld, z);
  if (x.lengthSq() < 1e-6) return null;
  x.normalize();

  // Convert anchor + basis + size into the target's local frame so the decal
  // can be built with the mesh's world matrix zeroed, then added as a child
  // (its world matrix then re-applies the scene's centering/scaling).
  const inverse = new Matrix4().copy(target.matrixWorld).invert();
  const scale = new Vector3();
  target.matrixWorld.decompose(new Vector3(), new Quaternion(), scale);
  const unit = scale.x || 1;

  const localPos = pointWorld.clone().applyMatrix4(inverse);
  const xL = x.transformDirection(inverse).normalize();
  const zL = z.transformDirection(inverse).normalize();
  const yL = new Vector3().crossVectors(zL, xL).normalize();
  const orientation = new Euler().setFromRotationMatrix(
    new Matrix4().makeBasis(xL, yL, zL),
  );
  const localSize = new Vector3(
    size.width / unit,
    size.height / unit,
    size.depth / unit,
  );

  const savedMatrixWorld = target.matrixWorld.clone();
  target.matrixWorld.identity();
  const geometry = new DecalGeometry(target, localPos, orientation, localSize);
  target.matrixWorld.copy(savedMatrixWorld);

  const decal = new Mesh(
    geometry,
    new MeshStandardMaterial({
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      polygonOffsetUnits: -10,
    }),
  );
  decal.castShadow = false;
  decal.receiveShadow = true;
  decal.renderOrder = 2;
  return decal;
}
