import { create } from 'zustand';
import type { AngleLock, Design, Face, Hole, Vec3 } from '../geometry/types';
import { clampBasePlaneSize, createEmptyDesign, edgeKey } from '../geometry/types';
import { deriveEdges, faceEdgeKeys, findSharedEdge, getFace, isFacePlanar } from '../geometry/mesh';
import { edgesTouchingVertex, orphanVertexIds, removeEdgeKeys, withFaceEdges } from '../geometry/edges';
import { normalizeDesign, type RawDesign } from '../geometry/normalize';
import { splitEdgeAt, splitFace, parameterAlongEdge } from '../geometry/split';
import { faceFromNewEdge } from '../geometry/loops';
import { addEdge, hasEdge } from '../geometry/edges';
import { validateDesign, type DesignIssue } from '../geometry/validate';
import { setEdgeLengthByMovingVertex, setInteriorAngleAtVertex, extrudeFace } from '../geometry/edit';
import { solveDihedralAngle } from '../geometry/solver';
import { reapplyAngleLocks } from '../geometry/relax';
import { regularPolygonPoints } from '../geometry/polygons';
import { V } from '../geometry/vec3';
import { planeThroughPoints, resolveNextPoint, type DrawPlane } from '../geometry/drawPlane';
import { keepFacesPlanar } from '../geometry/planarize';
import { constrainTranslation, constrainVertexMove, freedomForTranslation } from '../geometry/constrain';
import type { Freedom } from '../geometry/constrain';
import { loadDefaultBasePlaneSize } from '../persistence/storage';

export type Mode = 'sketch' | 'build' | 'angles' | 'holes' | 'unfold';

/** Build mode's active tool, in the CAD sense: pick, move, or draw geometry. */
export type BuildTool = 'select' | 'move' | 'draw';

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export interface SelectedEdge {
  a: string;
  b: string;
  faceAId: string;
  faceBId: string;
}

interface HistoryEntry {
  design: Design;
}

interface DesignStoreState {
  design: Design;
  mode: Mode;

  // Selection
  selectedVertexId: string | null;
  selectedFaceId: string | null;
  selectedEdge: SelectedEdge | null;
  /** Edge picked in Build mode, by its two corners. Any edge qualifies, shared or not. */
  selectedEdgePair: { a: string; b: string } | null;
  selectedHoleId: string | null;

  // Base polygon sketch draft (raw positions, not yet committed to the design)
  openSketch: Vec3[];

  /**
   * The chain of points being drawn, most recent last.
   *
   * Only the chain is a draft — every edge it lays down is committed as it's drawn, so
   * ending a chain keeps the geometry. That's what lets a defining edge be drawn exactly
   * and left standing while the rest of its face is worked out (requirements §3).
   */
  draftVertexIds: string[];
  /** The plane the face in progress is being drawn on; null when not drawing. */
  drawPlane: DrawPlane | null;
  /** Live cursor position on the draw plane, driving the rubber-band segment. */
  drawCursor: Vec3 | null;
  /** Typed-in constraints for the pending point; null means "follow the cursor". */
  lockedLengthIn: number | null;
  lockedAngleDeg: number | null;
  /**
   * A typed target height (world Z) for the pending point, which stands in for length.
   * "45 degrees rising to 4 inches" is the shape of these constraints as they actually
   * arrive; without this, the length would have to be worked out by trigonometry first.
   */
  lockedHeightIn: number | null;
  buildTool: BuildTool;
  /** Vertex currently being click-dragged with the Move tool, if any. */
  draggingVertexId: string | null;
  /** Edge currently being click-dragged by its middle, if any. */
  draggingEdge: { a: string; b: string } | null;
  /**
   * The design as it stood when the current drag began.
   *
   * A drag updates the model live without committing, so undo has to be given the state
   * from *before* the drag. Re-committing the final position instead pushes the dragged
   * state onto the history as its own predecessor, which costs an undo step and loses the
   * original outright.
   */
  dragStartDesign: Design | null;
  /**
   * What the current selection or drag is free to do, and whether the last move was cut
   * short. Constraint 9 refuses moves outright, so the app has to be able to say why.
   */
  moveFreedom: Freedom | null;
  moveWasLimited: boolean;
  /** Bumped to ask the viewport to re-frame the camera around the model. */
  frameNonce: number;
  /** What validation found in the design as loaded, and what had to be repaired to open it. */
  designIssues: DesignIssue[];
  designRepairs: string[];
  /** Why the last edit was refused, in the user's terms. Cleared by the next successful one. */
  actionError: string | null;

