import type { Design, Face, Vec3 } from './types';
import { V, polygonNormal } from './vec3';
import { facePositions } from './mesh';

export interface FaceBasis {
  origin: Vec3;
  uAxis: Vec3;
  vAxis: Vec3;
  normal: Vec3;
}

/**
 * The face-local 2D frame used everywhere a face needs a flat (u, v) coordinate:
 * hole placement input, the nominal projection for non-planar faces, and (for a planar
 * face) the true unfolded panel coordinates directly. Origin is the face's first vertex,
 * u runs along the first edge, v is in-plane and perpendicular to u.
 */
export function faceLocalBasis(design: Design, face: Face): FaceBasis {
  const positions = facePositions(design, face);
  const origin = positions[0];
  const uAxis = V.normalize(V.sub(positions[1], origin));
  const normal = polygonNormal(positions);
  const vAxis = V.normalize(V.cross(normal, uAxis));
  return { origin, uAxis, vAxis, normal };
}

export function toFaceLocal(basis: FaceBasis, p: Vec3): { u: number; v: number } {
  const rel = V.sub(p, basis.origin);
  return { u: V.dot(rel, basis.uAxis), v: V.dot(rel, basis.vAxis) };
}

export function fromFaceLocal(basis: FaceBasis, u: number, v: number): Vec3 {
  return V.add(basis.origin, V.add(V.scale(basis.uAxis, u), V.scale(basis.vAxis, v)));
}
