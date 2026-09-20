import { create } from 'zustand';
import type { AngleLock, Design, Face, Hole, Vec3 } from '../geometry/types';
import { createEmptyDesign } from '../geometry/types';
import { deriveEdges, findSharedEdge, getFace, isFacePlanar } from '../geometry/mesh';
import { setEdgeLengthByMovingVertex, setInteriorAngleAtVertex, extrudeFace } from '../geometry/edit';
import { solveDihedralAngle } from '../geometry/solver';
import { reapplyAngleLocks } from '../geometry/relax';

export type Mode = 'sketch' | 'build' | 'angles' | 'holes' | 'unfold';

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
  selectedHoleId: string | null;

  // Base polygon sketch draft (raw positions, not yet committed to the design)
  openSketch: Vec3[];

  // Face-by-face build draft (ordered vertex ids of the face being drawn)
  draftVertexIds: string[];
  // Height (Z) of the horizontal work plane new draft vertices are placed on when
  // clicking empty space in Build mode.
  workPlaneZ: number;

  // Undo/redo
  past: HistoryEntry[];
  future: HistoryEntry[];

  setMode: (mode: Mode) => void;

  selectVertex: (id: string | null) => void;
  selectFace: (id: string | null) => void;
  selectEdge: (edge: SelectedEdge | null) => void;
  selectHole: (id: string | null) => void;

  // Sketch mode
  addSketchPoint: (p: Vec3) => void;
  undoSketchPoint: () => void;
  closeSketch: (label?: string) => void;
  clearSketch: () => void;

  // Build mode
  startDraftAtVertex: (vertexId: string) => void;
  addDraftVertexById: (vertexId: string) => void;
  addDraftNewVertex: (p: Vec3) => void;
  closeDraftFace: (label?: string) => void;
  cancelDraft: () => void;
  pullUpFace: (faceId: string, heightIn: number) => void;
  setWorkPlaneZ: (z: number) => void;

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
  setBaseFaceId: (id: string | null) => void;
  renameFace: (id: string, label: string) => void;

  deleteFace: (id: string) => void;

  undo: () => void;
  redo: () => void;

  loadDesign: (design: Design) => void;
  resetDesign: () => void;
}

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
  selectedHoleId: null,

  openSketch: [],
  draftVertexIds: [],
  workPlaneZ: 0,

  past: [],
  future: [],

  setMode: (mode) => set({ mode }),

  selectVertex: (id) => set({ selectedVertexId: id }),
  selectFace: (id) => set({ selectedFaceId: id }),
  selectEdge: (edge) => set({ selectedEdge: edge }),
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
      const nextDesign: Design = {
        ...s.design,
        vertices: [...s.design.vertices, ...newVertices],
        faces: [...s.design.faces, face],
        baseFaceId: s.design.baseFaceId ?? face.id,
      };
      return { ...commit(s, nextDesign), openSketch: [], selectedFaceId: face.id };
    }),

  startDraftAtVertex: (vertexId) =>
    set((s) => {
      const vertex = s.design.vertices.find((v) => v.id === vertexId);
      return { draftVertexIds: [vertexId], workPlaneZ: vertex ? vertex.position.z : s.workPlaneZ };
    }),

  setWorkPlaneZ: (z) => set({ workPlaneZ: z }),

  addDraftVertexById: (vertexId) =>
    set((s) => {
      if (s.draftVertexIds.length === 0) return { draftVertexIds: [vertexId] };
      return { draftVertexIds: [...s.draftVertexIds, vertexId] };
    }),

  addDraftNewVertex: (p) =>
    set((s) => {
      const id = makeId('v');
      const nextDesign: Design = { ...s.design, vertices: [...s.design.vertices, { id, position: p }] };
      return { design: nextDesign, draftVertexIds: [...s.draftVertexIds, id] };
    }),

  closeDraftFace: (label) =>
    set((s) => {
      if (s.draftVertexIds.length < 3) return {};
      const face: Face = {
        id: makeId('f'),
        vertexIds: [...s.draftVertexIds],
        label: label ?? `Side ${s.design.faces.length}`,
      };
      const nextDesign: Design = { ...s.design, faces: [...s.design.faces, face] };
      return { ...commit(s, nextDesign), draftVertexIds: [], selectedFaceId: face.id };
    }),

  cancelDraft: () => set({ draftVertexIds: [] }),

  pullUpFace: (faceId, heightIn) =>
    set((s) => {
      const face = getFace(s.design, faceId);
      const { design: nextDesign } = extrudeFace(s.design, face, heightIn, () => makeId('v'));
      return commit(s, nextDesign);
    }),

  moveVertex: (id, position, opts) =>
    set((s) => {
      const target = s.design.vertices.find((v) => v.id === id);
      if (!target || target.locked) return {};
      const movedDesign: Design = {
        ...s.design,
        vertices: s.design.vertices.map((v) => (v.id === id ? { ...v, position } : v)),
      };
      const relaxed = reapplyAngleLocks(movedDesign);
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
      const relaxed = reapplyAngleLocks(moved);
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

  loadDesign: (design) => set({ design, past: [], future: [], selectedFaceId: null, selectedVertexId: null }),
  resetDesign: () => set({ design: createEmptyDesign(), past: [], future: [], openSketch: [], draftVertexIds: [] }),
}));

export function allEdgesOf(design: Design) {
  return deriveEdges(design);
}

export function faceIsPlanar(design: Design, face: Face) {
  return isFacePlanar(design, face);
}