  // Undo/redo
  past: HistoryEntry[];
  future: HistoryEntry[];

  setMode: (mode: Mode) => void;

  selectVertex: (id: string | null) => void;
  selectFace: (id: string | null) => void;
  selectEdge: (edge: SelectedEdge | null) => void;
  selectEdgePair: (pair: { a: string; b: string } | null) => void;
  selectHole: (id: string | null) => void;

  // Sketch mode
  addSketchPoint: (p: Vec3) => void;
  undoSketchPoint: () => void;
  closeSketch: (label?: string) => void;
  clearSketch: () => void;
  createBasePolygon: (sides: number, widthIn: number) => void;

  // Build mode
  /** Continue the chain to an existing point, committing the edge to it. */
  extendChainTo: (vertexId: string) => void;
  /** Begin a chain in empty space rather than on an existing point. */
  startChainAtPoint: (p: Vec3, plane: DrawPlane) => void;
  /** Begin or continue a chain at a point along an existing edge, splitting it there. */
  chainThroughEdge: (a: string, b: string, at: Vec3, plane: DrawPlane) => void;
  /** Esc: stop drawing. Everything already drawn stays. */
  endChain: () => void;
  pullUpFace: (faceId: string, heightIn: number) => void;
  startDrawingAt: (vertexId: string, plane: DrawPlane) => void;
  setDrawCursor: (p: Vec3 | null) => void;
  setLockedLength: (lengthIn: number | null) => void;
  setLockedAngle: (angleDeg: number | null) => void;
  setLockedHeight: (heightIn: number | null) => void;
  commitPendingPoint: () => void;
  setBuildTool: (tool: BuildTool) => void;
  frameView: () => void;

  moveVertex: (id: string, position: Vec3, opts?: { commit?: boolean }) => void;
  /** Translate a whole edge, moving both ends together. */
  moveEdgeBy: (a: string, b: string, translation: Vec3, opts?: { commit?: boolean }) => void;
  beginVertexDrag: (id: string) => void;
  beginEdgeDrag: (a: string, b: string) => void;
  /** Ends a drag and records it as a single undo step, from where it started. */
  endDrag: () => void;
  /** Recompute what the current selection could do, without moving anything. */
  refreshMoveFreedom: (ids: string[] | null) => void;
  setVertexLocked: (id: string, locked: boolean) => void;
  setVerticesLocked: (ids: string[], locked: boolean) => void;

  setEdgeLength: (anchorVertexId: string, movingVertexId: string, lengthIn: number) => void;
  setInteriorAngle: (faceId: string, vertexId: string, angleDeg: number) => void;

  lockDihedralAngle: (faceAId: string, faceBId: string, targetAngleDeg: number) => void;
  unlockDihedralAngle: (lockId: string) => void;

  addHole: (faceId: string, u: number, v: number) => void;
  updateHole: (id: string, u: number, v: number) => void;
  removeHole: (id: string) => void;

  setPanelThickness: (inches: number) => void;
  setBasePlaneSize: (inches: number) => void;
  setBaseFaceId: (id: string | null) => void;
  renameFace: (id: string, label: string) => void;

  deleteFace: (id: string) => void;
  deleteVertex: (id: string) => void;
  deleteEdge: (aVertexId: string, bVertexId: string) => void;

  /** Insert a vertex along an edge, at a fraction from `a` toward `b`. */
  splitEdge: (aVertexId: string, bVertexId: string, t: number) => void;
  /** Divide a face along a chord between two of its corners. */
  splitFaceByCorners: (faceId: string, m: string, n: string) => void;
  clearActionError: () => void;

  undo: () => void;
  redo: () => void;

  loadDesign: (design: RawDesign) => void;
  resetDesign: () => void;
  dismissDesignIssues: () => void;
  makeFacesPlanar: () => void;
}

/** The plane of a draft chain once it has enough points to define one. */
function planeOfDraft(design: Design, draftVertexIds: string[]): DrawPlane | null {
  if (draftVertexIds.length < 3) return null;
  const points = draftVertexIds
    .map((id) => design.vertices.find((v) => v.id === id)?.position)
    .filter((p): p is Vec3 => !!p);
  return planeThroughPoints(points);
}

