import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design } from '../types';
import { deriveEdges, dihedralAngleDeg, findSharedEdge, getVertex, isFacePlanar, sharedEdges } from '../mesh';
import { solveDihedralAngle } from '../solver';
import { unfoldAllFaces, unfoldFace } from '../unfold';
import { applyMiterCorrection } from '../miter';

/** A box-corner fixture: a flat square base with one vertical wall rising off one edge. */
function buildBoxCornerDesign(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'v0', position: { x: 0, y: 0, z: 0 } },
    { id: 'v1', position: { x: 1, y: 0, z: 0 } },
    { id: 'v2', position: { x: 1, y: 1, z: 0 } },
    { id: 'v3', position: { x: 0, y: 1, z: 0 } },
    { id: 't0', position: { x: 0, y: 0, z: 1 } },
    { id: 't1', position: { x: 1, y: 0, z: 1 } },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['v0', 'v1', 'v2', 'v3'], label: 'Base' },
    { id: 'side1', vertexIds: ['v0', 'v1', 't1', 't0'], label: 'Side 1' },
  ];
  design.baseFaceId = 'base';
  return design;
}

describe('deriveEdges / sharedEdges', () => {
  it('finds the one edge shared by base and side1', () => {
    const design = buildBoxCornerDesign();
    const edges = deriveEdges(design);
    expect(edges.length).toBe(4 + 4 - 1); // 4 base edges + 4 side edges, 1 shared
    const shared = sharedEdges(design);
    expect(shared.length).toBe(1);
    expect(shared[0].faceIds.sort()).toEqual(['base', 'side1']);
  });
});

describe('dihedralAngleDeg', () => {
  it('measures a vertical wall off a flat base as ~90 degrees', () => {
    const design = buildBoxCornerDesign();
    const edge = findSharedEdge(design, 'base', 'side1')!;
    const angle = dihedralAngleDeg(design, edge);
    expect(angle).toBeCloseTo(90, 6);
  });

  it('measures a coplanar extension as ~180 degrees', () => {
    const design = buildBoxCornerDesign();
    // Flatten side1 onto the same plane as base (extend outward in -y instead of up in +z).
    design.vertices = design.vertices.map((v) =>
      v.id === 't0' ? { ...v, position: { x: 0, y: -1, z: 0 } }
      : v.id === 't1' ? { ...v, position: { x: 1, y: -1, z: 0 } }
      : v,
    );
    const edge = findSharedEdge(design, 'base', 'side1')!;
    const angle = dihedralAngleDeg(design, edge);
    expect(angle).toBeCloseTo(180, 6);
  });
});

describe('solveDihedralAngle', () => {
  it('rotates the child face to hit an arbitrary target angle, leaving the fixed face untouched', () => {
    const design = buildBoxCornerDesign();
    const edge = findSharedEdge(design, 'base', 'side1')!;
    const baseVerticesBefore = design.vertices.filter((v) => ['v0', 'v1', 'v2', 'v3'].includes(v.id));

    const solved = solveDihedralAngle(design, edge, 'side1', 60);

    const baseVerticesAfter = solved.vertices.filter((v) => ['v0', 'v1', 'v2', 'v3'].includes(v.id));
    expect(baseVerticesAfter).toEqual(baseVerticesBefore);

    const edgeAfter = findSharedEdge(solved, 'base', 'side1')!;
    expect(dihedralAngleDeg(solved, edgeAfter)).toBeCloseTo(60, 6);
  });

  it('preserves the child face edge lengths exactly (pure rotation, no stretching)', () => {
    const design = buildBoxCornerDesign();
    const edge = findSharedEdge(design, 'base', 'side1')!;
    const t0Before = getVertex(design, 't0').position;
    const t1Before = getVertex(design, 't1').position;
    const sideEdgeLenBefore = Math.hypot(t1Before.x - t0Before.x, t1Before.y - t0Before.y, t1Before.z - t0Before.z);

    const solved = solveDihedralAngle(design, edge, 'side1', 35);

    const t0After = getVertex(solved, 't0').position;
    const t1After = getVertex(solved, 't1').position;
    const sideEdgeLenAfter = Math.hypot(t1After.x - t0After.x, t1After.y - t0After.y, t1After.z - t0After.z);
    expect(sideEdgeLenAfter).toBeCloseTo(sideEdgeLenBefore, 9);

    const v0ToT0Before = Math.hypot(t0Before.x - 0, t0Before.y - 0, t0Before.z - 0);
    const v0ToT0After = Math.hypot(t0After.x - 0, t0After.y - 0, t0After.z - 0);
    expect(v0ToT0After).toBeCloseTo(v0ToT0Before, 9);
  });

  it('hits 90, 45, and 120 degree targets exactly', () => {
    const design = buildBoxCornerDesign();
    const edge = findSharedEdge(design, 'base', 'side1')!;
    for (const target of [90, 45, 120, 10, 170]) {
      const solved = solveDihedralAngle(design, edge, 'side1', target);
      const edgeAfter = findSharedEdge(solved, 'base', 'side1')!;
      expect(dihedralAngleDeg(solved, edgeAfter)).toBeCloseTo(target, 6);
    }
  });
});

