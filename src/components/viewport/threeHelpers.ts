import type { Vec3 } from '../../geometry/types';

/** Fan-triangulates an ordered polygon loop into a flat position array for a THREE.BufferGeometry. */
export function fanTriangulatePositions(positions: Vec3[]): Float32Array {
  const n = positions.length;
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const a = positions[0];
    const b = positions[i];
    const c = positions[i + 1];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  return new Float32Array(out);
}

export function toArray(p: Vec3): [number, number, number] {
  return [p.x, p.y, p.z];
}
