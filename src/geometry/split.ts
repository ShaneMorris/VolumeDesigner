import type { Design, Face, Hole, Vec3 } from './types';
import { edgeKey } from './types';
import { V } from './vec3';
import { getVertex, facePositions, findSharedEdge } from './mesh';
import { faceEdgePairs, hasEdge, removeEdgeKeys } from './edges';
import { faceLocalBasis, toFaceLocal } from './basis';

/**
 * Subdividing existing geometry (requirements §3, "Editing operations").
 *
 * Both operations are named rather than emerging from loop detection, because the thing
 * that makes them delicate isn't finding the new loops — it's dividing what the parent
 * owned. A face carries a label, holes in its own coordinate frame, and angle locks tied
 * to particular edges, and none of that divides itself.
 */

export interface SplitEdgeResult {
  design: Design;
  /** The vertex that now sits partway along the old edge. */
  vertexId: string;
}

export interface SplitFaceResult {
  design: Design;
  faceIds: [string, string];
}

/** Why a split can't happen, phrased for the user rather than the log. */
export type SplitRefusal = { ok: false; reason: string };
export type SplitOutcome<T> = ({ ok: true } & T) | SplitRefusal;

const MIN_PARAM = 1e-6;

/**
 * Inserts a vertex partway along an edge, at fraction `t` from `a` toward `b`.
 *
 * Not a local change: every face using that edge gains the new vertex in its loop, or the
 * face boundary would stop matching the edge set (constraint 8). The new vertex is
 * collinear with its neighbours, so those faces stay planar for free, and because it lies
 * on the segment it can't move a face's first-edge direction — hole coordinates are
 * untouched by construction.
 */
export function splitEdgeAt(
  design: Design,
  a: string,
  b: string,
  t: number,
  makeId: () => string,
): SplitOutcome<SplitEdgeResult> {
  if (!hasEdge(design, a, b)) return { ok: false, reason: 'Those two points are not joined by an edge.' };
  if (!Number.isFinite(t) || t <= MIN_PARAM || t >= 1 - MIN_PARAM) {
    return { ok: false, reason: 'A split has to land strictly between the two ends of the edge.' };
  }

  const pa = getVertex(design, a).position;
  const pb = getVertex(design, b).position;
  const id = makeId();
  const position = V.lerp(pa, pb, t);

  const key = edgeKey(a, b);
  const withoutOld = removeEdgeKeys(design, new Set([key]));

  const faces = design.faces.map((face) => {
    const n = face.vertexIds.length;
    for (let i = 0; i < n; i++) {
      const cur = face.vertexIds[i];
      const next = face.vertexIds[(i + 1) % n];
      if (edgeKey(cur, next) !== key) continue;
      // Insert after `cur`, whichever way round the pair appears in this loop.
      const vertexIds = [...face.vertexIds];
      vertexIds.splice(i + 1, 0, id);
      return { ...face, vertexIds };
    }
    return face;
  });

  return {
    ok: true,
    vertexId: id,
    design: {
      ...withoutOld,
      vertices: [...design.vertices, { id, position }],
      edges: [...withoutOld.edges, { a, b: id }, { a: id, b }],
      faces,
    },
  };
}

/** Where a point sits along an edge, as a fraction from `a` to `b`, clamped to the segment. */
export function parameterAlongEdge(design: Design, a: string, b: string, point: Vec3): number {
  const pa = getVertex(design, a).position;
  const pb = getVertex(design, b).position;
  const along = V.sub(pb, pa);
  const lengthSq = V.dot(along, along);
  if (lengthSq < 1e-12) return 0.5;
  return Math.min(1, Math.max(0, V.dot(V.sub(point, pa), along) / lengthSq));
}

interface P2 {
  u: number;
  v: number;
}

