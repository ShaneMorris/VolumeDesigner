import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design } from '../types';
import { setEdgeLengthByMovingVertex, setInteriorAngleAtVertex, extrudeFace } from '../edit';
import { edgeLength, getFace } from '../mesh';

function buildTriangleDesign(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'a', position: { x: 0, y: 0, z: 0 } },
    { id: 'b', position: { x: 1, y: 0, z: 0 } },
    { id: 'c', position: { x: 0, y: 1, z: 0 } },
  ];
  design.faces = [{ id: 'tri', vertexIds: ['a', 'b', 'c'], label: 'Base' }];
  return design;
}

describe('setEdgeLengthByMovingVertex', () => {
  it('moves only the target vertex, along the existing edge direction, to the new length', () => {
    const design = buildTriangleDesign();
    const result = setEdgeLengthByMovingVertex(design, 'a', 'b', 3);
    expect(edgeLength(result, 'a', 'b')).toBeCloseTo(3, 9);
    const bPos = result.vertices.find((v) => v.id === 'b')!.position;
    expect(bPos.y).toBeCloseTo(0, 9);
    expect(bPos.z).toBeCloseTo(0, 9);
    const aPos = result.vertices.find((v) => v.id === 'a')!.position;
    expect(aPos).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('setInteriorAngleAtVertex', () => {
  it('sets the angle at a vertex while preserving that edge length', () => {
    const design = buildTriangleDesign();
    const lenBefore = edgeLength(design, 'a', 'b');
    const result = setInteriorAngleAtVertex(design, 'tri', 'a', 60);
    expect(edgeLength(result, 'a', 'b')).toBeCloseTo(lenBefore, 9);

    // Recompute the interior angle at 'a' directly to confirm it now reads 60.
    const aPos = result.vertices.find((v) => v.id === 'a')!.position;
    const cPos = result.vertices.find((v) => v.id === 'c')!.position;
    const bPos = result.vertices.find((v) => v.id === 'b')!.position;
    const toC = { x: cPos.x - aPos.x, y: cPos.y - aPos.y };
    const toB = { x: bPos.x - aPos.x, y: bPos.y - aPos.y };
    const dot = toC.x * toB.x + toC.y * toB.y;
    const mag = Math.hypot(toC.x, toC.y) * Math.hypot(toB.x, toB.y);
    const angleDeg = Math.acos(dot / mag) * (180 / Math.PI);
    expect(angleDeg).toBeCloseTo(60, 6);
  });
});

describe('extrudeFace', () => {
  it('pulls a triangle base straight up into a 3-sided prism', () => {
    const design = buildTriangleDesign();
    let counter = 0;
    const makeIds = () => `gen${counter++}`;
    const { design: result, topFaceId, sideFaceIds, topVertexIds } = extrudeFace(
      design,
      design.faces[0],
      2,
      makeIds,
    );
    expect(topVertexIds.length).toBe(3);
    expect(sideFaceIds.length).toBe(3);
    expect(result.faces.length).toBe(1 + 1 + 3); // base + top + 3 sides
    const top = getFace(result, topFaceId);
    expect(top.vertexIds.length).toBe(3);
    // Top vertices should sit directly above (not below) base vertices by the extrude height.
    const baseA = result.vertices.find((v) => v.id === 'a')!.position;
    const topA = result.vertices.find((v) => v.id === topVertexIds[0])!.position;
    expect(topA.z - baseA.z).toBeCloseTo(2, 9);
    expect(topA.x).toBeCloseTo(baseA.x, 9);
    expect(topA.y).toBeCloseTo(baseA.y, 9);
  });

  it('always pulls up (+Z), even when the base polygon is wound clockwise from above', () => {
    const design = createEmptyDesign();
    // a -> b -> c is clockwise as seen from +Z, so the raw Newell normal points -Z.
    design.vertices = [
      { id: 'a', position: { x: 0, y: 0, z: 0 } },
      { id: 'b', position: { x: 0, y: 1, z: 0 } },
      { id: 'c', position: { x: 1, y: 0, z: 0 } },
    ];
    design.faces = [{ id: 'tri', vertexIds: ['a', 'b', 'c'], label: 'Base' }];

    let counter = 0;
    const { design: result, topVertexIds } = extrudeFace(design, design.faces[0], 3, () => `gen${counter++}`);
    const baseA = result.vertices.find((v) => v.id === 'a')!.position;
    const topA = result.vertices.find((v) => v.id === topVertexIds[0])!.position;
    expect(topA.z - baseA.z).toBeCloseTo(3, 9);
  });
});
