import { describe, expect, it } from 'vitest';
import { createEmptyDesign, edgeKey } from '../types';
import type { Design } from '../types';
import { withFaceEdges, hasEdge } from '../edges';
import { splitEdgeAt, splitFace, parameterAlongEdge, splittableCornerPairs } from '../split';
import type { SplitOutcome } from '../split';
import { validateDesign } from '../validate';
import { isStructurallySound } from '../normalize';
import { faceLocalBasis, toFaceLocal, fromFaceLocal } from '../basis';
import { getVertex, findSharedEdge, dihedralAngleDeg } from '../mesh';
import { V } from '../vec3';

let counter = 0;
const makeId = () => `n${++counter}`;

/** A square base with one vertical wall on the b1-b2 edge. */
function seed(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: { x: 0, y: 0, z: 0 } },
    { id: 'b1', position: { x: 8, y: 0, z: 0 } },
    { id: 'b2', position: { x: 8, y: 8, z: 0 } },
    { id: 'b3', position: { x: 0, y: 8, z: 0 } },
    { id: 't1', position: { x: 8, y: 0, z: 5 } },
    { id: 't2', position: { x: 8, y: 8, z: 5 } },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 'wall', vertexIds: ['b1', 'b2', 't2', 't1'], label: 'Wall' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

/** Unwraps a split that was supposed to succeed, reporting its refusal reason if not. */
function ok<T>(result: SplitOutcome<T>): { ok: true } & T {
  if (!result.ok) throw new Error(`expected the split to succeed, but: ${result.reason}`);
  return result;
}

