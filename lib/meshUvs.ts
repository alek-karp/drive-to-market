import { BufferAttribute, type Mesh, Vector3 } from "three";

const DEGENERATE_UV_EPSILON = 0.01;

/** True when every UV sits on one point — sampling one texel paints the whole mesh. */
export function hasDegenerateUvs(mesh: Mesh): boolean {
  const uv = mesh.geometry.getAttribute("uv");
  if (!uv || uv.count === 0) return true;

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }

  return (
    maxU - minU < DEGENERATE_UV_EPSILON && maxV - minV < DEGENERATE_UV_EPSILON
  );
}

/**
 * Assign box-projected UVs from vertex positions when the GLB has none or they
 * are collapsed. Works with RepeatWrapping so livery patterns tile across the
 * whole exterior.
 */
export function generateBoxUvs(mesh: Mesh): void {
  const position = mesh.geometry.getAttribute("position");
  if (!position || position.count === 0) return;

  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return;

  const size = box.getSize(new Vector3());
  const uvs = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Spread across horizontal footprint (X/Z) and vertical span (Y).
    const u = size.x > 0 ? (x - box.min.x) / size.x : 0;
    const v =
      size.z > 0
        ? (z - box.min.z) / size.z
        : size.y > 0
          ? (y - box.min.y) / size.y
          : 0;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  mesh.geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
}

export function ensureWrapUvs(mesh: Mesh): void {
  if (!hasDegenerateUvs(mesh)) return;
  generateBoxUvs(mesh);
}