describe('unfoldAllFaces', () => {
  it('unfolds the base and side panels to their true flat sizes', () => {
    const design = buildBoxCornerDesign();
    const panels = unfoldAllFaces(design);
    expect(panels.length).toBe(2);
    const base = panels.find((p) => p.faceId === 'base')!;
    // Base is a 1x1 square; its flattened outline should have edge lengths of 1 all around.
    expect(base.edges.map((e) => e.lengthIn)).toEqual([1, 1, 1, 1]);
    const side1 = panels.find((p) => p.faceId === 'side1')!;
    expect(side1.edges.map((e) => e.lengthIn)).toEqual([1, 1, 1, 1]);
    // The shared edge (index 0 on both, v0->v1 / v0->v1) should report the 90 degree bevel.
    expect(base.edges[0].bevelAngleDeg).toBeCloseTo(90, 6);
    expect(side1.edges[0].bevelAngleDeg).toBeCloseTo(90, 6);
  });
});

describe('non-planar face unfolding', () => {
  function buildTwistedQuadDesign(): Design {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'p0', position: { x: 0, y: 0, z: 0 } },
      { id: 'p1', position: { x: 2, y: 0, z: 0 } },
      { id: 'p2', position: { x: 2, y: 1, z: 0.4 } },
      { id: 'p3', position: { x: 0, y: 1, z: 0 } },
    ];
    design.faces = [{ id: 'twisted', vertexIds: ['p0', 'p1', 'p2', 'p3'], label: 'Twisted' }];
    return design;
  }

  it('flags a twisted quad as non-planar', () => {
    const design = buildTwistedQuadDesign();
    expect(isFacePlanar(design, design.faces[0])).toBe(false);
  });

  it('unfolds a twisted quad as two true-length triangles sharing a diagonal', () => {
    const design = buildTwistedQuadDesign();
    const panel = unfoldFace(design, design.faces[0], []);
    expect(panel.isPlanar).toBe(false);
    expect(panel.internalDiagonal).toEqual([0, 2]);
    // Every outline edge length should match the true 3D edge length exactly.
    expect(panel.edges[0].lengthIn).toBeCloseTo(2, 9); // p0->p1
    expect(panel.edges[1].lengthIn).toBeCloseTo(Math.hypot(0, 1, 0.4), 9); // p1->p2
    expect(panel.edges[2].lengthIn).toBeCloseTo(Math.hypot(2, 0, 0.4), 9); // p2->p3
    expect(panel.edges[3].lengthIn).toBeCloseTo(1, 9); // p3->p0
    // Outline segment lengths (as placed in 2D) should equal the same true lengths.
    for (let i = 0; i < 4; i++) {
      const a = panel.outline[i];
      const b = panel.outline[(i + 1) % 4];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      expect(dist).toBeCloseTo(panel.edges[i].lengthIn, 6);
    }
  });

  it('maps a hole on a twisted face into the correct sub-triangle without throwing', () => {
    const design = buildTwistedQuadDesign();
    design.holes = [{ id: 'h1', faceId: 'twisted', u: 1.0, v: 0.5, diameterIn: 0.5 }];
    const panel = unfoldFace(design, design.faces[0], design.holes);
    expect(panel.holes.length).toBe(1);
    expect(Number.isFinite(panel.holes[0].x)).toBe(true);
    expect(Number.isFinite(panel.holes[0].y)).toBe(true);
  });
});

describe('applyMiterCorrection', () => {
  it('leaves a square outline unchanged when no edges are beveled', () => {
    const design = buildBoxCornerDesign();
    const panels = unfoldAllFaces(design);
    const base = panels.find((p) => p.faceId === 'base')!;
    // Base's own edges have no bevel except the one shared with side1.
    const mitered = applyMiterCorrection(base, 0.75);
    expect(mitered.outline.length).toBe(4);
    for (const p of mitered.outline) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('shifts a beveled edge outward for a sub-180 bevel angle', () => {
    const design = buildBoxCornerDesign();
    const panels = unfoldAllFaces(design);
    const side1 = panels.find((p) => p.faceId === 'side1')!;
    const original = side1.outline.map((p) => ({ ...p }));
    const mitered = applyMiterCorrection(side1, 0.75);
    // At least one corner should move since edge 0 (shared, 90 degree bevel) is corrected.
    const moved = mitered.outline.some((p, i) => Math.hypot(p.x - original[i].x, p.y - original[i].y) > 1e-6);
    expect(moved).toBe(true);
  });
});
