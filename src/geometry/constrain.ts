import type { Design, Face, Vec3 } from './types';
import { BASE_PLANE_Z } from './types';
import { V, polygonNormal, polygonCentroid } from './vec3';
import { getVertex } from './mesh';
import { effectiveWidthIn, faceSelfIntersects, MIN_FACE_WIDTH_IN } from './validate';

/**
 * Keeping faces flat by constraining the drag (requirements §3, constraint 9).
 *
 * Every move — a vertex, a whole edge — is a translation of some set of vertices. Each
 * face that would be warped by it contributes one linear equation on that translation, and
 * the move is projected onto whatever motion satisfies all of them. Nothing is corrected
 * after the fact, so nothing the user didn't grab ever moves.
 *
 * The freedom left over is `3 - rank`, and it can be zero: on a closed box every corner is
 * pinned by the three quads meeting there. Its edges are not, though — the two faces along
 * an edge of a box are parallelograms, which constrain nothing, so the box shears where it
 * cannot be dented. That difference is why edge dragging is its own operation rather than a
 * shortcut for moving two vertices, and why every result here carries a description of what
 * is holding it.
 */

/** One row of `A·t = rhs`, with the face that imposed it so a refusal can be explained. */
export interface MotionConstraint {
  normal: Vec3;
  rhs: number;
  faceId: string;
  faceLabel: string;
}

export interface Freedom {
  /** 0 = pinned, 1 = along a line, 2 = across a plane, 3 = free. */
  dof: number;
  /** Orthonormal directions the motion may use. Length equals `dof`. */
  basis: Vec3[];
  /** The faces doing the constraining, for explaining a limit to the user. */
  holdingFaceLabels: string[];
}

export interface ConstrainedMove {
  /** The translation actually applied, after projection and any validity limiting. */
  translation: Vec3;
  freedom: Freedom;
  /** True when constraints 6/7 cut the move short rather than planarity redirecting it. */
  limitedByValidity: boolean;
}

const INDEPENDENCE_EPS = 1e-7;
const DEGENERATE_EPS = 1e-9;

/**
 * The equations a face imposes when `moving` is translated and its other corners stay put.
 *
 * Two cases, and which applies is about how many corners stay behind rather than how the
 * move was started:
 *
 * - **Three or more fixed corners** define a plane outright, and every moving corner has to
 *   stay in it. That is the vertex-drag case, and the edge-drag case on a pentagon or larger.
 * - **Exactly two fixed corners** don't define a plane, so the condition is that all four
 *   corners end up coplanar. Because both moving corners travel together the translation
 *   survives the determinant linearly, giving one equation rather than two — which is
 *   precisely why an edge can move where neither of its endpoints could alone.
 */
function faceConstraints(design: Design, face: Face, moving: Set<string>): MotionConstraint[] {
  if (face.vertexIds.length < 4) return []; // a triangle is planar whatever happens to it

  const movingIds = face.vertexIds.filter((id) => moving.has(id));
  if (movingIds.length === 0) return [];

  const fixedIds = face.vertexIds.filter((id) => !moving.has(id));
  const pos = (id: string) => getVertex(design, id).position;
  const tag = { faceId: face.id, faceLabel: face.label };

  if (fixedIds.length >= 3) {
    const fixed = fixedIds.map(pos);
    const normal = polygonNormal(fixed);
    if (V.length(normal) < DEGENERATE_EPS) return []; // the fixed corners are in a line
    const through = V.dot(normal, polygonCentroid(fixed));
    // n·(m + t) = through, for each moving corner. On an already-flat face these agree and
    // Gram-Schmidt drops the duplicates; on a warped one they disagree and the elimination
    // reports the conflict instead of silently picking a winner.
    return movingIds.map((id) => ({ ...tag, normal, rhs: through - V.dot(normal, pos(id)) }));
  }

  if (fixedIds.length === 2 && movingIds.length === 2) {
    const [m0, m1] = movingIds.map(pos);
    const [w0, w1] = fixedIds.map(pos);
    const along = V.sub(m1, m0);
    // Coplanarity of the four corners, expanded: t · (along x (w0 - w1)) = along · (p x q).
    const normal = V.cross(along, V.sub(w0, w1));
    const rhs = V.dot(along, V.cross(V.sub(w0, m0), V.sub(w1, m0)));
    // A zero normal means the fixed pair runs parallel to the moving edge — the face then
    // stays flat under any translation at all, so it constrains nothing.
    if (V.length(normal) < DEGENERATE_EPS) return [];
    return [{ ...tag, normal, rhs }];
  }

  return [];
}