describe('splitEdgeAt', () => {
  it('replaces the edge with two, joined at the new vertex', () => {
    const r = ok(splitEdgeAt(seed(), 'b0', 'b1', 0.25, makeId));
    expect(hasEdge(r.design, 'b0', 'b1')).toBe(false);
    expect(hasEdge(r.design, 'b0', r.vertexId)).toBe(true);
    expect(hasEdge(r.design, r.vertexId, 'b1')).toBe(true);
  });

  it('puts the vertex exactly on the segment, at the asked-for fraction', () => {
    const r = ok(splitEdgeAt(seed(), 'b0', 'b1', 0.25, makeId));
    expect(getVertex(r.design, r.vertexId).position).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('adds the vertex to every face that used the edge, in the right place', () => {
    // b1-b2 is shared by base and wall, and appears in each with opposite orientation.
    const r = ok(splitEdgeAt(seed(), 'b1', 'b2', 0.5, makeId));
    const base = r.design.faces.find((f) => f.id === 'base')!;
    const wall = r.design.faces.find((f) => f.id === 'wall')!;
    expect(base.vertexIds).toEqual(['b0', 'b1', r.vertexId, 'b2', 'b3']);
    expect(wall.vertexIds).toEqual(['b1', r.vertexId, 'b2', 't2', 't1']);
    expect(isStructurallySound(r.design)).toBe(true);
    expect(validateDesign(r.design)).toEqual([]);
  });

  it('leaves faces that never used the edge alone', () => {
    const r = ok(splitEdgeAt(seed(), 'b3', 'b0', 0.5, makeId));
    expect(r.design.faces.find((f) => f.id === 'wall')!.vertexIds).toEqual(['b1', 'b2', 't2', 't1']);
  });

  it('keeps affected faces planar, since the new corner is collinear', () => {
    const r = ok(splitEdgeAt(seed(), 'b1', 'b2', 0.3, makeId));
    expect(validateDesign(r.design).filter((i) => i.constraint === 9)).toEqual([]);
  });

  it('does not disturb hole coordinates on an affected face', () => {
    const design = seed();
    design.holes = [{ id: 'h', faceId: 'wall', u: 3, v: 2, diameterIn: 0.5 }];
    const wall = design.faces.find((f) => f.id === 'wall')!;
    const worldBefore = fromFaceLocal(faceLocalBasis(design, wall), 3, 2);

    // Split the wall's own first edge — the case most likely to move its frame.
    const r = ok(splitEdgeAt(design, 'b1', 'b2', 0.5, makeId));
    const after = r.design.faces.find((f) => f.id === 'wall')!;
    const worldAfter = fromFaceLocal(faceLocalBasis(r.design, after), 3, 2);
    expect(V.distance(worldBefore, worldAfter)).toBeCloseTo(0, 9);
  });

  it('refuses a split at or beyond either end', () => {
    for (const t of [0, 1, -0.2, 1.5]) {
      expect(splitEdgeAt(seed(), 'b0', 'b1', t, makeId).ok).toBe(false);
    }
  });

  it('refuses when the two points are not joined by an edge', () => {
    expect(splitEdgeAt(seed(), 'b0', 'b2', 0.5, makeId).ok).toBe(false);
  });

  it('reads a fraction back off a 3D point', () => {
    const design = seed();
    expect(parameterAlongEdge(design, 'b0', 'b1', { x: 6, y: 0, z: 0 })).toBeCloseTo(0.75, 9);
    // Off-segment points project onto it and clamp rather than running away.
    expect(parameterAlongEdge(design, 'b0', 'b1', { x: 20, y: 3, z: 0 })).toBe(1);
  });
});

describe('splitFace', () => {
  it('divides a quad into two quads when the chord runs corner to corner', () => {
    // Split the wall across its middle: b1-b2-t2-t1 with a chord needs mid-edge points.
    let design = seed();
    const e1 = ok(splitEdgeAt(design, 'b1', 'b2', 0.5, makeId));
    design = e1.design;
    const e2 = ok(splitEdgeAt(design, 't2', 't1', 0.5, makeId));
    design = e2.design;

    const r = ok(
      splitFace(design, 'wall', e1.vertexId, e2.vertexId, makeId),
    );
    const [a, b] = r.faceIds.map((id) => r.design.faces.find((f) => f.id === id)!);
    expect(a.vertexIds.length).toBe(4);
    expect(b.vertexIds.length).toBe(4);
    expect(r.design.faces.some((f) => f.id === 'wall')).toBe(false);
    expect(validateDesign(r.design)).toEqual([]);
  });

  it('divides a quad into two triangles across a diagonal', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    const sizes = r.faceIds.map((id) => r.design.faces.find((f) => f.id === id)!.vertexIds.length);
    expect(sizes).toEqual([3, 3]);
  });

  it('adds the chord as a real edge', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    expect(hasEdge(r.design, 'b1', 't2')).toBe(true);
    expect(isStructurallySound(r.design)).toBe(true);
  });

  it('gives both children the parent winding, so the fold angle is unchanged', () => {
    const before = seed();
    const edgeBefore = findSharedEdge(before, 'base', 'wall')!;
    const angleBefore = dihedralAngleDeg(before, edgeBefore);

    const r = ok(splitFace(before, 'wall', 'b1', 't2', makeId));
    // Whichever child kept the b1-b2 edge should read the same angle against the base.
    const heir = r.faceIds.find((id) => !!findSharedEdge(r.design, 'base', id))!;
    const edgeAfter = findSharedEdge(r.design, 'base', heir)!;
    expect(dihedralAngleDeg(r.design, edgeAfter)).toBeCloseTo(angleBefore, 6);
  });

  it('labels the children after the parent', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    const labels = r.faceIds.map((id) => r.design.faces.find((f) => f.id === id)!.label);
    expect(labels).toEqual(['Walla', 'Wallb']);
  });

  it('refuses to split the base', () => {
    const r = splitFace(seed(), 'base', 'b0', 'b2', makeId);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/base/i);
  });

  it('refuses corners that are already neighbours', () => {
    const r = splitFace(seed(), 'wall', 'b1', 'b2', makeId);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/neighbours/);
  });

  it('refuses a corner that does not belong to the face', () => {
    expect(splitFace(seed(), 'wall', 'b1', 'b3', makeId).ok).toBe(false);
  });

  it('refuses a chord that would pass outside a concave face', () => {
    // An L-shape in the z=0 plane. The chord p0-p4 cuts across the missing quadrant.
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'p0', position: { x: 0, y: 0, z: 0 } },
      { id: 'p1', position: { x: 6, y: 0, z: 0 } },
      { id: 'p2', position: { x: 6, y: 2, z: 0 } },
      { id: 'p3', position: { x: 2, y: 2, z: 0 } },
      { id: 'p4', position: { x: 2, y: 6, z: 0 } },
      { id: 'p5', position: { x: 0, y: 6, z: 0 } },
    ];
    design.faces = [{ id: 'ell', vertexIds: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], label: 'L' }];
    const ready = withFaceEdges(design);

    expect(splitFace(ready, 'ell', 'p1', 'p4', makeId).ok).toBe(false); // outside the L
    expect(splitFace(ready, 'ell', 'p0', 'p3', makeId).ok).toBe(true); // inside it
  });

  it('is the remedy for a pinned vertex: the children are triangles that cannot warp', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    for (const id of r.faceIds) {
      expect(r.design.faces.find((f) => f.id === id)!.vertexIds.length).toBe(3);
    }
  });

  it('only offers corner pairs that are not already neighbours', () => {
    const quad = { id: 'q', vertexIds: ['a', 'b', 'c', 'd'], label: 'Q' };
    expect(splittableCornerPairs(quad)).toEqual([
      { a: 'a', b: 'c' },
      { a: 'b', b: 'd' },
    ]);
    const tri = { id: 't', vertexIds: ['a', 'b', 'c'], label: 'T' };
    expect(splittableCornerPairs(tri)).toEqual([]); // nothing to divide
  });
});

