import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design, Vec3 } from '../types';
import { keepFacesPlanar } from '../planarize';
import { V, polygonCentroid, polygonNormal } from '../vec3';

/** Max off-plane distance of any corner, computed directly from positions. */
function deviation(design: Design, faceId: string): number {
  const face = design.faces.find((f) => f.id === faceId)!;
  const pts = face.vertexIds.map((id) => design.vertices.find((v) => v.id === id)!.position);
  if (pts.length < 4) return 0;
  const normal = polygonNormal(pts);
  const centroid = polygonCentroid(pts);
  return Math.max(...pts.map((p) => Math.abs(V.dot(V.sub(p, centroid), normal))));
}

function positionOf(design: Design, id: string): Vec3 {
  return design.vertices.find((v) => v.id === id)!.position;
}

function worstDeviation(design: Design): number {
  return Math.max(0, ...design.faces.map((f) => deviation(design, f.id)));
}

/** A closed box: base b0-b3 at z=0, top t0-t3 at z=3, four quad walls. */
function buildBox(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: { x: -5, y: -5, z: 0 } },
    { id: 'b1', position: { x: 5, y: -5, z: 0 } },
    { id: 'b2', position: { x: 5, y: 5, z: 0 } },
    { id: 'b3', position: { x: -5, y: 5, z: 0 } },
    { id: 't0', position: { x: -5, y: -5, z: 3 } },
    { id: 't1', position: { x: 5, y: -5, z: 3 } },
    { id: 't2', position: { x: 5, y: 5, z: 3 } },
    { id: 't3', position: { x: -5, y: 5, z: 3 } },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 'top', vertexIds: ['t3', 't2', 't1', 't0'], label: 'Top' },
    { id: 's1', vertexIds: ['b0', 'b1', 't1', 't0'], label: 'Side 1' },
    { id: 's2', vertexIds: ['b1', 'b2', 't2', 't1'], label: 'Side 2' },
    { id: 's3', vertexIds: ['b2', 'b3', 't3', 't2'], label: 'Side 3' },
    { id: 's4', vertexIds: ['b3', 'b0', 't0', 't3'], label: 'Side 4' },
  ];
  design.baseFaceId = 'base';
  return design;
}

/** Drags a top corner well off every plane it belongs to. */
function withDraggedCorner(design: Design, id: string, position: Vec3): Design {
  return {
    ...design,
    vertices: design.vertices.map((v) => (v.id === id ? { ...v, position } : v)),
  };
}

describe('keepFacesPlanar', () => {
  it('flattens every face of a box after a corner is dragged off-plane', () => {
    const dragged = withDraggedCorner(buildBox(), 't2', { x: 7.5, y: 6.2, z: 4.1 });
    expect(worstDeviation(dragged)).toBeGreaterThan(0.1);

    const fixed = keepFacesPlanar(dragged, 't2');
    expect(worstDeviation(fixed)).toBeLessThan(1e-6);
  });

  it('does not push the warp into faces the drag never touched', () => {
    // The whole point: correcting only the dragged corner's own faces moves the corners
    // that absorb it, which warps *their* other faces — the base among them.
    const dragged = withDraggedCorner(buildBox(), 't2', { x: 7.5, y: 6.2, z: 4.1 });
    const fixed = keepFacesPlanar(dragged, 't2');
    expect(deviation(fixed, 'base')).toBeLessThan(1e-9);
    expect(deviation(fixed, 's1')).toBeLessThan(1e-6);
  });

  it('leaves the base face exactly where it was when a corner elsewhere is dragged', () => {
    const dragged = withDraggedCorner(buildBox(), 't2', { x: 7.5, y: 6.2, z: 4.1 });
    const fixed = keepFacesPlanar(dragged, 't2');
    for (const id of ['b0', 'b1', 'b2', 'b3']) {
      expect(positionOf(fixed, id)).toEqual(positionOf(dragged, id));
    }
  });

  it('keeps the dragged corner exactly where the user put it', () => {
    const target = { x: 7.5, y: 6.2, z: 4.1 };
    const dragged = withDraggedCorner(buildBox(), 't2', target);
    const fixed = keepFacesPlanar(dragged, 't2');
    expect(positionOf(fixed, 't2')).toEqual(target);
  });

  it('never moves a locked corner', () => {
    let dragged = withDraggedCorner(buildBox(), 't2', { x: 7.5, y: 6.2, z: 4.1 });
    dragged = {
      ...dragged,
      vertices: dragged.vertices.map((v) => (v.id === 't1' ? { ...v, locked: true } : v)),
    };
    const before = positionOf(dragged, 't1');
    const fixed = keepFacesPlanar(dragged, 't2');
    expect(positionOf(fixed, 't1')).toEqual(before);
  });

  it('frees the base when it is the base itself being dragged', () => {
    const dragged = withDraggedCorner(buildBox(), 'b2', { x: 6.5, y: 6.5, z: 1.2 });
    const fixed = keepFacesPlanar(dragged, 'b2');
    expect(deviation(fixed, 'base')).toBeLessThan(1e-6);
    expect(positionOf(fixed, 'b2')).toEqual({ x: 6.5, y: 6.5, z: 1.2 });
  });

  it('leaves an already-flat model untouched', () => {
    const box = buildBox();
    const fixed = keepFacesPlanar(box, 't2');
    for (const v of box.vertices) {
      expect(positionOf(fixed, v.id)).toEqual(v.position);
    }
  });

  it('ignores a model made only of triangles, which are planar by definition', () => {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 1, y: 0, z: 0 } },
      { id: 'c', position: { x: 0, y: 1, z: 2 } },
    ];
    design.faces = [{ id: 'tri', vertexIds: ['a', 'b', 'c'], label: 'Side 1' }];
    expect(keepFacesPlanar(design, 'c')).toBe(design);
  });

  it('flattens a 5-sided face too, not just quads', () => {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 2, y: 0, z: 0 } },
      { id: 'c', position: { x: 3, y: 0, z: 2 } },
      { id: 'd', position: { x: 1, y: 2.5, z: 3 } },
      { id: 'e', position: { x: -1, y: 0, z: 2 } },
    ];
    design.faces = [{ id: 'pent', vertexIds: ['a', 'b', 'c', 'd', 'e'], label: 'Top' }];
    expect(deviation(design, 'pent')).toBeGreaterThan(0.1);

    const fixed = keepFacesPlanar(design, 'd');
    expect(deviation(fixed, 'pent')).toBeLessThan(1e-6);
    expect(positionOf(fixed, 'd')).toEqual({ x: 1, y: 2.5, z: 3 });
  });

  it('leaves geometry alone rather than mangling it when nothing is free to move', () => {
    let dragged = withDraggedCorner(buildBox(), 't2', { x: 7.5, y: 6.2, z: 4.1 });
    // Lock every corner that isn't the dragged one, so no correction is possible.
    dragged = {
      ...dragged,
      vertices: dragged.vertices.map((v) => (v.id === 't2' ? v : { ...v, locked: true })),
    };
    const fixed = keepFacesPlanar(dragged, 't2');
    for (const v of dragged.vertices) {
      expect(positionOf(fixed, v.id)).toEqual(v.position);
    }
  });
});