/**
 * The base plane's own equation, for any moving corner of the base (constraint 11).
 *
 * The base isn't a face that happens to be flat — it *is* the base plane, the surface the
 * volume bolts to the wall by. Its corners slide about within it and never leave it.
 *
 * Nothing above says so. `faceConstraints` asks only that a face stay flat in its own
 * right, and that leaves the base free in exactly the ways that matter: a triangular base
 * yields no equation at all, since any three points are coplanar, and a rectangular one
 * yields none for a whole edge, since the corners staying behind run parallel to the pair
 * moving. Both could be lifted clean off the plane, which is the defect this fixes. Even
 * where a planarity equation does apply it would hold a base that was already tilted just
 * as contentedly, so it could never have kept the base level either.
 *
 * Stated as `z = BASE_PLANE_Z` rather than as "don't change z", so a corner that has
 * already drifted is brought back the first time it is touched.
 */
function baseConstraints(design: Design, moving: Set<string>): MotionConstraint[] {
  const base = design.faces.find((f) => f.id === design.baseFaceId);
  if (!base) return [];
  return base.vertexIds
    .filter((id) => moving.has(id))
    .map((id) => ({
      normal: { x: 0, y: 0, z: 1 },
      rhs: BASE_PLANE_Z - getVertex(design, id).position.z,
      faceId: base.id,
      faceLabel: base.label,
    }));
}

/** Every constraint on translating `movingIds`, from the base plane and from every face. */
export function constraintsForTranslation(design: Design, movingIds: string[]): MotionConstraint[] {
  const moving = new Set(movingIds);
  // The base plane goes first: `reduce` keeps the rows it meets first and drops later ones
  // that add nothing, and of all the rules here this is the one that must survive.
  return [
    ...baseConstraints(design, moving),
    ...design.faces
      .filter((f) => f.vertexIds.some((id) => moving.has(id)))
      .flatMap((f) => faceConstraints(design, f, moving)),
  ];
}

interface ReducedRow {
  normal: Vec3;
  rhs: number;
}

/**
 * Gram-Schmidt over the constraint rows, discarding the redundant ones.
 *
 * Rows are normalized first so independence is judged on direction rather than on how big
 * the model happens to be. A row that reduces to nothing is redundant and dropped; if its
 * right-hand side doesn't reduce to nothing too, the constraints disagree — which means the
 * face was already warped, since no translation can satisfy both.
 */
function reduce(constraints: MotionConstraint[]): { rows: ReducedRow[]; holding: string[] } {
  const rows: ReducedRow[] = [];
  const holding: string[] = [];

  for (const c of constraints) {
    const scale = V.length(c.normal);
    if (scale < DEGENERATE_EPS) continue;
    let normal = V.scale(c.normal, 1 / scale);
    let rhs = c.rhs / scale;

    for (const row of rows) {
      const overlap = V.dot(normal, row.normal);
      normal = V.sub(normal, V.scale(row.normal, overlap));
      rhs -= overlap * row.rhs;
    }

    const remaining = V.length(normal);
    if (remaining < INDEPENDENCE_EPS) continue; // redundant, or an unsatisfiable leftover
    rows.push({ normal: V.scale(normal, 1 / remaining), rhs: rhs / remaining });
    if (!holding.includes(c.faceLabel)) holding.push(c.faceLabel);
    if (rows.length === 3) break; // fully determined; further rows can only be redundant
  }

  return { rows, holding };
}

/** An orthonormal basis for the directions left free by a set of constraint rows. */
function nullSpace(rows: ReducedRow[]): Vec3[] {
  const axes: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  const basis: Vec3[] = [];
  for (const axis of axes) {
    let candidate = axis;
    for (const row of rows) candidate = V.sub(candidate, V.scale(row.normal, V.dot(candidate, row.normal)));
    for (const b of basis) candidate = V.sub(candidate, V.scale(b, V.dot(candidate, b)));
    const length = V.length(candidate);
    if (length > INDEPENDENCE_EPS) basis.push(V.scale(candidate, 1 / length));
    if (basis.length === 3 - rows.length) break;
  }
  return basis;
}

export function freedomForTranslation(design: Design, movingIds: string[]): Freedom {
  const { rows, holding } = reduce(constraintsForTranslation(design, movingIds));
  return { dof: 3 - rows.length, basis: nullSpace(rows), holdingFaceLabels: holding };
}