/** Where the in-progress segment currently ends, or null if nothing is pending. */
function pendingPointOf(s: DesignStoreState): Vec3 | null {
  if (!s.drawPlane || s.draftVertexIds.length === 0) return null;
  const lastId = s.draftVertexIds[s.draftVertexIds.length - 1];
  const from = s.design.vertices.find((v) => v.id === lastId)?.position;
  if (!from) return null;
  // A typed target height stands in for length: with an angle to rise at and a height to
  // reach, the distance along the segment follows, which is the calculation the user would
  // otherwise be doing by hand.
  let lengthIn = s.lockedLengthIn;
  if (lengthIn === null && s.lockedHeightIn !== null && s.lockedAngleDeg !== null) {
    const rise = s.lockedHeightIn - from.z;
    const sin = Math.sin((s.lockedAngleDeg * Math.PI) / 180);
    if (Math.abs(sin) > 1e-6) lengthIn = Math.abs(rise / sin);
  }

  const fullyTyped = lengthIn !== null && s.lockedAngleDeg !== null;
  const cursor = s.drawCursor ?? from;
  if (!s.drawCursor && !fullyTyped) return null;
  return resolveNextPoint(s.drawPlane, from, cursor, { lengthIn, angleDeg: s.lockedAngleDeg });
}

/**
 * Adds an edge between the last two points of a chain and works out what it brought into
 * being — a face closed, a face divided, or nothing yet. The edge is kept either way.
 */
function absorbSegment(design: Design, from: string, to: string): { design: Design; refusal?: string } {
  const withEdge = addEdge(design, from, to);
  const outcome = faceFromNewEdge(withEdge, from, to, () => makeId('f'));
  return { design: outcome.design, refusal: outcome.refusal };
}

/**
 * Removes faces along with the holes, angle locks and base reference that depended on them.
 *
 * Their edges are deliberately left in place: deleting geometry leaves the wireframe
 * standing so the faces can be redrawn on the same lines (requirements §3, constraint 5).
 * Callers that mean to remove an edge as well do that explicitly.
 */
function removeFaces(design: Design, faceIds: Set<string>): Design {
  return {
    ...design,
    faces: design.faces.filter((f) => !faceIds.has(f.id)),
    holes: design.holes.filter((h) => !faceIds.has(h.faceId)),
    angleLocks: design.angleLocks.filter((l) => !faceIds.has(l.faceAId) && !faceIds.has(l.faceBId)),
    baseFaceId: design.baseFaceId && faceIds.has(design.baseFaceId) ? null : design.baseFaceId,
  };
}

/** Resets everything about a face-in-progress. */
const CLEARED_DRAW_STATE = {
  draftVertexIds: [] as string[],
  drawPlane: null,
  drawCursor: null,
  lockedLengthIn: null,
  lockedAngleDeg: null,
  lockedHeightIn: null,
} as const;

function commit(state: DesignStoreState, nextDesign: Design): Pick<DesignStoreState, 'design' | 'past' | 'future'> {
  return {
    design: nextDesign,
    past: [...state.past, { design: state.design }].slice(-100),
    future: [],
  };
}

