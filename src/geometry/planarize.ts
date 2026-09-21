import type { Design, Vec3 } from './types';
import { V, polygonNormal, polygonCentroid } from './vec3';

/** How far off-plane a corner may sit before the face counts as warped, in inches. */
const PLANARITY_TOLERANCE_IN = 1e-7;
const MAX_ITERATIONS = 200;
/** A correction that throws a vertex this far (relative to model size) has gone wrong. */
const RUNAWAY_FACTOR = 2;

interface PlanarizeOptions {
  /** Vertex ids that must not move, on top of the dragged/locked/base ones. */
  alsoPinned?: string[];
}

/**
 * Keeps faces flat while a corner is being moved.
 *
 * Four or more corners don't generally share a plane, so moving one corner warps every
 * face it belongs to — visible as a crease along the diagonal the renderer triangulates
 * on, and forcing the unfolder to approximate that panel as two triangles.
 *
 * Correcting only the faces touching the moved corner isn't enough: the corner that
 * absorbs the fix belongs to further faces, which then warp in turn. So this relaxes the
 * whole model instead, repeatedly projecting each warped face's free corners onto that
 * face's best-fit plane until everything settles.
 *
 * Held fixed throughout: the corner being dragged (the edit must survive), any locked
 * corners, and the base face — the base is the mounting surface, so a drag elsewhere in
 * the model must never quietly tilt it. Dragging a base corner naturally frees the base,
 * since that face is then the one being edited.
 */
export function keepFacesPlanar(design: Design, draggedVertexId: string, options: PlanarizeOptions = {}): Design {
  const faces = design.faces.filter((f) => f.vertexIds.length >= 4);
  if (faces.length === 0) return design;

  const baseFace = design.faces.find((f) => f.id === design.baseFaceId);
  const draggingTheBase = !!baseFace?.vertexIds.includes(draggedVertexId);

  const pinned = new Set<string>([draggedVertexId, ...(options.alsoPinned ?? [])]);
  for (const v of design.vertices) if (v.locked) pinned.add(v.id);
  if (baseFace && !draggingTheBase) for (const id of baseFace.vertexIds) pinned.add(id);

  const positions = new Map<string, Vec3>();
  for (const v of design.vertices) positions.set(v.id, v.position);
  const original = new Map(positions);

  let settled = false;
  for (let iteration = 0; iteration < MAX_ITERATIONS && !settled; iteration++) {
    let worstDeviation = 0;

    for (const face of faces) {
      const corners = face.vertexIds.map((id) => positions.get(id)!);
      const normal = polygonNormal(corners);
      if (V.length(normal) < 1e-9) continue; // degenerate face, no plane to fit

      const centroid = polygonCentroid(corners);
      const free = face.vertexIds.filter((id) => !pinned.has(id));
      if (free.length === 0) continue; // fully constrained; nothing to correct

      for (const id of free) {
        const offPlane = V.dot(V.sub(positions.get(id)!, centroid), normal);
        worstDeviation = Math.max(worstDeviation, Math.abs(offPlane));
        if (Math.abs(offPlane) < PLANARITY_TOLERANCE_IN) continue;
        positions.set(id, V.sub(positions.get(id)!, V.scale(normal, offPlane)));
      }
    }

    settled = worstDeviation < PLANARITY_TOLERANCE_IN;
  }

  // If the relaxation ever flings a vertex (an over-constrained model can refuse to
  // settle), leave the geometry exactly as the user left it rather than mangling it.
  const modelSize = modelExtent(design);
  for (const [id, moved] of positions) {
    if (V.distance(moved, original.get(id)!) > modelSize * RUNAWAY_FACTOR) return design;
  }

  return {
    ...design,
    vertices: design.vertices.map((v) => {
      const moved = positions.get(v.id)!;
      return moved === v.position ? v : { ...v, position: moved };
    }),
  };
}

function modelExtent(design: Design): number {
  let extent = 1;
  for (const v of design.vertices) {
    extent = Math.max(extent, Math.abs(v.position.x), Math.abs(v.position.y), Math.abs(v.position.z));
  }
  return extent;
}
