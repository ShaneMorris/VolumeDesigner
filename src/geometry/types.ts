export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vertex {
  id: string;
  position: Vec3;
  /** When true, the vertex can still be used to snap/close faces but can't be dragged. */
  locked?: boolean;
}

/**
 * A connection between exactly two distinct vertices (requirements §3, constraint 1).
 *
 * Edges are stored, not derived: an edge may belong to zero, one or two faces, which is
 * what lets a defining edge be drawn exactly and left standing before the face around it
 * exists. An edge is identified by its endpoint pair via `edgeKey`, not by a separate id —
 * that makes "the same edge twice" unrepresentable rather than merely discouraged.
 */
export interface Edge {
  a: string;
  b: string;
}

export interface Face {
  id: string;
  /** Ordered, closed loop of vertex ids (not repeating the first at the end). */
  vertexIds: string[];
  label: string;
}

/** A dihedral angle lock between two faces along their shared edge. */
export interface AngleLock {
  id: string;
  faceAId: string;
  faceBId: string;
  /** Interior dihedral angle in degrees, measured as the fold angle at the shared edge. */
  targetAngleDeg: number;
}

export interface Hole {
  id: string;
  faceId: string;
  /** Face-local coordinates, inches, origin at the face's first vertex. */
  u: number;
  v: number;
  diameterIn: number;
}

export interface Design {
  vertices: Vertex[];
  /** Connectivity, and the source of truth for it. Faces are an ordered overlay on these. */
  edges: Edge[];
  faces: Face[];
  angleLocks: AngleLock[];
  holes: Hole[];
  /** Global panel material thickness, inches — used only for corner miter correction. */
  panelThicknessIn: number;
  baseFaceId: string | null;
  /** Side length of the square base plane (the work area), in inches. */
  basePlaneSizeIn: number;
}

/**
 * The height of the base plane (requirements §3, constraint 11).
 *
 * The base face doesn't merely start here — it lives here. It is the surface the finished
 * volume bolts to the wall by, so a base that has been tilted or lifted is scrap rather
 * than a design choice, and every editing operation holds its corners at this height.
 */
export const BASE_PLANE_Z = 0;

/** Bounds for the square base plane the model is built on. */
export const BASE_PLANE_MIN_IN = 6;
export const BASE_PLANE_MAX_IN = 96;
export const BASE_PLANE_DEFAULT_IN = 24;

export function clampBasePlaneSize(inches: number): number {
  if (!Number.isFinite(inches)) return BASE_PLANE_DEFAULT_IN;
  return Math.min(BASE_PLANE_MAX_IN, Math.max(BASE_PLANE_MIN_IN, inches));
}

export function createEmptyDesign(basePlaneSizeIn = BASE_PLANE_DEFAULT_IN): Design {
  return {
    vertices: [],
    edges: [],
    faces: [],
    angleLocks: [],
    holes: [],
    panelThicknessIn: 0.75,
    baseFaceId: null,
    basePlaneSizeIn: clampBasePlaneSize(basePlaneSizeIn),
  };
}

/** Unordered pair of vertex ids identifying an edge, canonicalized so (a,b) === (b,a). */
export type EdgeKey = string;

export function edgeKey(a: string, b: string): EdgeKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface DerivedEdge {
  key: EdgeKey;
  a: string;
  b: string;
  /** Faces that contain this edge (as a consecutive vertex pair in their loop). Usually 1 or 2. */
  faceIds: string[];
}