function cross2(o: P2, a: P2, b: P2): number {
  return (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
}

function properlyCross(p1: P2, p2: P2, p3: P2, p4: P2): boolean {
  const d1 = cross2(p3, p4, p1);
  const d2 = cross2(p3, p4, p2);
  const d3 = cross2(p1, p2, p3);
  const d4 = cross2(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointInPolygon(point: P2, polygon: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const straddles = pi.v > point.v !== pj.v > point.v;
    if (!straddles) continue;
    const at = ((pj.u - pi.u) * (point.v - pi.v)) / (pj.v - pi.v) + pi.u;
    if (point.u < at) inside = !inside;
  }
  return inside;
}

/**
 * Divides a face along a chord between two of its corners (requirements §3).
 *
 * A general division: either side may be a triangle or a polygon of any size, so splitting
 * a quad into two quads is as ordinary as splitting it into two triangles. Because the
 * parent is planar the chord lies in its plane, so both children are planar automatically —
 * which is what makes splitting the remedy for a vertex pinned by constraint 9.
 *
 * Both children walk the parent's loop forward, so they inherit its winding and their
 * normals point the same way it did — dihedral angles and unfolding carry over unchanged.
 */
export function splitFace(
  design: Design,
  faceId: string,
  m: string,
  n: string,
  makeId: () => string,
): SplitOutcome<SplitFaceResult> {
  const face = design.faces.find((f) => f.id === faceId);
  if (!face) return { ok: false, reason: 'That face is no longer in the design.' };
  if (design.baseFaceId === faceId) {
    return { ok: false, reason: 'The base has to stay one panel, so it cannot be split.' };
  }

  const loop = face.vertexIds;
  const i = loop.indexOf(m);
  const j = loop.indexOf(n);
  if (i < 0 || j < 0) return { ok: false, reason: 'Both ends of the split have to be corners of this face.' };
  if (i === j) return { ok: false, reason: 'A split needs two different corners.' };

  const size = loop.length;
  const forward = (j - i + size) % size;
  const backward = (i - j + size) % size;
  if (forward < 2 || backward < 2) {
    return { ok: false, reason: 'Those corners are already joined by an edge — pick two that are not neighbours.' };
  }

  // Geometry checks run in the parent's own 2D frame, where "inside" means something.
  const basis = faceLocalBasis(design, face);
  const flat = facePositions(design, face).map((p) => toFaceLocal(basis, p));
  const chordA = flat[i];
  const chordB = flat[j];
  const midpoint: P2 = { u: (chordA.u + chordB.u) / 2, v: (chordA.v + chordB.v) / 2 };

  if (!pointInPolygon(midpoint, flat)) {
    return { ok: false, reason: 'That split would pass outside the face.' };
  }
  for (let k = 0; k < size; k++) {
    if (k === i || k === j || (k + 1) % size === i || (k + 1) % size === j) continue;
    if (properlyCross(chordA, chordB, flat[k], flat[(k + 1) % size])) {
      return { ok: false, reason: 'That split would cross one of the face\'s own edges.' };
    }
  }

  const walk = (from: number, to: number): string[] => {
    const ids: string[] = [];
    for (let k = from; ; k = (k + 1) % size) {
      ids.push(loop[k]);
      if (k === to) break;
    }
    return ids;
  };

  const idA = makeId();
  const idB = makeId();
  const childA: Face = { id: idA, vertexIds: walk(i, j), label: `${face.label}a` };
  const childB: Face = { id: idB, vertexIds: walk(j, i), label: `${face.label}b` };

  let next: Design = {
    ...design,
    edges: hasEdge(design, m, n) ? design.edges : [...design.edges, { a: m, b: n }],
    faces: design.faces.flatMap((f) => (f.id === faceId ? [childA, childB] : [f])),
  };

  next = { ...next, holes: redistributeHoles(design, face, basis, next, [childA, childB]) };
  next = { ...next, angleLocks: repointAngleLocks(next, faceId, [idA, idB]) };

  return { ok: true, design: next, faceIds: [idA, idB] };
}

/**
 * Moves each of the parent's holes onto whichever child now contains it.
 *
 * Hole coordinates are face-local — measured from the face's first vertex along its first
 * edge — so a hole cannot simply keep its numbers: both children start somewhere else.
 * The 3D position is what's real; the u/v on either side of the split are just views of it.
 */
function redistributeHoles(
  before: Design,
  parent: Face,
  parentBasis: ReturnType<typeof faceLocalBasis>,
  after: Design,
  children: Face[],
): Hole[] {
  const parentHoles = before.holes.filter((h) => h.faceId === parent.id);
  if (parentHoles.length === 0) return after.holes;

  const kept = after.holes.filter((h) => h.faceId !== parent.id);
  const moved: Hole[] = [];

  for (const hole of parentHoles) {
    const world = V.add(
      parentBasis.origin,
      V.add(V.scale(parentBasis.uAxis, hole.u), V.scale(parentBasis.vAxis, hole.v)),
    );
    // Test containment in the parent's frame, where both children are flat by definition.
    const point = toFaceLocal(parentBasis, world);
    const home =
      children.find((child) =>
        pointInPolygon(
          point,
          child.vertexIds.map((id) => toFaceLocal(parentBasis, getVertex(after, id).position)),
        ),
      ) ?? children[0]; // exactly on the chord: it has to go somewhere, so take the first

    const childBasis = faceLocalBasis(after, home);
    const local = toFaceLocal(childBasis, world);
    moved.push({ ...hole, faceId: home.id, u: local.u, v: local.v });
  }

  return [...kept, ...moved];
}

/**
 * Re-points the parent's angle locks at whichever child inherited the locked edge.
 *
 * A lock lives on the edge two faces share, so after a split it belongs to the child that
 * still carries that edge. A lock whose edge is now shared by neither child has nothing
 * left to constrain and is dropped rather than left dangling (constraint 8).
 */
function repointAngleLocks(design: Design, parentId: string, childIds: string[]) {
  return design.angleLocks.flatMap((lock) => {
    const isA = lock.faceAId === parentId;
    const isB = lock.faceBId === parentId;
    if (!isA && !isB) return [lock];

    const other = isA ? lock.faceBId : lock.faceAId;
    const heir = childIds.find((childId) => !!findSharedEdge(design, childId, other));
    if (!heir) return [];
    return [isA ? { ...lock, faceAId: heir } : { ...lock, faceBId: heir }];
  });
}

/** Corner pairs of `face` that a chord could legitimately join, for offering the choice. */
export function splittableCornerPairs(face: Face): Array<{ a: string; b: string }> {
  const size = face.vertexIds.length;
  const pairs: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const forward = (j - i + size) % size;
      const backward = (i - j + size) % size;
      if (forward >= 2 && backward >= 2) pairs.push({ a: face.vertexIds[i], b: face.vertexIds[j] });
    }
  }
  return pairs;
}

/** The edges a face would be left with after a split — used only to preview a chord. */
export function chordExists(design: Design, a: string, b: string): boolean {
  return design.faces.some((f) => faceEdgePairs(f).some((p) => edgeKey(p.a, p.b) === edgeKey(a, b)));
}
