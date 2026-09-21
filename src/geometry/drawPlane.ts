import type { Vec3 } from './types';
import { V, polygonNormal } from './vec3';

/**
 * The plane a face is being drawn on. Without one, a 2D cursor position has no single
 * 3D answer — this is what replaces the old adjustable work-plane height.
 *
 * `u` is the plane's horizontal axis and `v` its "up" axis, so a point's polar form
 * (length, angle-from-horizontal) means the same thing a builder would mean by it.
 */
export interface DrawPlane {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}

const WORLD_UP: Vec3 = { x: 0, y: 0, z: 1 };

/** Builds the in-plane axes for a given normal, keeping `u` horizontal where possible. */
function axesForNormal(origin: Vec3, normal: Vec3): DrawPlane {
  const n = V.normalize(normal);
  let u = V.cross(WORLD_UP, n);
  if (V.length(u) < 1e-6) {
    // The plane is horizontal, so no in-plane axis is "horizontal" — any will do.
    u = V.cross({ x: 0, y: 1, z: 0 }, n);
    if (V.length(u) < 1e-6) u = V.cross({ x: 1, y: 0, z: 0 }, n);
  }
  u = V.normalize(u);
  const v = V.normalize(V.cross(n, u));
  return { origin, u, v, normal: n };
}

/**
 * The plane to start drawing on: vertical, passing through the start vertex, turned to
 * face the camera. Frozen at the moment drawing starts so it can't wobble as the view
 * is orbited mid-face.
 */
export function verticalPlaneFacingCamera(origin: Vec3, cameraPosition: Vec3): DrawPlane {
  const toCamera = V.sub(cameraPosition, origin);
  const horizontal = { x: toCamera.x, y: toCamera.y, z: 0 };
  const normal = V.length(horizontal) < 1e-6 ? { x: 0, y: -1, z: 0 } : V.normalize(horizontal);
  return axesForNormal(origin, normal);
}

/**
 * Once three points are down they define the face's plane outright, so drawing switches
 * to it — which is also what keeps the finished face planar and cleanly unfoldable.
 */
export function planeThroughPoints(points: Vec3[]): DrawPlane | null {
  if (points.length < 3) return null;
  const normal = polygonNormal(points);
  if (V.length(normal) < 1e-6) return null;
  return axesForNormal(points[0], normal);
}

/** Projects an arbitrary 3D point onto the plane. */
export function projectOntoPlane(plane: DrawPlane, point: Vec3): Vec3 {
  const rel = V.sub(point, plane.origin);
  const distance = V.dot(rel, plane.normal);
  return V.sub(point, V.scale(plane.normal, distance));
}

export interface PolarPoint {
  lengthIn: number;
  /** Degrees from horizontal within the plane: 0 = level, 90 = straight up. */
  angleDeg: number;
}

/** Length and angle of `point` measured from `from`, within the plane. */
export function toPolar(plane: DrawPlane, from: Vec3, point: Vec3): PolarPoint {
  const rel = V.sub(point, from);
  const a = V.dot(rel, plane.u);
  const b = V.dot(rel, plane.v);
  return {
    lengthIn: Math.hypot(a, b),
    angleDeg: (Math.atan2(b, a) * 180) / Math.PI,
  };
}

/** The inverse of `toPolar`: where a given length/angle lands, in world space. */
export function fromPolar(plane: DrawPlane, from: Vec3, polar: PolarPoint): Vec3 {
  const rad = (polar.angleDeg * Math.PI) / 180;
  const a = Math.cos(rad) * polar.lengthIn;
  const b = Math.sin(rad) * polar.lengthIn;
  return V.add(from, V.add(V.scale(plane.u, a), V.scale(plane.v, b)));
}

/**
 * Where the next point goes: the cursor's position on the plane, with any locked length
 * or angle overriding the corresponding part of it.
 */
export function resolveNextPoint(
  plane: DrawPlane,
  from: Vec3,
  cursor: Vec3,
  locks: { lengthIn?: number | null; angleDeg?: number | null },
): Vec3 {
  const live = toPolar(plane, from, projectOntoPlane(plane, cursor));
  const lengthIn = locks.lengthIn ?? (live.lengthIn || 0);
  const angleDeg = locks.angleDeg ?? live.angleDeg;
  return fromPolar(plane, from, { lengthIn, angleDeg });
}
