import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore } from '../designStore';
import {
  BASE_PLANE_DEFAULT_IN,
  BASE_PLANE_MAX_IN,
  BASE_PLANE_MIN_IN,
  clampBasePlaneSize,
  createEmptyDesign,
} from '../../geometry/types';
import type { Design } from '../../geometry/types';

function seedWall(): Design {
  return {
    ...createEmptyDesign(),
    vertices: [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 4, y: 0, z: 0 } },
      { id: 'c', position: { x: 4, y: 0, z: 3 } },
    ],
    faces: [{ id: 'wall', vertexIds: ['a', 'b', 'c'], label: 'Side 1' }],
  };
}

describe('clampBasePlaneSize', () => {
  it('holds the work area between its bounds', () => {
    expect(clampBasePlaneSize(24)).toBe(24);
    expect(clampBasePlaneSize(500)).toBe(BASE_PLANE_MAX_IN);
    expect(clampBasePlaneSize(0)).toBe(BASE_PLANE_MIN_IN);
    expect(clampBasePlaneSize(Number.NaN)).toBe(BASE_PLANE_DEFAULT_IN);
  });

  it('defaults a new design to 24in', () => {
    expect(createEmptyDesign().basePlaneSizeIn).toBe(24);
  });
});

describe('setBasePlaneSize', () => {
  beforeEach(() => useDesignStore.getState().loadDesign(seedWall()));

  it('never lets the work area exceed 96in', () => {
    useDesignStore.getState().setBasePlaneSize(240);
    expect(useDesignStore.getState().design.basePlaneSizeIn).toBe(BASE_PLANE_MAX_IN);
  });

  it('accepts a size within range', () => {
    useDesignStore.getState().setBasePlaneSize(36);
    expect(useDesignStore.getState().design.basePlaneSizeIn).toBe(36);
  });
});

describe('a chain commits as it is drawn', () => {
  const plane = {
    origin: { x: 0, y: 0, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: 1, z: 0 },
  };

  beforeEach(() => useDesignStore.getState().loadDesign(seedWall()));

  it('keeps the points it placed when the chain is stopped', () => {
    const store = useDesignStore.getState();
    store.startDrawingAt('a', plane);
    useDesignStore.getState().setDrawCursor({ x: 2, y: 0, z: 5 });
    useDesignStore.getState().commitPendingPoint();
    expect(useDesignStore.getState().design.vertices.length).toBe(4);

    // Stopping is not abandoning: the segment was real the moment it was drawn, which is
    // what allows a defining edge to be drawn exactly and left standing.
    useDesignStore.getState().endChain();
    expect(useDesignStore.getState().design.vertices.length).toBe(4);
    expect(useDesignStore.getState().draftVertexIds).toEqual([]);
  });

  it('keeps them across a tool switch too', () => {
    const store = useDesignStore.getState();
    store.setBuildTool('draw');
    store.startDrawingAt('a', plane);
    useDesignStore.getState().setDrawCursor({ x: 2, y: 0, z: 5 });
    useDesignStore.getState().commitPendingPoint();

    useDesignStore.getState().setBuildTool('select');
    expect(useDesignStore.getState().design.vertices.length).toBe(4);
  });

  it('commits an edge with every point, not just at the end', () => {
    const store = useDesignStore.getState();
    const edgesBefore = useDesignStore.getState().design.edges.length;
    store.startDrawingAt('a', plane);
    useDesignStore.getState().setDrawCursor({ x: 2, y: 0, z: 5 });
    useDesignStore.getState().commitPendingPoint();
    expect(useDesignStore.getState().design.edges.length).toBe(edgesBefore + 1);
  });

  it('raises a face on its own once the chain closes a loop', () => {
    const store = useDesignStore.getState();
    const facesBefore = useDesignStore.getState().design.faces.length;
    // a and c are already joined by the wall, so running a chain a -> new -> c encloses
    // a triangle without any "close the face" gesture.
    store.startDrawingAt('a', plane);
    useDesignStore.getState().setDrawCursor({ x: -3, y: 0, z: 2 });
    useDesignStore.getState().commitPendingPoint();
    useDesignStore.getState().extendChainTo('c');
    expect(useDesignStore.getState().design.faces.length).toBe(facesBefore + 1);
  });
});
