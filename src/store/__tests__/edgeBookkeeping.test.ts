import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore } from '../designStore';
import { createEmptyDesign, edgeKey } from '../../geometry/types';
import type { Design } from '../../geometry/types';
import { isStructurallySound } from '../../geometry/normalize';
import { hasEdge, orphanVertexIds } from '../../geometry/edges';

const state = () => useDesignStore.getState();
const keys = (d: Design) => d.edges.map((e) => edgeKey(e.a, e.b)).sort();

/** Base plus one wall, sharing the b1-b2 edge. */
function seed(): Design {
  return {
    ...createEmptyDesign(),
    vertices: [
      { id: 'b0', position: { x: 0, y: 0, z: 0 } },
      { id: 'b1', position: { x: 4, y: 0, z: 0 } },
      { id: 'b2', position: { x: 4, y: 4, z: 0 } },
      { id: 'b3', position: { x: 0, y: 4, z: 0 } },
      { id: 't1', position: { x: 4, y: 0, z: 3 } },
      { id: 't2', position: { x: 4, y: 4, z: 3 } },
    ],
    faces: [
      { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
      { id: 'wall', vertexIds: ['b1', 'b2', 't2', 't1'], label: 'Wall' },
    ],
    holes: [],
    angleLocks: [],
    baseFaceId: 'base',
  };
}

describe('loading keeps the edge set in step', () => {
  it('migrates a design that stored no edges', () => {
    state().loadDesign(seed());
    const { design, designRepairs } = state();
    expect(design.edges.length).toBe(7); // 4 base + 4 wall, minus the shared one
    expect(isStructurallySound(design)).toBe(true);
    expect(designRepairs.join(' ')).toMatch(/predates edges/);
  });

  it('reports nothing for a design that already has its edges', () => {
    state().loadDesign(seed());
    const migrated = state().design;
    state().loadDesign(migrated);
    expect(state().designRepairs).toEqual([]);
    expect(state().designIssues).toEqual([]);
  });
});

describe('face-creating operations back their loops with edges', () => {
  beforeEach(() => state().loadDesign(createEmptyDesign()));

  it('closing a sketch creates the polygon edges', () => {
    for (const p of [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 3, z: 0 },
    ]) {
      state().addSketchPoint(p);
    }
    state().closeSketch();
    expect(state().design.edges.length).toBe(3);
    expect(isStructurallySound(state().design)).toBe(true);
  });

  it('a preset base polygon arrives with its edges', () => {
    state().createBasePolygon(6, 12);
    expect(state().design.edges.length).toBe(6);
    expect(isStructurallySound(state().design)).toBe(true);
  });

  it('pulling up a face edges every new side', () => {
    state().createBasePolygon(4, 10);
    const baseId = state().design.baseFaceId!;
    state().pullUpFace(baseId, 5);
    const { design } = state();
    // A box: 4 base + 4 top + 4 verticals.
    expect(design.edges.length).toBe(12);
    expect(design.faces.length).toBe(6);
    expect(isStructurallySound(design)).toBe(true);
  });
});

describe('deleteVertex (constraint 4)', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('removes every edge touching the vertex', () => {
    state().deleteVertex('b1');
    const { design } = state();
    expect(hasEdge(design, 'b0', 'b1')).toBe(false);
    expect(hasEdge(design, 'b1', 'b2')).toBe(false);
    expect(hasEdge(design, 'b1', 't1')).toBe(false);
  });

  it('keeps the other edges of the faces it removed, as scaffold', () => {
    state().deleteVertex('b1'); // takes base and wall
    const { design } = state();
    expect(hasEdge(design, 'b2', 'b3')).toBe(true);
    expect(hasEdge(design, 'b3', 'b0')).toBe(true);
    expect(hasEdge(design, 't1', 't2')).toBe(true);
    expect(design.faces).toEqual([]);
  });

  it('leaves the design structurally sound', () => {
    state().deleteVertex('t1');
    expect(isStructurallySound(state().design)).toBe(true);
  });
});

describe('deleteEdge (constraint 5)', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('removes the edge itself, not just the faces along it', () => {
    state().deleteEdge('b1', 'b2');
    expect(hasEdge(state().design, 'b1', 'b2')).toBe(false);
  });

  it('keeps both corners and every other edge', () => {
    const before = keys(state().design);
    state().deleteEdge('b1', 'b2');
    const { design } = state();
    expect(design.vertices.length).toBe(6);
    expect(keys(design)).toEqual(before.filter((k) => k !== edgeKey('b1', 'b2')));
  });

  it('removes a standalone edge that belongs to no face', () => {
    state().deleteEdge('b0', 'b1'); // base only
    expect(state().design.faces.map((f) => f.id)).toEqual(['wall']);
    // b0 is now reachable by one edge; delete that too and it is an orphan.
    state().deleteEdge('b3', 'b0');
    expect(orphanVertexIds(state().design)).toContain('b0');
    expect(state().design.vertices.some((v) => v.id === 'b0')).toBe(true);
  });

  it('is undoable, edges included', () => {
    const before = keys(state().design);
    state().deleteEdge('b1', 'b2');
    state().undo();
    expect(keys(state().design)).toEqual(before);
  });
});