export const useDesignStore = create<DesignStoreState>((set) => ({
  design: createEmptyDesign(),
  mode: 'sketch',

  selectedVertexId: null,
  selectedFaceId: null,
  selectedEdge: null,
  selectedEdgePair: null,
  selectedHoleId: null,

  openSketch: [],
  draftVertexIds: [],
  drawPlane: null,
  drawCursor: null,
  lockedLengthIn: null,
  lockedAngleDeg: null,
  lockedHeightIn: null,
  buildTool: 'select',
  draggingVertexId: null,
  draggingEdge: null,
  dragStartDesign: null,
  moveFreedom: null,
  moveWasLimited: false,
  frameNonce: 0,

  past: [],
  future: [],
  designIssues: [],
  designRepairs: [],
  actionError: null,

  setMode: (mode) => set({ mode }),

  selectVertex: (id) => set({ selectedVertexId: id, selectedEdgePair: null }),
  selectFace: (id) => set({ selectedFaceId: id, selectedEdgePair: null }),
  selectEdge: (edge) => set({ selectedEdge: edge }),
  selectEdgePair: (pair) => set({ selectedEdgePair: pair, selectedVertexId: null, selectedFaceId: null }),
  selectHole: (id) => set({ selectedHoleId: id }),

  addSketchPoint: (p) => set((s) => ({ openSketch: [...s.openSketch, p] })),
  undoSketchPoint: () => set((s) => ({ openSketch: s.openSketch.slice(0, -1) })),
  clearSketch: () => set({ openSketch: [] }),

  closeSketch: (label = 'Base') =>
    set((s) => {
      if (s.openSketch.length < 3) return {};
      const vertexIds = s.openSketch.map(() => makeId('v'));
      const newVertices = s.openSketch.map((position, i) => ({ id: vertexIds[i], position }));
      const face: Face = { id: makeId('f'), vertexIds, label };
      const nextDesign: Design = withFaceEdges({
        ...s.design,
        vertices: [...s.design.vertices, ...newVertices],
        faces: [...s.design.faces, face],
        baseFaceId: s.design.baseFaceId ?? face.id,
      });
      return { ...commit(s, nextDesign), openSketch: [], selectedFaceId: face.id };
    }),

  // Starts a fresh design from a regular polygon base — the callers confirm first when
  // there's existing geometry to discard.
  createBasePolygon: (sides, widthIn) =>
    set((s) => {
      const points = regularPolygonPoints(sides, widthIn);
      const vertexIds = points.map(() => makeId('v'));
      const face: Face = { id: makeId('f'), vertexIds, label: 'Base' };
      const nextDesign: Design = withFaceEdges({
        ...createEmptyDesign(s.design.basePlaneSizeIn),
        panelThicknessIn: s.design.panelThicknessIn,
        vertices: points.map((position, i) => ({ id: vertexIds[i], position })),
        faces: [face],
        baseFaceId: face.id,
      });
      return {
        ...commit(s, nextDesign),
        openSketch: [],
        draftVertexIds: [],
        frameNonce: s.frameNonce + 1,
        selectedFaceId: face.id,
        selectedVertexId: null,
        selectedEdge: null,
        selectedHoleId: null,
      };
    }),

  // Drawing begins on a plane chosen by the caller (which knows where the camera is).
  startDrawingAt: (vertexId, plane) =>
    set({
      draftVertexIds: [vertexId],
      drawPlane: plane,
      drawCursor: null,
      lockedLengthIn: null,
      lockedAngleDeg: null,
      lockedHeightIn: null,
    }),

  /** Starting in empty space: the point is real from the moment it's placed. */
  startChainAtPoint: (p, plane) =>
    set((s) => {
      const id = makeId('v');
      const nextDesign: Design = { ...s.design, vertices: [...s.design.vertices, { id, position: p }] };
      return {
        ...commit(s, nextDesign),
        draftVertexIds: [id],
        drawPlane: plane,
        drawCursor: null,
        lockedLengthIn: null,
        lockedAngleDeg: null,
        lockedHeightIn: null,
      };
    }),

  /**
   * Beginning or continuing a chain partway along an existing edge. The edge is split at
   * that point first, so the new vertex is genuinely on the line rather than merely near
   * it — which is the difference between geometry that closes and geometry that looks like
   * it should have.
   */
  chainThroughEdge: (a, b, at, plane) =>
    set((s) => {
      const t = parameterAlongEdge(s.design, a, b, at);
      const split = splitEdgeAt(s.design, a, b, t, () => makeId('v'));
      if (!split.ok) return { actionError: split.reason };

      const chain = s.draftVertexIds;
      if (chain.length === 0) {
        return {
          ...commit(s, split.design),
          draftVertexIds: [split.vertexId],
          drawPlane: plane,
          drawCursor: null,
          lockedLengthIn: null,
          lockedAngleDeg: null,
          lockedHeightIn: null,
          actionError: null,
        };
      }
      const joined = absorbSegment(split.design, chain[chain.length - 1], split.vertexId);
      const draftVertexIds = [...chain, split.vertexId];
      return {
        ...commit(s, joined.design),
        draftVertexIds,
        drawPlane: planeOfDraft(joined.design, draftVertexIds) ?? s.drawPlane,
        lockedLengthIn: null,
        lockedAngleDeg: null,
        lockedHeightIn: null,
        actionError: joined.refusal ?? null,
      };
    }),

  setDrawCursor: (p) => set({ drawCursor: p }),
  setLockedLength: (lengthIn) => set({ lockedLengthIn: lengthIn }),
  setLockedAngle: (angleDeg) => set({ lockedAngleDeg: angleDeg }),
  setLockedHeight: (heightIn) => set({ lockedHeightIn: heightIn }),

  /**
   * Places the pending point wherever the rubber band currently resolves to — from the
   * cursor, from typed length/angle/height, or a mix — and commits the segment to it.
   *
   * The edge is real immediately. That is the whole change: there is no half-drawn state
   * to lose, so a chain can be stopped at any point and what was drawn stays (§3).
   */
  commitPendingPoint: () =>
    set((s) => {
      const pending = pendingPointOf(s);
      if (!pending || s.draftVertexIds.length === 0) return {};
      const id = makeId('v');
      const withVertex: Design = {
        ...s.design,
        vertices: [...s.design.vertices, { id, position: pending }],
      };
      const previous = s.draftVertexIds[s.draftVertexIds.length - 1];
      const joined = absorbSegment(withVertex, previous, id);
      const draftVertexIds = [...s.draftVertexIds, id];
      return {
        ...commit(s, joined.design),
        draftVertexIds,
        // Three points fix the face's plane, so drawing switches onto it and every
        // later point lands coplanar — which is what keeps the face unfoldable.
        drawPlane: planeOfDraft(joined.design, draftVertexIds) ?? s.drawPlane,
        lockedLengthIn: null,
        lockedAngleDeg: null,
        lockedHeightIn: null,
        actionError: joined.refusal ?? null,
      };
    }),

  // Switching tools ends any chain in progress. Nothing is discarded — every segment was
  // committed as it was drawn, so there is no half-drawn state left to lose.
  setBuildTool: (tool) =>
    set((s) => (tool === s.buildTool ? {} : { buildTool: tool, ...CLEARED_DRAW_STATE })),

  frameView: () => set((s) => ({ frameNonce: s.frameNonce + 1 })),


  /**
   * Runs the chain into an existing point. If that closes a loop a face appears, and if it
   * crosses a face the face divides — but either way this is just another segment, which is
   * why there is no separate gesture for finishing a face any more.
   */
  extendChainTo: (vertexId) =>
    set((s) => {
      const chain = s.draftVertexIds;
      if (chain.length === 0) return {};
      const previous = chain[chain.length - 1];
      if (previous === vertexId) return {};
      if (hasEdge(s.design, previous, vertexId) && chain.includes(vertexId)) {
        // Already joined and already in this chain: nothing new to draw.
        return { draftVertexIds: [...chain, vertexId], lockedLengthIn: null, lockedAngleDeg: null, lockedHeightIn: null };
      }
      const joined = absorbSegment(s.design, previous, vertexId);
      const draftVertexIds = [...chain, vertexId];
      return {
        ...commit(s, joined.design),
        draftVertexIds,
        drawPlane: planeOfDraft(joined.design, draftVertexIds) ?? s.drawPlane,
        lockedLengthIn: null,
        lockedAngleDeg: null,
        lockedHeightIn: null,
        actionError: joined.refusal ?? null,
      };
    }),

  /** Stops drawing. Everything already drawn stays exactly where it is. */
  endChain: () => set({ ...CLEARED_DRAW_STATE }),

  pullUpFace: (faceId, heightIn) =>
    set((s) => {
      const face = getFace(s.design, faceId);
      const { design: extruded } = extrudeFace(s.design, face, heightIn, () => makeId('v'));
      return commit(s, withFaceEdges(extruded));
    }),

  /**
   * Moves a vertex as far toward `position` as constraint 9 permits.
   *
   * The drag is projected onto the motion every affected face allows, so faces are never
   * warped and then corrected — nothing the user didn't grab ever moves. A fully pinned
   * vertex simply doesn't budge, and `moveFreedom` carries the reason to the panel.
   */
  moveVertex: (id, position, opts) =>
    set((s) => {
      const target = s.design.vertices.find((v) => v.id === id);
      if (!target) return {};
      const move = constrainVertexMove(s.design, id, position);
      const shared = { moveFreedom: move.freedom, moveWasLimited: move.limitedByValidity };
      if (V.length(move.translation) === 0) return shared;

      const moved: Design = {
        ...s.design,
        vertices: s.design.vertices.map((v) =>
          v.id === id ? { ...v, position: V.add(v.position, move.translation) } : v,
        ),
      };
      // Angle locks run last: the spec is explicit that a locked angle is never silently
      // broken, so it outranks everything else when they disagree.
      const relaxed = reapplyAngleLocks(moved);
      return opts?.commit ? { ...commit(s, relaxed), ...shared } : { design: relaxed, ...shared };
    }),

  /**
   * Translates a whole edge, both ends together.
   *
   * Deliberately not two vertex moves: because the ends travel together the edge keeps its
   * length and direction, and a face holding both of them gives up one degree of freedom
   * instead of two. That is why an edge often moves where neither end could alone.
   */
  moveEdgeBy: (a, b, translation, opts) =>
    set((s) => {
      const move = constrainTranslation(s.design, [a, b], translation);
      const shared = { moveFreedom: move.freedom, moveWasLimited: move.limitedByValidity };
      if (V.length(move.translation) === 0) return shared;

      const moving = new Set([a, b]);
      const moved: Design = {
        ...s.design,
        vertices: s.design.vertices.map((v) =>
          moving.has(v.id) ? { ...v, position: V.add(v.position, move.translation) } : v,
        ),
      };
      const relaxed = reapplyAngleLocks(moved);
      return opts?.commit ? { ...commit(s, relaxed), ...shared } : { design: relaxed, ...shared };
    }),

  beginVertexDrag: (id) =>
    set((s) => ({
      draggingVertexId: id,
      dragStartDesign: s.design,
      moveFreedom: freedomForTranslation(s.design, [id]),
      moveWasLimited: false,
    })),

  beginEdgeDrag: (a, b) =>
    set((s) => ({
      draggingEdge: { a, b },
      dragStartDesign: s.design,
      moveFreedom: freedomForTranslation(s.design, [a, b]),
      moveWasLimited: false,
    })),

  endDrag: () =>
    set((s) => {
      const start = s.dragStartDesign;
      const moved = !!start && start !== s.design;
      return {
        draggingVertexId: null,
        draggingEdge: null,
        dragStartDesign: null,
        ...(moved ? { past: [...s.past, { design: start! }].slice(-100), future: [] } : {}),
      };
    }),

  refreshMoveFreedom: (ids) =>
    set((s) => ({
      moveFreedom: ids && ids.length > 0 ? freedomForTranslation(s.design, ids) : null,
      moveWasLimited: false,
    })),

  setVertexLocked: (id, locked) =>
    set((s) =>
      commit(s, {
        ...s.design,
        vertices: s.design.vertices.map((v) => (v.id === id ? { ...v, locked } : v)),
      }),
    ),

  setVerticesLocked: (ids, locked) =>
    set((s) => {
      const idSet = new Set(ids);
      return commit(s, {
        ...s.design,
        vertices: s.design.vertices.map((v) => (idSet.has(v.id) ? { ...v, locked } : v)),
      });
    }),

  /**
   * Typing an exact edge length still moves a vertex, so it answers to constraint 9 like any
   * other move: the target is worked out first, then constrained. On a pinned vertex the
   * typed value simply can't be honoured, and `moveFreedom` says what is holding it rather
   * than the number silently not taking.
   */
  setEdgeLength: (anchorVertexId, movingVertexId, lengthIn) =>
    set((s) => {
      const target = setEdgeLengthByMovingVertex(s.design, anchorVertexId, movingVertexId, lengthIn);
      const wanted = target.vertices.find((v) => v.id === movingVertexId);
      if (!wanted) return {};
      const move = constrainVertexMove(s.design, movingVertexId, wanted.position);
      const shared = { moveFreedom: move.freedom, moveWasLimited: move.limitedByValidity };
      if (V.length(move.translation) === 0) return shared;
      const moved: Design = {
        ...s.design,
        vertices: s.design.vertices.map((v) =>
          v.id === movingVertexId ? { ...v, position: V.add(v.position, move.translation) } : v,
        ),
      };
      return { ...commit(s, reapplyAngleLocks(moved)), ...shared };
    }),

  setInteriorAngle: (faceId, vertexId, angleDeg) =>
    set((s) => {
      const moved = setInteriorAngleAtVertex(s.design, faceId, vertexId, angleDeg);
      const relaxed = reapplyAngleLocks(moved);
      return commit(s, relaxed);
    }),

  lockDihedralAngle: (faceAId, faceBId, targetAngleDeg) =>
    set((s) => {
      const edge = findSharedEdge(s.design, faceAId, faceBId);
      if (!edge) return {};
      const solved = solveDihedralAngle(s.design, edge, faceBId, targetAngleDeg);
      const existing = s.design.angleLocks.find((l) => l.faceAId === faceAId && l.faceBId === faceBId);
      const locks: AngleLock[] = existing
        ? s.design.angleLocks.map((l) => (l.id === existing.id ? { ...l, targetAngleDeg } : l))
        : [...s.design.angleLocks, { id: makeId('lock'), faceAId, faceBId, targetAngleDeg }];
      const relaxed = reapplyAngleLocks({ ...solved, angleLocks: locks });
      return commit(s, relaxed);
    }),

  unlockDihedralAngle: (lockId) =>
    set((s) => commit(s, { ...s.design, angleLocks: s.design.angleLocks.filter((l) => l.id !== lockId) })),

  addHole: (faceId, u, v) =>
    set((s) => {
      const hole: Hole = { id: makeId('hole'), faceId, u, v, diameterIn: 0.5 };
      return commit(s, { ...s.design, holes: [...s.design.holes, hole] });
    }),

  updateHole: (id, u, v) =>
    set((s) => commit(s, { ...s.design, holes: s.design.holes.map((h) => (h.id === id ? { ...h, u, v } : h)) })),

  removeHole: (id) =>
    set((s) => commit(s, { ...s.design, holes: s.design.holes.filter((h) => h.id !== id) })),

  setPanelThickness: (inches) => set((s) => commit(s, { ...s.design, panelThicknessIn: inches })),

  setBasePlaneSize: (inches) =>
    set((s) => commit(s, { ...s.design, basePlaneSizeIn: clampBasePlaneSize(inches) })),

  setBaseFaceId: (id) => set((s) => commit(s, { ...s.design, baseFaceId: id })),

  renameFace: (id, label) =>
    set((s) => commit(s, { ...s.design, faces: s.design.faces.map((f) => (f.id === id ? { ...f, label } : f)) })),

  deleteFace: (id) =>
    set((s) => {
      const remainingFaces = s.design.faces.filter((f) => f.id !== id);
      const remainingHoles = s.design.holes.filter((h) => h.faceId !== id);
      const remainingLocks = s.design.angleLocks.filter((l) => l.faceAId !== id && l.faceBId !== id);
      const nextDesign: Design = {
        ...s.design,
        faces: remainingFaces,
        holes: remainingHoles,
        angleLocks: remainingLocks,
        baseFaceId: s.design.baseFaceId === id ? null : s.design.baseFaceId,
      };
      return { ...commit(s, nextDesign), selectedFaceId: null };
    }),

  /**
   * Removes a vertex, every edge touching it, and every face those edges formed
   * (requirements §3, constraints 4 and 5). A face can't simply lose a corner, so the
   * faces go with it; the other corners and the other edges of those faces stay, ready
   * to redraw on.
   */
  deleteVertex: (id) =>
    set((s) => {
      if (!s.design.vertices.some((v) => v.id === id)) return {};
      const doomedEdges = new Set(edgesTouchingVertex(s.design, id).map((e) => edgeKey(e.a, e.b)));
      // Equivalent to "faces using a doomed edge": a face containing the vertex meets it
      // along exactly two of its sides, both of which are incident edges.
      const touching = new Set(
        s.design.faces.filter((f) => f.vertexIds.includes(id)).map((f) => f.id),
      );
      const withoutFaces = removeEdgeKeys(removeFaces(s.design, touching), doomedEdges);
      const nextDesign: Design = {
        ...withoutFaces,
        vertices: withoutFaces.vertices.filter((v) => v.id !== id),
      };
      return {
        ...commit(s, nextDesign),
        selectedVertexId: null,
        selectedFaceId: null,
        selectedEdge: null,
        selectedEdgePair: null,
      };
    }),

  /**
   * Removes an edge and every face it helped form (requirements §3, constraint 5). Both
   * corners survive, as do the other edges of those faces — the scaffold stays up so the
   * geometry can be redrawn on the same lines.
   */
  deleteEdge: (aVertexId, bVertexId) =>
    set((s) => {
      const key = edgeKey(aVertexId, bVertexId);
      const stored = s.design.edges.some((e) => edgeKey(e.a, e.b) === key);
      const adjoining = new Set(
        s.design.faces.filter((f) => faceEdgeKeys(f).includes(key)).map((f) => f.id),
      );
      if (!stored && adjoining.size === 0) return {};
      const nextDesign = removeEdgeKeys(removeFaces(s.design, adjoining), new Set([key]));
      return {
        ...commit(s, nextDesign),
        selectedFaceId: null,
        selectedEdge: null,
        selectedEdgePair: null,
      };
    }),

  /**
   * Both splits refuse rather than approximate: a split that would pass outside a concave
   * face, or cross one of its edges, is a request the geometry can't honour, and quietly
   * doing something adjacent would be worse than saying so.
   */
  splitEdge: (aVertexId, bVertexId, t) =>
    set((s) => {
      const result = splitEdgeAt(s.design, aVertexId, bVertexId, t, () => makeId('v'));
      if (!result.ok) return { actionError: result.reason };
      return {
        ...commit(s, result.design),
        actionError: null,
        selectedVertexId: result.vertexId,
        selectedEdgePair: null,
      };
    }),

  splitFaceByCorners: (faceId, m, n) =>
    set((s) => {
      const result = splitFace(s.design, faceId, m, n, () => makeId('f'));
      if (!result.ok) return { actionError: result.reason };
      return {
        ...commit(s, result.design),
        actionError: null,
        selectedFaceId: result.faceIds[0],
        selectedVertexId: null,
        selectedEdgePair: null,
      };
    }),

  clearActionError: () => set({ actionError: null }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        design: previous.design,
        past: s.past.slice(0, -1),
        future: [{ design: s.design }, ...s.future],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0];
      return {
        design: next.design,
        past: [...s.past, { design: s.design }],
        future: s.future.slice(1),
      };
    }),

  /**
   * The single way a design enters the app, from a file or from localStorage. Everything
   * arriving here is untrusted: it may predate stored edges, or have been hand-edited into
   * a state the editing operations can't produce. Normalizing repairs what would otherwise
   * crash and reports the rest rather than silently reshaping the model (§3, constraint 8).
   */
  loadDesign: (design) =>
    set(() => {
      const { design: normalized, issues, repairs } = normalizeDesign(design);
      return {
        design: normalized,
        designIssues: issues,
        designRepairs: repairs,
        actionError: null,
        past: [],
        future: [],
        ...CLEARED_DRAW_STATE,
        selectedFaceId: null,
        selectedVertexId: null,
      };
    }),
  // A new design starts at the user's saved work-area default, not the built-in one.
  resetDesign: () =>
    set({
      design: createEmptyDesign(loadDefaultBasePlaneSize() ?? undefined),
      past: [],
      future: [],
      designIssues: [],
      designRepairs: [],
      actionError: null,
      ...CLEARED_DRAW_STATE,
      openSketch: [],
    }),

  dismissDesignIssues: () => set({ designIssues: [], designRepairs: [] }),

  /**
   * The offered repair for a design that arrived with warped faces. Explicit on purpose:
   * constraint 9 holds for anything built in this app, but a file predating that rule is
   * the user's geometry and doesn't get moved without them asking.
   */
  makeFacesPlanar: () =>
    set((s) => {
      const flattened = keepFacesPlanar(s.design, '');
      return {
        ...commit(s, flattened),
        designIssues: validateDesign(flattened),
      };
    }),
}));

export function allEdgesOf(design: Design) {
  return deriveEdges(design);
}

/**
 * Vertices no edge reaches (requirements §3, constraint 2). These are legal and are never
 * removed automatically — they are what deletion leaves behind to redraw on. Exposed so
 * the UI can point them out, not so anything can tidy them away.
 */
export function orphanVerticesOf(design: Design) {
  return orphanVertexIds(design);
}

export function faceIsPlanar(design: Design, face: Face) {
  return isFacePlanar(design, face);
}
