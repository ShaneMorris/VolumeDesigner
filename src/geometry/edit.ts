import type { Design, Face } from './types';
import { V, rotatePointAboutLine, polygonNormal } from './vec3';
import { getVertex, getFace, facePositions } from './mesh';

/**
 * Moves `movingVertexId` along the ray from `anchorVertexId` through its current
 * position so the distance between them becomes exactly `newLengthIn`. The anchor never
 * moves — this is the "select an edge, type a length" operation from the base-polygon
 * sketch tool, and it generalizes to any edge in the mesh.
 */
export function setEdgeLengthByMovingVertex(
  design: Design,
  anchorVertexId: string,
  movingVertexId: string,
  newLengthIn: number,
): Design {
  const anchor = getVertex(design, anchorVertexId).position;
  const moving = getVertex(design, movingVertexId).position;
  const dir = V.normalize(V.sub(moving, anchor));
  if (V.length(dir) < 1e-12) return design;
  const newPos = V.add(anchor, V.scale(dir, newLengthIn));
  return {
    ...design,
    vertices: design.vertices.map((v) => (v.id === movingVertexId ? { ...v, position: newPos } : v)),
  };
}

/**
 * Sets the interior angle of a polygon face at `vertexId`, measured between the edges to
 * its previous and next neighbors in the face's vertex loop. The previous neighbor and
 * `vertexId` itself stay fixed; the next neighbor is rotated about `vertexId` (about the
 * face's normal axis) until the angle matches, preserving the vertexId->next edge length.
 */
export function setInteriorAngleAtVertex(
  design: Design,
  faceId: string,
  vertexId: string,
  newAngleDeg: number,
): Design {
  const face = getFace(design, faceId);
  const n = face.vertexIds.length;
  const idx = face.vertexIds.indexOf(vertexId);
  if (idx === -1) throw new Error('Vertex is not part of this face');
  const prevId = face.vertexIds[(idx - 1 + n) % n];
  const nextId = face.vertexIds[(idx + 1) % n];

  const p = getVertex(design, vertexId).position;
  const prev = getVertex(design, prevId).position;
  const next = getVertex(design, nextId).position;

  const normal = polygonNormal(facePositions(design, face));
  const toPrev = V.normalize(V.sub(prev, p));
  const toNext = V.normalize(V.sub(next, p));

  const u = toPrev;
  const v = V.normalize(V.cross(normal, u));
  const currentAngle = Math.atan2(V.dot(toNext, v), V.dot(toNext, u));
  const sign = currentAngle < 0 ? -1 : 1;
  const targetAngle = sign * newAngleDeg * (Math.PI / 180);
  const theta = targetAngle - currentAngle;

  if (Math.abs(theta) < 1e-9) return design;

  const newNextPos = rotatePointAboutLine(next, p, normal, theta);
  return {
    ...design,
    vertices: design.vertices.map((vtx) => (vtx.id === nextId ? { ...vtx, position: newNextPos } : vtx)),
  };
}

export interface ExtrudeResult {
  design: Design;
  topFaceId: string;
  sideFaceIds: string[];
  topVertexIds: string[];
}

/**
 * The "pull up" shortcut: extrudes `baseFace` straight along its own normal by `heightIn`,
 * producing a new top face (same vertex count/shape) and one quad side wall per base edge.
 * Result is ordinary editable geometry afterward, per spec — no special extrude linkage
 * is retained.
 */
export function extrudeFace(
  design: Design,
  baseFace: Face,
  heightIn: number,
  makeIds: () => string,
): ExtrudeResult {
  const positions = facePositions(design, baseFace);
  const rawNormal = polygonNormal(positions);
  // The base polygon's winding (and therefore its normal's sign) depends on the order its
  // vertices were clicked in — not on which way is "up". Pull-up height is always meant to
  // go upward, so pin the extrude direction to +Z regardless of winding; only fall back to
  // the raw normal for a (near-)vertical face, where "up" isn't a meaningful distinction.
  const normal = rawNormal.z < 0 ? V.scale(rawNormal, -1) : rawNormal;
  const offset = V.scale(normal, heightIn);

  const n = baseFace.vertexIds.length;
  const topVertexIds: string[] = [];
  const newVertices = [...design.vertices];
  for (let i = 0; i < n; i++) {
    const basePos = positions[i];
    const id = makeIds();
    newVertices.push({ id, position: V.add(basePos, offset) });
    topVertexIds.push(id);
  }

  const topFaceId = makeIds();
  const topFace: Face = {
    id: topFaceId,
    vertexIds: [...topVertexIds].reverse(),
    label: 'Top',
  };

  const sideFaceIds: string[] = [];
  const newFaces = [...design.faces, topFace];
  for (let i = 0; i < n; i++) {
    const a = baseFace.vertexIds[i];
    const b = baseFace.vertexIds[(i + 1) % n];
    const topA = topVertexIds[i];
    const topB = topVertexIds[(i + 1) % n];
    const sideId = makeIds();
    newFaces.push({
      id: sideId,
      vertexIds: [a, b, topB, topA],
      label: `Side ${i + 1}`,
    });
    sideFaceIds.push(sideId);
  }

  return {
    design: { ...design, vertices: newVertices, faces: newFaces },
    topFaceId,
    sideFaceIds,
    topVertexIds,
  };
}
