import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore } from '../designStore';
import { createEmptyDesign } from '../../geometry/types';

function seedTriangle() {
  useDesignStore.getState().loadDesign({
    ...createEmptyDesign(),
    vertices: [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 1, y: 0, z: 0 } },
      { id: 'c', position: { x: 0, y: 1, z: 0 } },
    ],
    faces: [{ id: 'tri', vertexIds: ['a', 'b', 'c'], label: 'Base' }],
    baseFaceId: 'tri',
  });
}

describe('vertex locking', () => {
  beforeEach(() => seedTriangle());

  it('setVertexLocked marks a single vertex locked', () => {
    useDesignStore.getState().setVertexLocked('a', true);
    const a = useDesignStore.getState().design.vertices.find((v) => v.id === 'a');
    expect(a?.locked).toBe(true);
  });

  it('moveVertex is a no-op on a locked vertex', () => {
    useDesignStore.getState().setVertexLocked('a', true);
    useDesignStore.getState().moveVertex('a', { x: 5, y: 5, z: 5 }, { commit: true });
    const a = useDesignStore.getState().design.vertices.find((v) => v.id === 'a');
    expect(a?.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('moveVertex still moves an unlocked vertex', () => {
    useDesignStore.getState().moveVertex('b', { x: 9, y: 9, z: 9 }, { commit: true });
    const b = useDesignStore.getState().design.vertices.find((v) => v.id === 'b');
    expect(b?.position).toEqual({ x: 9, y: 9, z: 9 });
  });

  it('setVerticesLocked toggles a whole set at once', () => {
    useDesignStore.getState().setVerticesLocked(['a', 'b', 'c'], true);
    const allLocked = useDesignStore.getState().design.vertices.every((v) => v.locked);
    expect(allLocked).toBe(true);

    useDesignStore.getState().setVerticesLocked(['a', 'b', 'c'], false);
    const noneLocked = useDesignStore.getState().design.vertices.every((v) => !v.locked);
    expect(noneLocked).toBe(true);
  });
});
