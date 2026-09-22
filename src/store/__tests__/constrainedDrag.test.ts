import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore } from '../designStore';
import { createEmptyDesign } from '../../geometry/types';
import type { Design } from '../../geometry/types';
import { validateDesign } from '../../geometry/validate';

const state = () => useDesignStore.getState();
const posOf = (id: string) => state().design.vertices.find((v) => v.id === id)!.position;

/** A square base with one vertical wall on the b0-b1 edge. */
function seed(): Design {
  return {
    ...createEmptyDesign(),
    vertices: [
      { id: 'b0', position: { x: 0, y: 0, z: 0 } },
      { id: 'b1', position: { x: 4, y: 0, z: 0 } },
      { id: 'b2', position: { x: 4, y: 4, z: 0 } },
      { id: 'b3', position: { x: 0, y: 4, z: 0 } },
      { id: 't0', position: { x: 0, y: 0, z: 3 } },
      { id: 't1', position: { x: 4, y: 0, z: 3 } },
    ],
    faces: [
      { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
      { id: 'wall', vertexIds: ['b0', 'b1', 't1', 't0'], label: 'Wall' },
    ],
    holes: [],
    angleLocks: [],
    baseFaceId: 'base',
  };
}

describe('moveVertex is constrained rather than corrected', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('drops the part of a drag that would warp a face', () => {
    state().moveVertex('b0', { x: -2, y: 1, z: 1 }, { commit: true });
    const p = posOf('b0');
    expect(p.x).toBeCloseTo(-2, 9); // allowed
    expect(p.y).toBeCloseTo(0, 9); // held by the wall
    expect(p.z).toBeCloseTo(0, 9); // held by the base
  });

  it('never moves a vertex the user did not grab', () => {
    const before = state().design.vertices.map((v) => ({ ...v.position }));
    state().moveVertex('b0', { x: -2, y: 3, z: 3 }, { commit: true });
    const after = state().design.vertices;
    for (let i = 0; i < before.length; i++) {
      if (after[i].id === 'b0') continue;
      expect(after[i].position).toEqual(before[i]);
    }
  });

  it('leaves the model valid under every constraint', () => {
    state().moveVertex('b0', { x: -3, y: 2, z: 2 }, { commit: true });
    expect(validateDesign(state().design)).toEqual([]);
  });

  it('reports what is holding the vertex', () => {
    state().moveVertex('b0', { x: 0, y: 0, z: 5 }, { commit: true });
    const freedom = state().moveFreedom!;
    expect(freedom.dof).toBe(1);
    expect(freedom.holdingFaceLabels.sort()).toEqual(['Base', 'Wall']);
  });
});

describe('moveEdgeBy moves both ends together', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('translates both ends by the same amount', () => {
    state().moveEdgeBy('b0', 'b1', { x: 0, y: 0, z: 1.5 }, { commit: true });
    expect(posOf('b0')).toEqual({ x: 0, y: 0, z: 1.5 });
    expect(posOf('b1')).toEqual({ x: 4, y: 0, z: 1.5 });
  });

  it('goes where neither end could have gone alone', () => {
    // Straight up is refused for the corner...
    state().moveVertex('b0', { x: 0, y: 0, z: 1.5 }, { commit: true });
    expect(posOf('b0').z).toBeCloseTo(0, 9);
    // ...but allowed for the edge, because both quads simply tilt.
    state().moveEdgeBy('b0', 'b1', { x: 0, y: 0, z: 1.5 }, { commit: true });
    expect(posOf('b0').z).toBeCloseTo(1.5, 9);
  });

  it('keeps every affected face flat', () => {
    state().moveEdgeBy('b0', 'b1', { x: 0.5, y: -1, z: 1 }, { commit: true });
    expect(validateDesign(state().design).filter((i) => i.constraint === 9)).toEqual([]);
  });

  it('leaves the far corners exactly where they were', () => {
    state().moveEdgeBy('b0', 'b1', { x: 0, y: 0, z: 2 }, { commit: true });
    expect(posOf('b2')).toEqual({ x: 4, y: 4, z: 0 });
    expect(posOf('b3')).toEqual({ x: 0, y: 4, z: 0 });
  });
});

describe('a drag is one undo step, taken from where it started', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('restores the pre-drag position in a single undo', () => {
    const before = { ...posOf('b0') };

    state().beginVertexDrag('b0');
    // A drag is many uncommitted moves as the pointer travels.
    state().moveVertex('b0', { x: -1, y: 0, z: 0 });
    state().moveVertex('b0', { x: -2, y: 0, z: 0 });
    state().moveVertex('b0', { x: -3, y: 0, z: 0 });
    state().endDrag();
    expect(posOf('b0').x).toBeCloseTo(-3, 9);

    state().undo();
    expect(posOf('b0')).toEqual(before);
  });

  it('records nothing when a drag moved nothing', () => {
    const history = state().past.length;
    state().beginVertexDrag('b2');
    state().endDrag();
    expect(state().past.length).toBe(history);
  });

  it('does the same for an edge drag', () => {
    const before = { ...posOf('b1') };
    state().beginEdgeDrag('b0', 'b1');
    state().moveEdgeBy('b0', 'b1', { x: 0, y: 0, z: 1 });
    state().moveEdgeBy('b0', 'b1', { x: 0, y: 0, z: 1 });
    state().endDrag();
    expect(posOf('b1').z).toBeCloseTo(2, 9);

    state().undo();
    expect(posOf('b1')).toEqual(before);
  });

  it('knows the freedom as soon as the drag begins, before any movement', () => {
    state().beginVertexDrag('b0');
    expect(state().moveFreedom?.dof).toBe(1);
  });
});

describe('typing an exact edge length answers to the same constraints', () => {
  beforeEach(() => state().loadDesign(seed()));

  it('honours a length the constraints allow', () => {
    state().setEdgeLength('b1', 'b0', 6);
    // b0 may slide along x, so lengthening b1-b0 just moves it further out.
    expect(posOf('b0').x).toBeCloseTo(-2, 6);
    expect(posOf('b0').y).toBeCloseTo(0, 9);
    expect(posOf('b0').z).toBeCloseTo(0, 9);
    expect(validateDesign(state().design)).toEqual([]);
  });
});
