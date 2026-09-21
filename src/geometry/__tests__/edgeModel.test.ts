import { describe, expect, it } from 'vitest';
import { createEmptyDesign, edgeKey } from '../types';
import type { Design } from '../types';
import { edgesFromFaces, hasEdge, orphanVertexIds, withFaceEdges, addEdge, removeEdgeKeys } from '../edges';
import { deriveEdges, sharedEdges } from '../mesh';
import { validateDesign, effectiveWidthIn, faceSelfIntersects } from '../validate';
import { normalizeDesign, isStructurallySound } from '../normalize';
import { polygonArea } from '../vec3';

/** A square base with one wall rising off the v0-v1 edge. */
function wallDesign(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'v0', position: { x: 0, y: 0, z: 0 } },
    { id: 'v1', position: { x: 4, y: 0, z: 0 } },
    { id: 'v2', position: { x: 4, y: 4, z: 0 } },
    { id: 'v3', position: { x: 0, y: 4, z: 0 } },
    { id: 't0', position: { x: 0, y: 0, z: 3 } },
    { id: 't1', position: { x: 4, y: 0, z: 3 } },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['v0', 'v1', 'v2', 'v3'], label: 'Base' },
    { id: 'wall', vertexIds: ['v0', 'v1', 't1', 't0'], label: 'Wall' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

describe('edges as stored connectivity', () => {
  it('backs every side of every face with an edge', () => {
    const design = wallDesign();
    expect(isStructurallySound(design)).toBe(true);
    // 4 base sides + 4 wall sides, with v0-v1 shared between them.
    expect(design.edges.length).toBe(7);
  });

  it('is idempotent — running it again adds nothing', () => {
    const once = wallDesign();
    expect(withFaceEdges(once).edges.length).toBe(once.edges.length);
  });

  it('never stores the same edge twice, whichever way round it is given', () => {
    const design = addEdge(addEdge(wallDesign(), 'v2', 't1'), 't1', 'v2');
    const keys = design.edges.map((e) => edgeKey(e.a, e.b));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('refuses an edge from a vertex to itself (constraint 1)', () => {
    expect(addEdge(wallDesign(), 'v0', 'v0').edges.length).toBe(7);
  });

  it('keeps an edge that belongs to no face — the whole point of storing them', () => {
    const design = addEdge(wallDesign(), 'v2', 't1');
    expect(hasEdge(design, 'v2', 't1')).toBe(true);
    const derived = deriveEdges(design).find((e) => e.key === edgeKey('v2', 't1'));
    expect(derived?.faceIds).toEqual([]);
    // ...and it doesn't confuse the dihedral machinery, which wants exactly two faces.
    expect(sharedEdges(design).map((e) => e.key)).toEqual([edgeKey('v0', 'v1')]);
  });
});

describe('orphaned vertices (constraint 2)', () => {
  it('names vertices no edge reaches', () => {
    const design = wallDesign();
    design.vertices.push({ id: 'loose', position: { x: 9, y: 9, z: 0 } });
    expect(orphanVertexIds(design)).toEqual(['loose']);
  });

  it('reports none when every vertex is connected', () => {
    expect(orphanVertexIds(wallDesign())).toEqual([]);
  });
});

describe('constraint 6 — a face must enclose real area', () => {
  const pts = (...xs: Array<[number, number]>) => xs.map(([x, y]) => ({ x, y, z: 0 }));

  it('measures a square by its width', () => {
    expect(effectiveWidthIn(pts([0, 0], [4, 0], [4, 4], [0, 4]))).toBeCloseTo(2, 6);
  });

  it('gives zero width to three collinear points', () => {
    expect(effectiveWidthIn(pts([0, 0], [1, 0], [2, 0]))).toBeCloseTo(0, 9);
  });

  it('flags a near-collinear sliver, which a plain area test would let through', () => {
    const sliver = pts([0, 0], [10, 0], [10, 0.001], [0, 0.001]);
    expect(polygonArea(sliver)).toBeGreaterThan(0); // has area, so "area > 0" passes
    expect(effectiveWidthIn(sliver)).toBeLessThan(0.01); // but it is 0.001in across
  });

  it('reports a collinear face on validation', () => {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 1, y: 0, z: 0 } },
      { id: 'c', position: { x: 2, y: 0, z: 0 } },
    ];
    design.faces = [{ id: 'flat', vertexIds: ['a', 'b', 'c'], label: 'Flat' }];
    const issues = validateDesign(withFaceEdges(design));
    expect(issues.some((i) => i.constraint === 6)).toBe(true);
  });
});