describe('splitFace divides what the parent owned', () => {
  it('moves each hole to the child that contains it, keeping its real position', () => {
    const design = seed();
    const wall = design.faces.find((f) => f.id === 'wall')!;
    const basis = faceLocalBasis(design, wall);
    // Two holes either side of the b1-t2 diagonal, placed by their real 3D positions.
    const low = toFaceLocal(basis, { x: 8, y: 6, z: 1 });
    const high = toFaceLocal(basis, { x: 8, y: 2, z: 4 });
    design.holes = [
      { id: 'low', faceId: 'wall', u: low.u, v: low.v, diameterIn: 0.5 },
      { id: 'high', faceId: 'wall', u: high.u, v: high.v, diameterIn: 0.5 },
    ];

    const r = ok(splitFace(design, 'wall', 'b1', 't2', makeId));
    expect(r.design.holes.length).toBe(2);
    expect(r.design.holes.some((h) => h.faceId === 'wall')).toBe(false);
    // They landed on different children...
    expect(new Set(r.design.holes.map((h) => h.faceId)).size).toBe(2);

    // ...and each one's real position in space is unchanged, which is the part that matters.
    for (const [id, world] of [
      ['low', { x: 8, y: 6, z: 1 }],
      ['high', { x: 8, y: 2, z: 4 }],
    ] as const) {
      const hole = r.design.holes.find((h) => h.id === id)!;
      const face = r.design.faces.find((f) => f.id === hole.faceId)!;
      const moved = fromFaceLocal(faceLocalBasis(r.design, face), hole.u, hole.v);
      expect(V.distance(moved, world)).toBeCloseTo(0, 6);
    }
  });

  it('re-points an angle lock at the child that kept the locked edge', () => {
    const design = seed();
    design.angleLocks = [{ id: 'lock', faceAId: 'base', faceBId: 'wall', targetAngleDeg: 90 }];

    const r = ok(splitFace(design, 'wall', 'b1', 't2', makeId));
    const lock = r.design.angleLocks[0];
    expect(lock.faceAId).toBe('base');
    expect(r.faceIds).toContain(lock.faceBId);
    expect(findSharedEdge(r.design, 'base', lock.faceBId)).toBeDefined();
  });

  it('drops a lock whose edge neither child inherited', () => {
    const design = seed();
    // A lock naming a face the wall shares nothing with once split is meaningless.
    design.faces.push({ id: 'far', vertexIds: ['b0', 'b3', 'b2'], label: 'Far' });
    design.angleLocks = [{ id: 'lock', faceAId: 'wall', faceBId: 'far', targetAngleDeg: 90 }];
    const ready = withFaceEdges(design);
    const r = ok(splitFace(ready, 'wall', 'b1', 't2', makeId));
    expect(r.design.angleLocks.some((l) => l.faceAId === 'wall' || l.faceBId === 'wall')).toBe(false);
  });

  it('leaves the split design valid under every constraint', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    expect(validateDesign(r.design)).toEqual([]);
    expect(isStructurallySound(r.design)).toBe(true);
  });

  it('keeps each edge at no more than two faces (constraint 10)', () => {
    const r = ok(splitFace(seed(), 'wall', 'b1', 't2', makeId));
    expect(validateDesign(r.design).filter((i) => i.constraint === 10)).toEqual([]);
    expect(edgeKey('b1', 't2')).toBeTruthy();
  });
});
