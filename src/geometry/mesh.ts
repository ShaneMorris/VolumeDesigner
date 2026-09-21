import type { Design, DerivedEdge, EdgeKey, Face, Vertex } from './types';
import { edgeKey } from './types';
import { V, polygonNormal } from './vec3';
import type { Vec3 } from './types';

export function getVertex(design: Design, id: string): Vertex {
  const v = design.vertices.find((v) => v.id === id);
  if (!v) throw new Error(`Vertex ${id} not found`);
  return v;
}

export function findVertex(design: Design, id: string): Vertex | undefined {
  return design.vertices.find((v) => v.id === id);
}

export function getFace(design: Design, id: string): Face {
  const f = design.faces.find((f) => f.id === id);
  if (!f) throw new Error(`Face ${id} not found`);
  return f;
}

export function facePositions(design: Design, face: Face): Vec3[] {
  return face.vertexIds.map((id) => getVertex(design, id).position);
}

export function faceEdgeKeys(face: Face): EdgeKey[] {
  const n = face.vertexIds.length;
  const keys: EdgeKey[] = [];
  for (let i = 0; i < n; i++) {
    keys.push(edgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]));
  }
  return keys;
}

/**
 * Every stored edge, paired with the faces that use it.
 *
 * Edges come from `design.edges` rather than from face loops, so an edge drawn on its own
 * appears here with an empty `faceIds` — which is the point: connectivity exists before
 * any face does (requirements §3).
 */
export function deriveEdges(design: Design): DerivedEdge[] {
  const map = new Map<EdgeKey, DerivedEdge>();
  for (const edge of design.edges) {
    const key = edgeKey(edge.a, edge.b);
    if (!map.has(key)) map.set(key, { key, a: edge.a, b: edge.b, faceIds: [] });
  }
  for (const face of design.faces) {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const key = edgeKey(face.vertexIds[i], face.vertexIds[(i + 1) % n]);
      // A face loop without a backing edge breaks constraint 8; validation reports it, and
      // normalizing a design repairs it. Tolerate it here so rendering never hard-fails.
      const edge = map.get(key);
      if (edge) edge.faceIds.push(face.id);
    }
  }
  return [...map.values()];
}

/** All edges shared by exactly two faces — candidates for a dihedral angle. */
export function sharedEdges(design: Design): DerivedEdge[] {
  return deriveEdges(design).filter((e) => e.faceIds.length === 2);
}

export function findSharedEdge(design: Design, faceAId: string, faceBId: string): DerivedEdge | undefined {
  return sharedEdges(design).find(
    (e) => e.faceIds.includes(faceAId) && e.faceIds.includes(faceBId),
  );
}

/**
 * In-plane tangent vector for `face`, at the shared edge (a -> b), pointing from the
 * edge into the interior of the face (perpendicular to the edge, within the face's plane).
 * Used to measure the dihedral (fold) angle between two adjacent faces consistently.
 */
export function edgeTangentIntoFace(design: Design, face: Face, a: string, b: string): Vec3 {
  const positions = facePositions(design, face);
  const normal = polygonNormal(positions);
  const pa = getVertex(design, a).position;
  const pb = getVertex(design, b).position;
  const edgeDir = V.normalize(V.sub(pb, pa));
  // A vector in the face's plane, perpendicular to the edge: normal x edgeDir.
  let tangent = V.cross(normal, edgeDir);
  // Orient it to point toward the face's interior (toward centroid) rather than away.
  const mid = V.lerp(pa, pb, 0.5);
  const centroid = positions.reduce((acc, p) => V.add(acc, p), { x: 0, y: 0, z: 0 } as Vec3);
  const c = V.scale(centroid, 1 / positions.length);
  const towardCentroid = V.sub(c, mid);
  if (V.dot(tangent, towardCentroid) < 0) {
    tangent = V.scale(tangent, -1);
  }
  return V.normalize(tangent);
}

/**
 * Dihedral (fold) angle in degrees between two faces along their shared edge.
 * 180° = flat (faces coplanar, no fold). Smaller values = a sharper interior fold,
 * matching what a bevel bit would need to cut.
 */
export function dihedralAngleDeg(design: Design, edge: DerivedEdge): number {
  if (edge.faceIds.length !== 2) {
    throw new Error('Dihedral angle requires exactly two faces sharing the edge');
  }
  const faceA = getFace(design, edge.faceIds[0]);
  const faceB = getFace(design, edge.faceIds[1]);
  const tA = edgeTangentIntoFace(design, faceA, edge.a, edge.b);
  const tB = edgeTangentIntoFace(design, faceB, edge.a, edge.b);
  const cos = Math.min(1, Math.max(-1, V.dot(tA, tB)));
  // The two inward tangents point directly apart (180°) when the faces are coplanar
  // (flat, no fold) and point together (0°) when folded shut onto each other, so the
  // fold angle *is* the angle between them.
  return Math.acos(cos) * (180 / Math.PI);
}

const PLANARITY_EPS_IN = 1e-3;

/** Max perpendicular distance of any vertex from the face's best-fit plane. */
export function planarityDeviation(design: Design, face: Face): number {
  const positions = facePositions(design, face);
  if (positions.length <= 3) return 0;
  const normal = polygonNormal(positions);
  const centroid = positions.reduce((acc, p) => V.add(acc, p), { x: 0, y: 0, z: 0 } as Vec3);
  const c = V.scale(centroid, 1 / positions.length);
  let maxDev = 0;
  for (const p of positions) {
    const dev = Math.abs(V.dot(V.sub(p, c), normal));
    maxDev = Math.max(maxDev, dev);
  }
  return maxDev;
}

export function isFacePlanar(design: Design, face: Face): boolean {
  if (face.vertexIds.length <= 3) return true;
  return planarityDeviation(design, face) < PLANARITY_EPS_IN;
}

export function edgeLength(design: Design, a: string, b: string): number {
  return V.distance(getVertex(design, a).position, getVertex(design, b).position);
}
