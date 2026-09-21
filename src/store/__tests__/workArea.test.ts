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

describe('abandoning a half-drawn face', () => {
  beforeEach(() => useDesignStore.getState().loadDesign(seedWall()));

  it('removes the points it placed instead of stranding them in the model', () => {
    const store = useDesignStore.getState();
    store.startDrawingAt('a', {
      origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    });
    // A stray click a long way out — exactly what used to inflate every handle.
    useDesignStore.getState().setDrawCursor({ x: 900, y: 0, z: 40 });
    useDesignStore.getState().commitPendingPoint();
    expect(useDesignStore.getState().design.vertices.length).toBe(4);

    useDesignStore.getState().cancelDraft();
    expect(useDesignStore.getState().design.vertices.length).toBe(3);
    expect(useDesignStore.getState().design.vertices.some((v) => v.position.x === 900)).toBe(false);
  });

  it('cleans up the same way when the tool is switched mid-draw', () => {
    const store = useDesignStore.getState();
    store.setBuildTool('draw');
    store.startDrawingAt('a', {
      origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    });
    useDesignStore.getState().setDrawCursor({ x: 2, y: 0, z: 5 });
    useDesignStore.getState().commitPendingPoint();
    expect(useDesignStore.getState().design.vertices.length).toBe(4);

    useDesignStore.getState().setBuildTool('select');
    expect(useDesignStore.getState().design.vertices.length).toBe(3);
  });

  it('keeps the points once they belong to a finished face', () => {
    const store = useDesignStore.getState();
    store.startDrawingAt('a', {
      origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 1, z: 0 },
    });
    for (const z of [4, 6]) {
      useDesignStore.getState().setDrawCursor({ x: 2, y: 0, z });
      useDesignStore.getState().commitPendingPoint();
    }
    useDesignStore.getState().closeDraftFace();
    expect(useDesignStore.getState().design.faces.length).toBe(2);
    expect(useDesignStore.getState().design.vertices.length).toBe(5);
  });
});
