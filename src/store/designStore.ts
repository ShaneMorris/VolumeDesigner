import { create } from 'zustand';
import type { AngleLock, Design, Face, Hole, Vec3 } from '../geometry/types';
import { clampBasePlaneSize, createEmptyDesign, edgeKey } from '../geometry/types';
import { deriveEdges, faceEdgeKeys, findSharedEdge, getFace, isFacePlanar } from '../geometry/mesh';
import { edgesTouchingVertex, orphanVertexIds, removeEdgeKeys, withFaceEdges } from '../geometry/edges';
import { normalizeDesign, type RawDesign } from '../geometry/normalize';
import { splitEdgeAt, splitFace } from '../geometry/split';
import { validateDesign, type DesignIssue } from '../geometry/validate';
import { setEdgeLengthByMovingVertex, setInteriorAngleAtVertex, extrudeFace } from '../geometry/edit';
import { solveDihedralAngle } from '../geometry/solver';
import { reapplyAngleLocks } from '../geometry/relax';
import { regularPolygonPoints } from '../geometry/polygons';
import { planeThroughPoints, resolveNextPoint, type DrawPlane } from '../geometry/drawPlane';
import { keepFacesPlanar } from '../geometry/planarize';
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

  // Face-by-face build draft (ordered vertex ids of the face being drawn)
  draftVertexIds: string[];
  /** The plane the face in progress is being drawn on; null when not drawing. */
  drawPlane: DrawPlane | null;
  /** Live cursor position on the draw plane, driving the rubber-band segment. */
  drawCursor: Vec3 | null;
  /** Typed-in constraints for the pending point; null means "follow the cursor". */
  lockedLengthIn: number | null;
  lockedAngleDeg: number | null;
  /** Points this draft created, so abandoning it removes exactly those. */
  draftCreatedVertexIds: string[];
  buildTool: BuildTool;
  /** Vertex currently being click-dragged with the Move tool, if any. */
  draggingVertexId: string | null;
  /** Bumped to ask the viewport to re-frame the camera around the model. */
  frameNonce: number;
  /** Whether moving a corner auto-adjusts a quad's opposite corner to keep it flat. */
  keepFacesFlat: boolean;
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
  addDraftVertexById: (vertexId: string) => void;
  addDraftNewVertex: (p: Vec3) => void;
  closeDraftFace: (label?: string) => void;
  cancelDraft: () => void;
  pullUpFace: (faceId: string, heightIn: number) => void;
  startDrawingAt: (vertexId: string, plane: DrawPlane) => void;
  setDrawCursor: (p: Vec3 | null) => void;
  setLockedLength: (lengthIn: number | null) => void;
  setLockedAngle: (angleDeg: number | null) => void;
  commitPendingPoint: () => void;
  setBuildTool: (tool: BuildTool) => void;
  setDraggingVertexId: (id: string | null) => void;
  frameView: () => void;
  setKeepFacesFlat: (keep: boolean) => void;

  moveVertex: (id: string, position: Vec3, opts?: { commit?: boolean }) => void;
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
  // With both length and angle typed in, the point is fully determined without a cursor.
  const cursor = s.drawCursor ?? from;
  if (!s.drawCursor && (s.lockedLengthIn === null || s.lockedAngleDeg === null)) return null;
  return resolveNextPoint(s.drawPlane, from, cursor, {
    lengthIn: s.lockedLengthIn,
    angleDeg: s.lockedAngleDeg,
  });
}

/**
 * Drops the points a half-drawn face created, when that face is abandoned. Points are
 * added to the design as they're placed, so without this they'd be stranded in the model.
 *
 * Only the draft's own creations are removed, never every unused vertex: deleting an edge
 * deliberately leaves its corners behind so the faces can be redrawn on them, and a blunt
 * "remove anything no face uses" sweep would wipe exactly those on the next tool switch.
 */
