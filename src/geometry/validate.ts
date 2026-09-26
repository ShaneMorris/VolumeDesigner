import type { Design, EdgeKey, Face } from './types';
import { edgeKey, BASE_PLANE_Z } from './types';
import { facePositions, planarityDeviation } from './mesh';
import { faceEdgePairs } from './edges';
import { V, polygonArea } from './vec3';
import type { Vec3 } from './types';

/**
 * Checks a design against the constraints in requirements §3.
 *
 * These are invariants, so in normal use nothing here should ever fire — the editing
 * operations are written not to break them. It earns its keep on the load path, where a
 * design file (hand-edited, truncated, or written by an older version) is untrusted input.
 */

export type IssueSeverity = 'error' | 'warning';

export interface DesignIssue {
  /** Which numbered constraint in requirements §3 this violates. */
  constraint: number;
  /**
   * `error` — structurally broken; the design can't be rendered or measured safely and
   * normalizing will repair it. `warning` — geometrically invalid but renderable, so it
   * is reported and left alone for the user to decide about.
   */
  severity: IssueSeverity;
  message: string;
  faceId?: string;
  vertexId?: string;
  edge?: EdgeKey;
}

/** Below this, a face is a sliver rather than a panel. See `effectiveWidthIn`. */
export const MIN_FACE_WIDTH_IN = 0.01;
/** Matches the tolerance `isFacePlanar` uses. */
const PLANARITY_EPS_IN = 1e-3;
/** How far a base corner may sit off the base plane before it counts as off it. */
const BASE_PLANE_EPS_IN = 1e-3;

/**
 * A face's narrowest meaningful dimension: `2 * area / perimeter`.
 *
 * For a w x L rectangle this is very close to w, so one number catches both the exactly
 * degenerate case (collinear points enclose no area, so width is 0) and the near-collinear
 * sliver, which is the more dangerous of the two — it passes a plain area test but its
 * normal flips under tiny edits, making bevel angles jump (requirements §3, constraint 6).
 */
export function effectiveWidthIn(points: ReturnType<typeof facePositions>): number {
  const area = polygonArea(points);
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    perimeter += V.distance(points[i], points[(i + 1) % points.length]);
  }
  if (perimeter === 0) return 0;
  return (2 * area) / perimeter;
}

/**
 * A 2D frame for a loop, built from its first three non-collinear corners.
 *
 * Deliberately not `faceLocalBasis`, which takes its normal from Newell's formula: on a
 * self-crossing loop the lobes wind in opposite directions and that vector can cancel to
 * exactly zero (a symmetric bowtie does precisely this), leaving no usable plane at the
 * very moment one is needed. Three corners define a plane whatever the loop does next.
 */
function loopBasis(points: Vec3[]): { origin: Vec3; u: Vec3; v: Vec3 } | null {
  const origin = points[0];
  let u: Vec3 | null = null;
  for (let i = 1; i < points.length; i++) {
    const d = V.sub(points[i], origin);
    if (V.length(d) > 1e-9) {
      u = V.normalize(d);
      break;
    }
  }
  if (!u) return null;
  for (let i = 2; i < points.length; i++) {
    const d = V.sub(points[i], origin);
    const normal = V.cross(u, d);
    if (V.length(normal) > 1e-9) {
      return { origin, u, v: V.normalize(V.cross(V.normalize(normal), u)) };
    }
  }
  return null; // every corner on one line — constraint 6's problem, not this one
}

/**
 * Whether a face's boundary crosses itself (requirements §3, constraint 7).
 *
 * The loop is flattened into its own plane and every non-adjacent pair of segments is
 * tested for a proper crossing. Segments sharing an endpoint are adjacent by construction
 * and skipped. For a non-planar face the flattening is approximate, but such a face is
 * already reported under constraint 9.
 */
export function faceSelfIntersects(design: Design, face: Face): boolean {
  const points = facePositions(design, face);
  const n = points.length;
  if (n < 4) return false; // a triangle's three segments are all mutually adjacent

  const basis = loopBasis(points);
  if (!basis) return false;
  const flat = points.map((p) => ({
    u: V.dot(V.sub(p, basis.origin), basis.u),
    v: V.dot(V.sub(p, basis.origin), basis.v),
  }));

  for (let i = 0; i < n; i++) {
    const a1 = flat[i];
    const a2 = flat[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent segments, including the wrap-around pair (last, first).
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsProperlyCross(a1, a2, flat[j], flat[(j + 1) % n])) return true;
    }
  }
  return false;
}

interface P2 {
  u: number;
  v: number;
}

