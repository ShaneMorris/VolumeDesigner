import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore } from '../designStore';
import { createEmptyDesign } from '../../geometry/types';
import type { Design } from '../../geometry/types';

/**
 * A base with two walls on adjacent edges. The walls meet along b2-t2, while b1-b2
 * belongs to the base and one wall only — enough to tell "faces touching a vertex" apart
 * from "faces along one edge".
 */
function seedModel(): Design {
  return {
    ...createEmptyDesign(),
    vertices: [
      { id: 'b0', position: { x: 0, y: 0, z: 0 } },
      { id: 'b1', position: { x: 4, y: 0, z: 0 } },
      { id: 'b2', position: { x: 4, y: 4, z: 0 } },
      { id: 'b3', position: { x: 0, y: 4, z: 0 } },
      { id: 't1', position: { x: 4, y: 0, z: 3 } },
      { id: 't2', position: { x: 4, y: 4, z: 3 } },
      { id: 't3', position: { x: 0, y: 4, z: 3 } },
    ],
    faces: [
      { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
      { id: 'w1', vertexIds: ['b1', 'b2', 't2', 't1'], label: 'Side 1' },
      { id: 'w2', vertexIds: ['b2', 'b3', 't3', 't2'], label: 'Side 2' },
    ],
    holes: [{ id: 'h1', faceId: 'w1', u: 1, v: 1, diameterIn: 0.5 }],
    angleLocks: [{ id: 'lock1', faceAId: 'base', faceBId: 'w1', targetAngleDeg: 90 }],
    baseFaceId: 'base',
  };
}

const state = () => useDesignStore.getState();

describe('deleteVertex', () => {
  beforeEach(() => state().loadDesign(seedModel()));

  it('removes the vertex and every face that used it', () => {
    state().deleteVertex('b1'); // a corner of the base and of w1
    const { design } = state();
    expect(design.vertices.some((v) => v.id === 'b1')).toBe(false);
    expect(design.faces.map((f) => f.id)).toEqual(['w2']);
  });

  it('leaves faces that never touched it alone', () => {
    state().deleteVertex('t1'); // only w1 uses t1
    const { design } = state();
    expect(design.faces.map((f) => f.id).sort()).toEqual(['base', 'w2']);
    expect(design.vertices.some((v) => v.id === 't1')).toBe(false);
  });

  it('keeps the other corners of the removed faces, ready to redraw on', () => {
    state().deleteVertex('t1'); // removes w1, whose other corners are b1, b2 and t2
    const { design } = state();
    expect(design.vertices.map((v) => v.id).sort()).toEqual(['b0', 'b1', 'b2', 'b3', 't2', 't3']);
  });

  it('clears holes and angle locks belonging to the removed faces', () => {
    state().deleteVertex('t1'); // takes w1, its hole and its angle lock
    const { design } = state();
    expect(design.holes.length).toBe(0);
    expect(design.angleLocks.length).toBe(0);
  });

  it('drops the base reference when the base face is removed', () => {
    state().deleteVertex('b0'); // only the base uses b0
    expect(state().design.baseFaceId).toBeNull();
  });

  it('is undoable', () => {
    const before = state().design.faces.length;
    state().deleteVertex('b1');
    expect(state().design.faces.length).toBeLessThan(before);
    state().undo();
    expect(state().design.faces.length).toBe(before);
    expect(state().design.vertices.some((v) => v.id === 'b1')).toBe(true);
  });

  it('ignores an unknown vertex', () => {
    const before = state().design;
    state().deleteVertex('nope');
    expect(state().design).toBe(before);
  });
});

describe('deleteEdge', () => {
  beforeEach(() => state().loadDesign(seedModel()));

  it('removes the faces along that edge but keeps both corners', () => {
    state().deleteEdge('b1', 'b2'); // shared by base and w1
    const { design } = state();
    expect(design.faces.map((f) => f.id)).toEqual(['w2']);
    expect(design.vertices.some((v) => v.id === 'b1')).toBe(true);
    expect(design.vertices.some((v) => v.id === 'b2')).toBe(true);
  });

  it('keeps every vertex, so the faces can be redrawn on the same points', () => {
    const idsBefore = state().design.vertices.map((v) => v.id).sort();
    state().deleteEdge('b1', 'b2');
    expect(state().design.vertices.map((v) => v.id).sort()).toEqual(idsBefore);
  });

  it('works regardless of the order the two corners are given in', () => {
    state().deleteEdge('b2', 'b1');
    expect(state().design.faces.map((f) => f.id)).toEqual(['w2']);
  });

  it('clears holes and locks of the faces it removes', () => {
    state().deleteEdge('b1', 'b2');
    const { design } = state();
    expect(design.holes.length).toBe(0);
    expect(design.angleLocks.length).toBe(0);
  });

  it('does nothing when no face uses that pair as an edge', () => {
    const before = state().design;
    state().deleteEdge('b0', 'b2'); // a diagonal, not an edge of any face
    expect(state().design).toBe(before);
  });
});

describe('nothing drawn is ever swept away', () => {
  beforeEach(() => state().loadDesign(seedModel()));

  it('does not sweep away corners left behind by deleteEdge', () => {
    state().deleteEdge('b1', 'b2');
    const kept = state().design.vertices.length;

    // Switching tools used to prune every vertex no face referenced — which is exactly
    // the set deleteEdge deliberately preserves.
    state().setBuildTool('draw');
    state().setBuildTool('select');
    expect(state().design.vertices.length).toBe(kept);
  });

  it('keeps what a chain drew when the chain is stopped', () => {
    state().setBuildTool('draw');
    state().startDrawingAt('b0', {
      origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    });
    state().setDrawCursor({ x: 2, y: 0, z: 2 });
    state().commitPendingPoint();
    const during = state().design.vertices.length;

    // Every segment is committed as it's drawn, so stopping is not abandoning: the whole
    // point is that a defining edge can be drawn and left standing.
    state().endChain();
    expect(state().design.vertices.length).toBe(during);
  });
});
