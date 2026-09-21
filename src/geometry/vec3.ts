import type { Vec3 } from './types';

export const V = {
  add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  },
  sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  },
  scale(a: Vec3, s: number): Vec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
  },
  dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },
  cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },
  length(a: Vec3): number {
    return Math.sqrt(V.dot(a, a));
  },
  distance(a: Vec3, b: Vec3): number {
    return V.length(V.sub(a, b));
  },
  normalize(a: Vec3): Vec3 {
    const len = V.length(a);
    if (len < 1e-12) return { x: 0, y: 0, z: 0 };
    return V.scale(a, 1 / len);
  },
  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return V.add(a, V.scale(V.sub(b, a), t));
  },
  clone(a: Vec3): Vec3 {
    return { x: a.x, y: a.y, z: a.z };
  },
  equalsApprox(a: Vec3, b: Vec3, eps = 1e-9): boolean {
    return V.distance(a, b) < eps;
  },
};

/** Rotate vector v about an axis (through origin, unit length) by angle radians (Rodrigues' formula). */
export function rotateAboutAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const k = V.normalize(axis);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const term1 = V.scale(v, cos);
  const term2 = V.scale(V.cross(k, v), sin);
  const term3 = V.scale(k, V.dot(k, v) * (1 - cos));
  return V.add(V.add(term1, term2), term3);
}

/** Rotate point p about a line (point `origin`, direction `axis`) by angle radians. */
export function rotatePointAboutLine(p: Vec3, origin: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const rel = V.sub(p, origin);
  const rotated = rotateAboutAxis(rel, axis, angleRad);
  return V.add(origin, rotated);
}

/** Newell's method: robust normal (and thus best-fit plane) for a possibly-non-planar polygon. */
/**
 * Newell's area vector: direction is the polygon's normal, magnitude is twice its area.
 * Works for a polygon in any plane, and for a non-planar loop gives the best-fit answer.
 */
export function polygonAreaVector(points: Vec3[]): Vec3 {
  const n: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    n.x += (cur.y - next.y) * (cur.z + next.z);
    n.y += (cur.z - next.z) * (cur.x + next.x);
    n.z += (cur.x - next.x) * (cur.y + next.y);
  }
  return V.scale(n, 0.5);
}

/** Enclosed area of a polygon, in the same square units as its coordinates. */
export function polygonArea(points: Vec3[]): number {
  return V.length(polygonAreaVector(points));
}

export function polygonNormal(points: Vec3[]): Vec3 {
  return V.normalize(polygonAreaVector(points));
}

export function polygonCentroid(points: Vec3[]): Vec3 {
  let sum: Vec3 = { x: 0, y: 0, z: 0 };
  for (const p of points) sum = V.add(sum, p);
  return V.scale(sum, 1 / points.length);
}