function discardDraftVertices(design: Design, draftCreatedVertexIds: string[]): Design {
  if (draftCreatedVertexIds.length === 0) return design;
  const used = new Set<string>();
  for (const face of design.faces) for (const id of face.vertexIds) used.add(id);
  const doomed = new Set(draftCreatedVertexIds.filter((id) => !used.has(id)));
  if (doomed.size === 0) return design;
  return { ...design, vertices: design.vertices.filter((v) => !doomed.has(v.id)) };
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
  draftCreatedVertexIds: [] as string[],
  drawPlane: null,
  drawCursor: null,
  lockedLengthIn: null,
  lockedAngleDeg: null,
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
  draftCreatedVertexIds: [],
  buildTool: 'select',
  draggingVertexId: null,
  frameNonce: 0,
  keepFacesFlat: true,

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
    }),

  setDrawCursor: (p) => set({ drawCursor: p }),
  setLockedLength: (lengthIn) => set({ lockedLengthIn: lengthIn }),
  setLockedAngle: (angleDeg) => set({ lockedAngleDeg: angleDeg }),

  /**
   * Places the pending point wherever the rubber band currently resolves to — from the
   * cursor, from typed length/angle, or a mix. Locks are released afterward so the next
   * segment starts free rather than silently inheriting the last one's constraints.
   */
  commitPendingPoint: () =>
    set((s) => {
      const pending = pendingPointOf(s);
      if (!pending) return {};
      const id = makeId('v');
      const nextDesign: Design = {
        ...s.design,
        vertices: [...s.design.vertices, { id, position: pending }],
      };
      const draftVertexIds = [...s.draftVertexIds, id];
      return {
        design: nextDesign,
        draftVertexIds,
        draftCreatedVertexIds: [...s.draftCreatedVertexIds, id],
        // Three points fix the face's plane, so drawing switches onto it and every
        // later point lands coplanar — which is what keeps the face unfoldable.
        drawPlane: planeOfDraft(nextDesign, draftVertexIds) ?? s.drawPlane,
        lockedLengthIn: null,
        lockedAngleDeg: null,
      };
    }),

  // Switching tools abandons any half-drawn face, so the draft can't be left dangling
  // in a tool that has no way to finish it.
  setBuildTool: (tool) =>
    set((s) =>
      tool === s.buildTool
        ? {}
        : {
            buildTool: tool,
            ...CLEARED_DRAW_STATE,
            design: discardDraftVertices(s.design, s.draftCreatedVertexIds),
          },
    ),

  setDraggingVertexId: (id) => set({ draggingVertexId: id }),

  frameView: () => set((s) => ({ frameNonce: s.frameNonce + 1 })),

  setKeepFacesFlat: (keep) => set({ keepFacesFlat: keep }),

  addDraftVertexById: (vertexId) =>
    set((s) => {
      if (s.draftVertexIds.includes(vertexId)) return {};
      const draftVertexIds = [...s.draftVertexIds, vertexId];
      return {
        draftVertexIds,
        drawPlane: planeOfDraft(s.design, draftVertexIds) ?? s.drawPlane,
        lockedLengthIn: null,
        lockedAngleDeg: null,
      };
    }),

  addDraftNewVertex: (p) =>
    set((s) => {
      const id = makeId('v');
      const nextDesign: Design = { ...s.design, vertices: [...s.design.vertices, { id, position: p }] };
      return {
        design: nextDesign,
        draftVertexIds: [...s.draftVertexIds, id],
        draftCreatedVertexIds: [...s.draftCreatedVertexIds, id],
      };
    }),

  closeDraftFace: (label) =>
    set((s) => {
      if (s.draftVertexIds.length < 3) return {};
      const face: Face = {
        id: makeId('f'),
        vertexIds: [...s.draftVertexIds],
        label: label ?? `Side ${s.design.faces.length}`,
      };
      const nextDesign = withFaceEdges({ ...s.design, faces: [...s.design.faces, face] });
      return { ...commit(s, nextDesign), ...CLEARED_DRAW_STATE, selectedFaceId: face.id };
    }),

  cancelDraft: () =>
    set((s) => ({
      ...CLEARED_DRAW_STATE,
      design: discardDraftVertices(s.design, s.draftCreatedVertexIds),
    })),

  pullUpFace: (faceId, heightIn) =>
    set((s) => {
      const face = getFace(s.design, faceId);
      const { design: extruded } = extrudeFace(s.design, face, heightIn, () => makeId('v'));
      return commit(s, withFaceEdges(extruded));
    }),

  moveVertex: (id, position, opts) =>
    set((s) => {
      const target = s.design.vertices.find((v) => v.id === id);
      if (!target || target.locked) return {};
      const movedDesign: Design = {
        ...s.design,
        vertices: s.design.vertices.map((v) => (v.id === id ? { ...v, position } : v)),
      };
      const flattened = s.keepFacesFlat ? keepFacesPlanar(movedDesign, id) : movedDesign;
      // Angle locks run last: the spec is explicit that a locked angle is never
      // silently broken, so it outranks the flatness correction when they disagree.
      const relaxed = reapplyAngleLocks(flattened);
      if (opts?.commit) {
        return commit(s, relaxed);
      }
      return { design: relaxed };
    }),

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

  setEdgeLength: (anchorVertexId, movingVertexId, lengthIn) =>
    set((s) => {
      const moved = setEdgeLengthByMovingVertex(s.design, anchorVertexId, movingVertexId, lengthIn);
      const flattened = s.keepFacesFlat ? keepFacesPlanar(moved, movingVertexId) : moved;
      const relaxed = reapplyAngleLocks(flattened);
      return commit(s, relaxed);
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