function cross(o: P2, a: P2, b: P2): number {
  return (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
}

/** True only for a genuine crossing — touching at an endpoint or overlapping doesn't count. */
function segmentsProperlyCross(p1: P2, p2: P2, p3: P2, p4: P2): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function validateDesign(design: Design): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const vertexIds = new Set(design.vertices.map((v) => v.id));
  const faceIds = new Set(design.faces.map((f) => f.id));
  const storedEdges = new Set<EdgeKey>();

  // Constraint 1 — an edge joins exactly two distinct, existing vertices.
  for (const e of design.edges) {
    const key = edgeKey(e.a, e.b);
    if (e.a === e.b) {
      issues.push({ constraint: 1, severity: 'error', edge: key, message: `Edge joins vertex ${e.a} to itself.` });
      continue;
    }
    for (const id of [e.a, e.b]) {
      if (!vertexIds.has(id)) {
        issues.push({ constraint: 1, severity: 'error', edge: key, message: `Edge ${key} has no vertex ${id}.` });
      }
    }
    if (storedEdges.has(key)) {
      issues.push({ constraint: 1, severity: 'error', edge: key, message: `Edge ${key} is stored more than once.` });
    }
    storedEdges.add(key);
  }

  // Constraint 10 — an edge belongs to at most two faces.
  const facesPerEdge = new Map<EdgeKey, string[]>();
  for (const face of design.faces) {
    for (const { a, b } of faceEdgePairs(face)) {
      const key = edgeKey(a, b);
      const list = facesPerEdge.get(key);
      if (list) list.push(face.id);
      else facesPerEdge.set(key, [face.id]);
    }
  }
  for (const [key, ids] of facesPerEdge) {
    if (ids.length > 2) {
      issues.push({
        constraint: 10,
        severity: 'warning',
        edge: key,
        message: `Edge ${key} is shared by ${ids.length} faces; a volume's edge joins at most two panels.`,
      });
    }
  }

  for (const face of design.faces) {
    const where = face.label || face.id;

    // Constraint 3 — three or more vertices in a closed loop.
    if (face.vertexIds.length < 3) {
      issues.push({
        constraint: 3,
        severity: 'error',
        faceId: face.id,
        message: `"${where}" has ${face.vertexIds.length} vertices; a face needs at least 3.`,
      });
      continue;
    }

    // Constraint 8 — referential integrity of the loop itself.
    const missing = face.vertexIds.filter((id) => !vertexIds.has(id));
    if (missing.length > 0) {
      issues.push({
        constraint: 8,
        severity: 'error',
        faceId: face.id,
        message: `"${where}" refers to ${missing.length} vertex/vertices that don't exist.`,
      });
      continue; // every geometric test below would throw
    }
    if (new Set(face.vertexIds).size !== face.vertexIds.length) {
      issues.push({
        constraint: 8,
        severity: 'error',
        faceId: face.id,
        message: `"${where}" uses the same vertex more than once.`,
      });
      continue;
    }
    for (const { a, b } of faceEdgePairs(face)) {
      const key = edgeKey(a, b);
      if (!storedEdges.has(key)) {
        issues.push({
          constraint: 8,
          severity: 'error',
          faceId: face.id,
          edge: key,
          message: `"${where}" has a side along ${key} with no matching edge.`,
        });
      }
    }

    const points = facePositions(design, face);

    // Constraint 7 comes first: a crossed boundary's lobes wind against each other, so its
    // *net* area can be zero (or anything else), and the area test below would report the
    // wrong problem. The crossing is the real fault.
    if (faceSelfIntersects(design, face)) {
      issues.push({
        constraint: 7,
        severity: 'warning',
        faceId: face.id,
        message: `"${where}" has a boundary that crosses itself.`,
      });
      continue;
    }

    // Constraint 6 — must enclose real area.
    const width = effectiveWidthIn(points);
    if (width < MIN_FACE_WIDTH_IN) {
      issues.push({
        constraint: 6,
        severity: 'warning',
        faceId: face.id,
        message:
          width === 0
            ? `"${where}" encloses no area — its corners are in a straight line.`
            : `"${where}" is a sliver (about ${width.toFixed(4)}in across) and can't be cut as a panel.`,
      });
      continue; // a degenerate face's plane and winding are meaningless
    }

    // Constraint 9 — coplanar corners.
    const deviation = planarityDeviation(design, face);
    if (deviation >= PLANARITY_EPS_IN) {
      issues.push({
        constraint: 9,
        severity: 'warning',
        faceId: face.id,
        message: `"${where}" is warped — a corner sits ${deviation.toFixed(3)}in off the face's plane.`,
      });
    }
  }

  // Constraint 8 — everything else that points at a face.
  for (const hole of design.holes) {
    if (!faceIds.has(hole.faceId)) {
      issues.push({ constraint: 8, severity: 'error', message: `A hole is placed on a face that doesn't exist.` });
    }
  }
  for (const lock of design.angleLocks) {
    if (!faceIds.has(lock.faceAId) || !faceIds.has(lock.faceBId)) {
      issues.push({ constraint: 8, severity: 'error', message: `An angle lock refers to a face that doesn't exist.` });
    }
  }
  if (design.baseFaceId && !faceIds.has(design.baseFaceId)) {
    issues.push({ constraint: 8, severity: 'error', message: `The base face reference points at a face that doesn't exist.` });
  }

  // Constraint 11 — the base face is the base plane, not merely a flat face.
  const base = design.faces.find((f) => f.id === design.baseFaceId);
  if (base) {
    for (const id of base.vertexIds) {
      const vertex = design.vertices.find((v) => v.id === id);
      if (!vertex) continue; // constraint 8 has this
      const off = vertex.position.z - BASE_PLANE_Z;
      if (Math.abs(off) >= BASE_PLANE_EPS_IN) {
        issues.push({
          constraint: 11,
          severity: 'warning',
          faceId: base.id,
          vertexId: id,
          message: `A corner of "${base.label}" sits ${off.toFixed(3)}in off the base plane — the base has to be flat on the wall.`,
        });
      }
    }
  }

  return issues;
}

export function hasErrors(issues: DesignIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
