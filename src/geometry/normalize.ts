import type { AngleLock, Design, Edge, Face, Hole, Vertex } from './types';
import {
  BASE_PLANE_DEFAULT_IN,
  clampBasePlaneSize,
  createEmptyDesign,
  edgeKey,
} from './types';
import { edgesFromFaces, faceEdgePairs, withFaceEdges } from './edges';
import { validateDesign, type DesignIssue } from './validate';

/**
 * Brings a design in from outside — a file, localStorage, or a version of the app that
 * stored something different — and makes it safe to render.
 *
 * Two kinds of problem get different treatment, matching requirements §3:
 *
 * - **Structural** breakage (a face pointing at a vertex that isn't there, a loop with two
 *   sides, a missing edge) is repaired, because the alternative is a crash rather than a
 *   degraded model. Every repair is reported.
 * - **Geometric** invalidity (a warped, slivered or self-crossing face) is reported and
 *   left exactly as found. Moving someone's geometry without asking is what the whole
 *   coplanarity discussion was about; the app offers a repair instead of performing one.
 */

export interface NormalizeResult {
  design: Design;
  /** What remains wrong after repair — geometric warnings the user decides about. */
  issues: DesignIssue[];
  /** What had to be changed to make the design loadable, in plain language. */
  repairs: string[];
}

/**
 * What actually arrives from a file or localStorage: a Design's keys, every value
 * unverified. Typed as `unknown` rather than `Partial<Design>` so nothing downstream can
 * read a field without checking it first — a saved file is input, not a promise.
 */
export type RawDesign = { [K in keyof Design]?: unknown };

/** Whether a parsed file holds anything worth loading, without trusting its shape. */
export function hasGeometry(raw: RawDesign | null | undefined): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return asArray(raw.vertices).length > 0 || asArray(raw.faces).length > 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeDesign(raw: RawDesign | null | undefined): NormalizeResult {
  const repairs: string[] = [];
  const empty = createEmptyDesign();
  if (!raw || typeof raw !== 'object') {
    return { design: empty, issues: [], repairs: ['The design file was empty or unreadable.'] };
  }

  const vertices = asArray<Vertex>(raw.vertices).filter(
    (v) => v && typeof v.id === 'string' && v.position && typeof v.position.x === 'number',
  );
  const vertexIds = new Set(vertices.map((v) => v.id));

  // Faces first: a face that can't be trusted is dropped, and everything pointing at it
  // has to go too. Dropping is a last resort, but a face missing a corner has no geometry.
  const keptFaces: Face[] = [];
  const droppedLabels: string[] = [];
  for (const face of asArray<Face>(raw.faces)) {
    const loop = Array.isArray(face?.vertexIds) ? face.vertexIds : [];
    const resolvable = loop.every((id) => vertexIds.has(id));
    const distinct = new Set(loop).size === loop.length;
    if (typeof face?.id !== 'string' || loop.length < 3 || !resolvable || !distinct) {
      droppedLabels.push(face?.label || face?.id || 'an unnamed face');
      continue;
    }
    keptFaces.push({ id: face.id, vertexIds: [...loop], label: face.label ?? 'Face' });
  }
  if (droppedLabels.length > 0) {
    repairs.push(
      `Dropped ${droppedLabels.length} unusable face(s) — ${droppedLabels.join(', ')} — with fewer than 3 corners, a repeated corner, or a corner that no longer exists.`,
    );
  }
  const faceIds = new Set(keptFaces.map((f) => f.id));

  // Edges: migrate a design that predates them, then dedupe and drop anything unusable.
  const rawEdges = asArray<Edge>(raw.edges);
  let edges: Edge[];
  if (rawEdges.length === 0 && keptFaces.length > 0) {
    edges = edgesFromFaces(keptFaces);
    repairs.push(
      `Derived ${edges.length} edge(s) from the existing faces — this design predates edges being stored in their own right.`,
    );
  } else {
    const seen = new Set<string>();
    edges = [];
    let discarded = 0;
    for (const e of rawEdges) {
      if (!e || typeof e.a !== 'string' || typeof e.b !== 'string') {
        discarded += 1;
        continue;
      }
      const key = edgeKey(e.a, e.b);
      if (e.a === e.b || !vertexIds.has(e.a) || !vertexIds.has(e.b) || seen.has(key)) {
        discarded += 1;
        continue;
      }
      seen.add(key);
      edges.push({ a: e.a, b: e.b });
    }
    if (discarded > 0) {
      repairs.push(`Discarded ${discarded} edge(s) that were duplicated, self-joined, or missing an endpoint.`);
    }
  }

  let design: Design = {
    vertices,
    edges,
    faces: keptFaces,
    holes: asArray<Hole>(raw.holes).filter((h) => h && faceIds.has(h.faceId)),
    angleLocks: asArray<AngleLock>(raw.angleLocks).filter(
      (l) => l && faceIds.has(l.faceAId) && faceIds.has(l.faceBId),
    ),
    panelThicknessIn:
      typeof raw.panelThicknessIn === 'number' && raw.panelThicknessIn > 0
        ? raw.panelThicknessIn
        : empty.panelThicknessIn,
    baseFaceId: typeof raw.baseFaceId === 'string' && faceIds.has(raw.baseFaceId) ? raw.baseFaceId : null,
    basePlaneSizeIn: clampBasePlaneSize(
      typeof raw.basePlaneSizeIn === 'number' ? raw.basePlaneSizeIn : BASE_PLANE_DEFAULT_IN,
    ),
  };

  const droppedHoles = asArray<Hole>(raw.holes).length - design.holes.length;
  if (droppedHoles > 0) repairs.push(`Removed ${droppedHoles} hole(s) placed on a face that no longer exists.`);
  const droppedLocks = asArray<AngleLock>(raw.angleLocks).length - design.angleLocks.length;
  if (droppedLocks > 0) repairs.push(`Removed ${droppedLocks} angle lock(s) referring to a face that no longer exists.`);
  if (typeof raw.baseFaceId === 'string' && !design.baseFaceId) {
    repairs.push(`Cleared the base face reference — it pointed at a face that no longer exists.`);
  }

  // Any face side still lacking an edge gets one, so constraint 8 holds by construction.
  const beforeFill = design.edges.length;
  design = withFaceEdges(design);
  const filled = design.edges.length - beforeFill;
  if (filled > 0) repairs.push(`Added ${filled} missing edge(s) implied by existing faces.`);

  return { design, issues: validateDesign(design), repairs };
}

/**
 * Whether a design already satisfies the structural constraints, without normalizing it.
 * Useful in tests and assertions; the load path should just normalize.
 */
export function isStructurallySound(design: Design): boolean {
  const vertexIds = new Set(design.vertices.map((v) => v.id));
  const keys = new Set(design.edges.map((e) => edgeKey(e.a, e.b)));
  return design.faces.every(
    (f) =>
      f.vertexIds.length >= 3 &&
      f.vertexIds.every((id) => vertexIds.has(id)) &&
      faceEdgePairs(f).every((p) => keys.has(edgeKey(p.a, p.b))),
  );
}
