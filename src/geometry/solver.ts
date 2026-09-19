import type { Design, DerivedEdge } from './types';
import { V, rotatePointAboutLine } from './vec3';
import { edgeTangentIntoFace, getFace, getVertex } from './mesh';

const DEG2RAD = Math.PI / 180;

/**
 * Rotate `childFaceId`'s vertices (the ones not on the shared edge) rigidly about the
 * shared-edge axis until the dihedral angle between it and the other face sharing
 * `edge` equals `targetAngleDeg`. A rigid rotation about the shared edge can never change
 * any edge length within the child face, so the lock is always satisfied by re-orienting
 * geometry, never by stretching an edge.
 *
 * Note: this resolves a single edge/face at a time (per the spec's scoped solver). If the
 * child face shares other vertices with faces carrying their own locks, those may need
 * re-solving afterward — callers can re-run this for every active lock to relax the whole
 * mesh toward a consistent state.
 */
export function solveDihedralAngle(
  design: Design,
  edge: DerivedEdge,
  childFaceId: string,
  targetAngleDeg: number,
): Design {
  if (!edge.faceIds.includes(childFaceId)) {
    throw new Error('childFaceId must be one of the faces sharing this edge');
  }
  const fixedFaceId = edge.faceIds.find((id) => id !== childFaceId);
  if (!fixedFaceId) throw new Error('Edge must be shared by exactly two faces');

  const fixedFace = getFace(design, fixedFaceId);
  const childFace = getFace(design, childFaceId);

  const a = getVertex(design, edge.a).position;
  const b = getVertex(design, edge.b).position;
  const axis = V.normalize(V.sub(b, a));

  const tFixed = edgeTangentIntoFace(design, fixedFace, edge.a, edge.b);
  const tChild = edgeTangentIntoFace(design, childFace, edge.a, edge.b);

  const u = tFixed;
  const v = V.normalize(V.cross(axis, u));

  const angle0 = Math.atan2(V.dot(tChild, v), V.dot(tChild, u));
  const targetBetweenDeg = Math.max(0, Math.min(180, targetAngleDeg));
  const sign = angle0 < 0 ? -1 : 1;
  const angle0Target = sign * targetBetweenDeg * DEG2RAD;
  const theta = angle0Target - angle0;

  if (Math.abs(theta) < 1e-9) return design;

  const movingIds = new Set(childFace.vertexIds.filter((id) => id !== edge.a && id !== edge.b));
  if (movingIds.size === 0) return design;

  const newVertices = design.vertices.map((vtx) => {
    if (!movingIds.has(vtx.id)) return vtx;
    return { ...vtx, position: rotatePointAboutLine(vtx.position, a, axis, theta) };
  });

  return { ...design, vertices: newVertices };
}