/** The nearest translation to `desired` that satisfies every constraint row. */
function projectOntoConstraints(desired: Vec3, rows: ReducedRow[]): Vec3 {
  let t = desired;
  // The rows are orthonormal, so one pass lands exactly on their intersection.
  for (const row of rows) t = V.sub(t, V.scale(row.normal, V.dot(t, row.normal) - row.rhs));
  return t;
}

function translated(design: Design, movingIds: string[], t: Vec3): Design {
  const moving = new Set(movingIds);
  return {
    ...design,
    vertices: design.vertices.map((v) =>
      moving.has(v.id) ? { ...v, position: V.add(v.position, t) } : v,
    ),
  };
}

/**
 * Whether a candidate keeps every affected face cuttable — constraints 6 and 7.
 *
 * Planarity decides which *directions* a move may use; these decide how *far* it may go
 * along them. Both read as "it won't go there", but they are separate mechanisms.
 */
function facesStayValid(movingIds: string[], candidate: Design): boolean {
  const moving = new Set(movingIds);
  for (const face of candidate.faces) {
    if (!face.vertexIds.some((id) => moving.has(id))) continue;
    const points = face.vertexIds.map((id) => getVertex(candidate, id).position);
    if (effectiveWidthIn(points) < MIN_FACE_WIDTH_IN) return false;
    if (faceSelfIntersects(candidate, face)) return false;
  }
  return true;
}

const LIMIT_SEARCH_STEPS = 24;

/**
 * Works out how a requested move may actually be carried out.
 *
 * Planarity redirects it: the translation is projected onto the motion every affected face
 * permits. Validity then shortens it: if the projected move would collapse a face to a
 * sliver or fold its boundary over itself, the largest fraction that stays legal is used.
 * A locked vertex anywhere in the moving set stops the move outright.
 */
export function constrainTranslation(design: Design, movingIds: string[], desired: Vec3): ConstrainedMove {
  const locked = movingIds.some((id) => design.vertices.find((v) => v.id === id)?.locked);
  const { rows, holding } = reduce(constraintsForTranslation(design, movingIds));
  const freedom: Freedom = { dof: 3 - rows.length, basis: nullSpace(rows), holdingFaceLabels: holding };

  if (locked || freedom.dof === 0) {
    return { translation: { x: 0, y: 0, z: 0 }, freedom, limitedByValidity: false };
  }

  const projected = projectOntoConstraints(desired, rows);
  if (V.length(projected) < DEGENERATE_EPS) {
    return { translation: { x: 0, y: 0, z: 0 }, freedom, limitedByValidity: false };
  }

  if (facesStayValid(movingIds, translated(design, movingIds, projected))) {
    return { translation: projected, freedom, limitedByValidity: false };
  }

  // Binary-search the largest fraction of the move that keeps every face cuttable.
  let low = 0;
  let high = 1;
  for (let i = 0; i < LIMIT_SEARCH_STEPS; i++) {
    const mid = (low + high) / 2;
    const candidate = translated(design, movingIds, V.scale(projected, mid));
    if (facesStayValid(movingIds, candidate)) low = mid;
    else high = mid;
  }
  return { translation: V.scale(projected, low), freedom, limitedByValidity: true };
}

/** Constrained move of a single vertex toward a target position. */
export function constrainVertexMove(design: Design, vertexId: string, target: Vec3): ConstrainedMove {
  const current = design.vertices.find((v) => v.id === vertexId);
  if (!current) {
    return {
      translation: { x: 0, y: 0, z: 0 },
      freedom: { dof: 0, basis: [], holdingFaceLabels: [] },
      limitedByValidity: false,
    };
  }
  return constrainTranslation(design, [vertexId], V.sub(target, current.position));
}

/** Plain-language account of what a vertex or edge is free to do, for the panel. */
export function describeFreedom(freedom: Freedom): string {
  const holding = freedom.holdingFaceLabels;
  const by = holding.length > 0 ? ` by ${holding.join(', ')}` : '';
  switch (freedom.dof) {
    case 3:
      return 'Free to move in any direction.';
    case 2:
      return `Slides across a plane — held${by}.`;
    case 1:
      return `Slides along a line — held${by}.`;
    default:
      return `Pinned${by}. Splitting one of those faces is what frees it.`;
  }
}
