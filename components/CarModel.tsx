"use client";

import { useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Box3,
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
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
      { color: Color; map: Texture | null }
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
        material.needsUpdate = true;
      }
      return;
    }

    // Show the base coat immediately, then swap in each texture once it loads.
    restoreOriginalUvs(originalUvs);
    const projectedTexture = isAiAdDesign(design);
    if (projectedTexture) {
      applyProjectedSideUvs(paintMeshes);
    }
    const base = new Color(design.baseColor);
    for (const material of stock.keys()) {
      material.map = null;
      if (isCoatMaterial(material)) {
        material.color.set("#ffffff");
      } else {
        material.color.copy(base);
      }
      material.needsUpdate = true;
    }

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
        t.flipY = projectedTexture;
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

function applyProjectedSideUvs(meshes: Mesh[]): void {
  const bounds = new Box3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    bounds.union(new Box3().setFromObject(mesh));
  }

  const size = bounds.getSize(new Vector3());
  const min = bounds.min;
  const midX = min.x + size.x / 2;
  const vertex = new Vector3();
  const spanZ = size.z || 1;
  const spanY = size.y || 1;

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;

    // The decal is planar-projected along world Z, so both sides sample U from
    // the same z. Viewed from outside, the two sides face opposite directions,
    // so that single mapping reads mirrored on the −X side. This body is a few
    // large meshes that each span the full width, so we decide the flip
    // per-vertex by which side of the centerline it sits on — flipping U on the
    // −X half makes text run left-to-right on both the driver and passenger
    // sides.
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      mesh.localToWorld(vertex);
      const u = (vertex.z - min.z) / spanZ;
      uv[i * 2] = vertex.x > midX ? 1 - u : u;
      uv[i * 2 + 1] = (vertex.y - min.y) / spanY;
    }

    mesh.geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  }
}