describe('constraint 7 — a face boundary must not cross itself', () => {
  function quad(order: string[]): Design {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'A', position: { x: 0, y: 0, z: 0 } },
      { id: 'B', position: { x: 4, y: 0, z: 0 } },
      { id: 'C', position: { x: 4, y: 4, z: 0 } },
      { id: 'D', position: { x: 0, y: 4, z: 0 } },
    ];
    design.faces = [{ id: 'q', vertexIds: order, label: 'Quad' }];
    return withFaceEdges(design);
  }

  it('accepts a plain square', () => {
    const design = quad(['A', 'B', 'C', 'D']);
    expect(faceSelfIntersects(design, design.faces[0])).toBe(false);
  });

  it('catches the bowtie ordering', () => {
    const design = quad(['A', 'B', 'D', 'C']);
    expect(faceSelfIntersects(design, design.faces[0])).toBe(true);
    expect(validateDesign(design).some((i) => i.constraint === 7)).toBe(true);
  });

  it('never flags a triangle, whose sides are all mutually adjacent', () => {
    const design = createEmptyDesign();
    design.vertices = [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 3, y: 0, z: 0 } },
      { id: 'c', position: { x: 0, y: 3, z: 0 } },
    ];
    design.faces = [{ id: 't', vertexIds: ['a', 'b', 'c'], label: 'Tri' }];
    const d = withFaceEdges(design);
    expect(faceSelfIntersects(d, d.faces[0])).toBe(false);
  });
});

describe('constraint 9 — faces must be coplanar', () => {
  it('reports a warped quad', () => {
    const design = wallDesign();
    design.vertices = design.vertices.map((v) =>
      v.id === 'v3' ? { ...v, position: { x: 0, y: 4, z: 1.5 } } : v,
    );
    const issues = validateDesign(design);
    expect(issues.some((i) => i.constraint === 9 && i.faceId === 'base')).toBe(true);
  });

  it('is quiet about a flat model', () => {
    expect(validateDesign(wallDesign())).toEqual([]);
  });
});

describe('constraint 10 — at most two faces per edge', () => {
  it('reports a third face along an existing edge', () => {
    const design = wallDesign();
    design.vertices.push({ id: 'x', position: { x: 2, y: -3, z: 0 } });
    design.faces.push({ id: 'third', vertexIds: ['v0', 'v1', 'x'], label: 'Third' });
    const issues = validateDesign(withFaceEdges(design));
    expect(issues.some((i) => i.constraint === 10)).toBe(true);
  });
});

describe('normalizing an incoming design', () => {
  it('migrates a v1 design that stored no edges at all', () => {
    const legacy = { ...wallDesign(), edges: [] };
    const { design, repairs } = normalizeDesign(legacy);
    expect(design.edges.length).toBe(7);
    expect(isStructurallySound(design)).toBe(true);
    expect(repairs.join(' ')).toMatch(/predates edges/);
  });

  it('derives exactly the edge set the faces imply', () => {
    const design = wallDesign();
    const derived = edgesFromFaces(design.faces).map((e) => edgeKey(e.a, e.b)).sort();
    expect(derived).toEqual(design.edges.map((e) => edgeKey(e.a, e.b)).sort());
  });

  it('drops a face pointing at a vertex that does not exist, rather than crashing', () => {
    const broken = wallDesign();
    broken.faces.push({ id: 'ghost', vertexIds: ['v0', 'v1', 'nope'], label: 'Ghost' });
    const { design, repairs } = normalizeDesign(broken);
    expect(design.faces.map((f) => f.id)).toEqual(['base', 'wall']);
    expect(repairs.join(' ')).toMatch(/Ghost/);
  });

  it('clears holes, locks and the base reference left dangling by a dropped face', () => {
    const broken = wallDesign();
    broken.faces.push({ id: 'ghost', vertexIds: ['v0', 'v1', 'nope'], label: 'Ghost' });
    broken.holes = [{ id: 'h', faceId: 'ghost', u: 1, v: 1, diameterIn: 0.5 }];
    broken.angleLocks = [{ id: 'l', faceAId: 'ghost', faceBId: 'base', targetAngleDeg: 90 }];
    broken.baseFaceId = 'ghost';
    const { design } = normalizeDesign(broken);
    expect(design.holes).toEqual([]);
    expect(design.angleLocks).toEqual([]);
    expect(design.baseFaceId).toBeNull();
  });

  it('discards a self-joined or duplicated edge', () => {
    const odd = wallDesign();
    odd.edges = [...odd.edges, { a: 'v0', b: 'v0' }, { a: 'v1', b: 'v0' }];
    const { design, repairs } = normalizeDesign(odd);
    expect(design.edges.length).toBe(7);
    expect(repairs.join(' ')).toMatch(/Discarded 2 edge/);
  });

  it('reports a warped face without moving it', () => {
    const warped = wallDesign();
    warped.vertices = warped.vertices.map((v) =>
      v.id === 'v3' ? { ...v, position: { x: 0, y: 4, z: 1.5 } } : v,
    );
    const { design, issues, repairs } = normalizeDesign(warped);
    expect(issues.some((i) => i.constraint === 9)).toBe(true);
    expect(repairs).toEqual([]);
    expect(design.vertices.find((v) => v.id === 'v3')?.position.z).toBe(1.5);
  });

  it('survives junk without throwing', () => {
    expect(normalizeDesign(null).design.vertices).toEqual([]);
    expect(normalizeDesign({} as never).design.faces).toEqual([]);
    expect(normalizeDesign({ vertices: 'nope', faces: 7 } as never).design.edges).toEqual([]);
  });
});

describe('removeEdgeKeys', () => {
  it('removes only the named edges', () => {
    const design = removeEdgeKeys(wallDesign(), new Set([edgeKey('v0', 'v1')]));
    expect(design.edges.length).toBe(6);
    expect(hasEdge(design, 'v0', 'v1')).toBe(false);
    expect(hasEdge(design, 'v1', 'v2')).toBe(true);
  });
});
