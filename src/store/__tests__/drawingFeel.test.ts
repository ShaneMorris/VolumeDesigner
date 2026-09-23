import { beforeEach, describe, expect, it } from 'vitest';
import { useDesignStore, resolvePendingPoint } from '../designStore';
import { createEmptyDesign } from '../../geometry/types';
import type { Design, Vec3 } from '../../geometry/types';
import { orphanVertexIds } from '../../geometry/edges';

/**
 * The three things that made manual face-drawing feel wrong in use.
 *
 * None of them were geometry errors, which is why the existing suite was green throughout:
 * they were about where a point lands, how far a drag carries, and what gets left behind.
 */

const state = () => useDesignStore.getState();
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A vertical plane through the origin, facing along -Y. */
const plane = {
  origin: at(0, 0, 0),
  u: at(1, 0, 0),
  v: at(0, 0, 1),
  normal: at(0, 1, 0),
};

/**
 * A triangular wall standing in the XZ plane. Its a-c edge runs from the origin to
 * (6, 0, 4), so (3, 0, 2) is the midpoint of that edge — the kind of thing the hover snap
 * reports, now that it reports corners and edges only.
 */
function seed(): Design {
  return {
    ...createEmptyDesign(),
    vertices: [
      { id: 'a', position: at(0, 0, 0) },
      { id: 'b', position: at(6, 0, 0) },
      { id: 'c', position: at(6, 0, 4) },
    ],
    faces: [{ id: 'wall', vertexIds: ['a', 'b', 'c'], label: 'Wall' }],
  };
}

describe('the point follows the model, not the plane in front of it', () => {
  beforeEach(() => {
    state().loadDesign(seed());
    state().setBuildTool('draw');
    state().startDrawingAt('a', plane);
  });

  it('takes a point on real geometry over the drawing plane', () => {
    state().setDrawCursor(at(3, 0, 9)); // where the plane says
    state().setDrawSnap(at(3, 0, 2)); // where the cursor actually is, on the a-c edge
    expect(resolvePendingPoint(state())).toEqual(at(3, 0, 2));
  });

  it('falls back to the plane when nothing is under the cursor', () => {
    state().setDrawCursor(at(3, 0, 9));
    state().setDrawSnap(null);
    expect(resolvePendingPoint(state())?.z).toBeCloseTo(9, 6);
  });

  it('lets a typed value override the edge under the cursor', () => {
    // Typing is the most deliberate thing available, so it outranks hovering.
    state().setDrawSnap(at(3, 0, 2));
    state().setLockedAngle(90);
    state().setLockedLength(5);
    const pending = resolvePendingPoint(state())!;
    expect(pending.z).toBeCloseTo(5, 6);
    expect(pending.x).toBeCloseTo(0, 6);
  });

  it('commits the snapped point, not the one on the plane', () => {
    state().setDrawCursor(at(3, 0, 9));
    state().setDrawSnap(at(3, 0, 2));
    state().commitPendingPoint();
    const placed = state().design.vertices[state().design.vertices.length - 1];
    expect(placed.position).toEqual(at(3, 0, 2));
  });

  it('clears the snap when the pointer leaves the edge', () => {
    state().setDrawSnap(at(3, 0, 2));
    state().setDrawSnap(null);
    state().setDrawCursor(at(1, 0, 1));
    expect(resolvePendingPoint(state())).not.toEqual(at(3, 0, 2));
  });
});

describe('a start point that never became anything does not linger', () => {
  beforeEach(() => {
    state().loadDesign(seed());
    state().setBuildTool('draw');
  });

  it('removes a point started in open air and then abandoned', () => {
    const before = state().design.vertices.length;
    state().startChainAtPoint(at(-5, 0, 0), plane);
    expect(state().design.vertices.length).toBe(before + 1);

    state().endChain();
    expect(state().design.vertices.length).toBe(before);
    expect(orphanVertexIds(state().design)).toEqual([]);
  });

  it('removes it on a tool switch too, not just on Esc', () => {
    const before = state().design.vertices.length;
    state().startChainAtPoint(at(-5, 0, 0), plane);
    state().setBuildTool('select');
    expect(state().design.vertices.length).toBe(before);
  });

  it('keeps it once an edge has been drawn from it', () => {
    state().startChainAtPoint(at(-5, 0, 0), plane);
    state().setDrawCursor(at(-5, 0, 3));
    state().commitPendingPoint();
    const during = state().design.vertices.length;

    state().endChain();
    expect(state().design.vertices.length).toBe(during); // both points, and their edge
    expect(state().design.edges.length).toBe(4); // the wall's three, plus the new one
  });

  it('never touches a start point that was already part of the model', () => {
    const before = state().design.vertices.length;
    state().startDrawingAt('a', plane);
    state().endChain();
    expect(state().design.vertices.length).toBe(before);
    expect(state().design.vertices.some((v) => v.id === 'a')).toBe(true);
  });

  it('leaves no undo step behind for a chain that drew nothing', () => {
    const history = state().past.length;
    state().startChainAtPoint(at(-5, 0, 0), plane);
    state().endChain();
    expect(state().past.length).toBe(history);
  });
});

describe('the drawing plane is not a wall', () => {
  beforeEach(() => {
    state().loadDesign(seed());
    state().setBuildTool('draw');
    state().startDrawingAt('a', plane);
  });

  it('accepts a cursor far outside the work area instead of ignoring it', () => {
    // The pointer sheet is deliberately much larger than the view; what bounds the result
    // is the work area, not how big that sheet happens to be.
    state().setDrawCursor(at(500, 0, 300));
    const pending = resolvePendingPoint(state());
    expect(pending).not.toBeNull();
  });

  it('holds a pointer-aimed point inside the work area', () => {
    const half = state().design.basePlaneSizeIn / 2;
    state().setDrawCursor(at(500, 0, 300));
    const pending = resolvePendingPoint(state())!;
    expect(Math.abs(pending.x)).toBeLessThanOrEqual(half + 1e-9);
    expect(pending.z).toBeLessThanOrEqual(state().design.basePlaneSizeIn + 1e-9);
  });

  it('does not clamp below the base plane too tightly to work with', () => {
    const half = state().design.basePlaneSizeIn / 2;
    state().setDrawCursor(at(0, 0, -500));
    expect(resolvePendingPoint(state())!.z).toBeCloseTo(-half, 6);
  });

  it('honours a typed value as given rather than clamping it', () => {
    // Typing is deliberate; the clamp exists for aiming, not for overriding intent.
    state().setLockedAngle(90);
    state().setLockedLength(40);
    expect(resolvePendingPoint(state())!.z).toBeCloseTo(40, 6);
  });
});
