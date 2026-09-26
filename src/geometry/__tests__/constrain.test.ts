import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design, Vec3 } from '../types';
import { withFaceEdges } from '../edges';
import {
  constrainTranslation,
  constrainVertexMove,
  freedomForTranslation,
  describeFreedom,
} from '../constrain';
import { validateDesign } from '../validate';
import { V } from '../vec3';

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** A square base with one vertical wall on the b0-b1 edge. */
function baseAndWall(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: at(0, 0, 0) },
    { id: 'b1', position: at(4, 0, 0) },
    { id: 'b2', position: at(4, 4, 0) },
    { id: 'b3', position: at(0, 4, 0) },
    { id: 't0', position: at(0, 0, 3) },
    { id: 't1', position: at(4, 0, 3) },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 'wall', vertexIds: ['b0', 'b1', 't1', 't0'], label: 'Wall' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

/** A closed box: six planar quads. */
function box(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: at(0, 0, 0) },
    { id: 'b1', position: at(4, 0, 0) },
    { id: 'b2', position: at(4, 4, 0) },
    { id: 'b3', position: at(0, 4, 0) },
    { id: 't0', position: at(0, 0, 3) },
    { id: 't1', position: at(4, 0, 3) },
    { id: 't2', position: at(4, 4, 3) },
    { id: 't3', position: at(0, 4, 3) },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 'top', vertexIds: ['t3', 't2', 't1', 't0'], label: 'Top' },
    { id: 'front', vertexIds: ['b0', 'b1', 't1', 't0'], label: 'Front' },
    { id: 'right', vertexIds: ['b1', 'b2', 't2', 't1'], label: 'Right' },
    { id: 'back', vertexIds: ['b2', 'b3', 't3', 't2'], label: 'Back' },
    { id: 'left', vertexIds: ['b3', 'b0', 't0', 't3'], label: 'Left' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

/** A pyramid: a square base with four triangular sides. Triangles constrain nothing. */
function pyramid(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: at(0, 0, 0) },
    { id: 'b1', position: at(4, 0, 0) },
    { id: 'b2', position: at(4, 4, 0) },
    { id: 'b3', position: at(0, 4, 0) },
    { id: 'apex', position: at(2, 2, 5) },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 's0', vertexIds: ['b0', 'b1', 'apex'], label: 'S0' },
    { id: 's1', vertexIds: ['b1', 'b2', 'apex'], label: 'S1' },
    { id: 's2', vertexIds: ['b2', 'b3', 'apex'], label: 'S2' },
    { id: 's3', vertexIds: ['b3', 'b0', 'apex'], label: 'S3' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

function applied(design: Design, ids: string[], t: Vec3): Design {
  const moving = new Set(ids);
  return {
    ...design,
    vertices: design.vertices.map((v) => (moving.has(v.id) ? { ...v, position: V.add(v.position, t) } : v)),
  };
}

describe('how much freedom a vertex has', () => {
  it('a corner on one planar quad slides across a plane', () => {
    const design = baseAndWall();
    // b2 belongs to the base only.
    expect(freedomForTranslation(design, ['b2']).dof).toBe(2);
  });

  it('a corner shared by two quads slides along a line', () => {
    const freedom = freedomForTranslation(baseAndWall(), ['b0']);
    expect(freedom.dof).toBe(1);
    // Base holds z, wall holds y, so the only way out is along x.
    expect(Math.abs(freedom.basis[0].x)).toBeCloseTo(1, 9);
  });

  it('a corner of a closed box cannot move at all', () => {
    const freedom = freedomForTranslation(box(), ['b0']);
    expect(freedom.dof).toBe(0);
    expect(freedom.holdingFaceLabels.length).toBe(3);
  });

  it('the apex of a pyramid is free, since triangles are planar whatever happens', () => {
    expect(freedomForTranslation(pyramid(), ['apex']).dof).toBe(3);
  });

  it('a base corner of a pyramid is held only by the base', () => {
    expect(freedomForTranslation(pyramid(), ['b0']).dof).toBe(2);
  });
});

describe('how much freedom an edge has — and why it differs', () => {
  it('an edge can move where neither of its ends could alone', () => {
    const design = baseAndWall();
    // Each end is pinned to a line: the wall fixes its y, and the base plane its z.
    expect(freedomForTranslation(design, ['b0']).dof).toBe(1);
    expect(freedomForTranslation(design, ['b1']).dof).toBe(1);
    // ...yet the edge they span has a whole plane to move in. Both quads have their
    // opposite side parallel to this one, so translating it just tilts each face and it
    // stays flat either way. Only the base plane still holds it, and that holds it to a
    // plane rather than a line — this is a base edge (constraint 11).
    const edge = freedomForTranslation(design, ['b0', 'b1']);
    expect(edge.dof).toBe(2);
    for (const direction of edge.basis) expect(Math.abs(direction.z)).toBeCloseTo(0, 9);
  });

  it('a box has pinned corners but edges that still slide', () => {
    const design = box();
    expect(freedomForTranslation(design, ['b0']).dof).toBe(0);
    // The two faces along this edge are parallelograms and constrain nothing. What is left
    // is the side walls at either end, which both say keep x where it is, and the base
    // plane, which says keep z — leaving this base edge free to slide along y alone.
    const edge = freedomForTranslation(design, ['b0', 'b1']);
    expect(edge.dof).toBe(1);
    expect(Math.abs(edge.basis[0].y)).toBeCloseTo(1, 9);
  });

  it('lets a box edge that is not on the base keep the freedom the base edge loses', () => {
    // The same edge one storey up. Nothing here is on the base, so the parallelogram
    // reasoning above runs to its conclusion: two directions survive, not one.
    const design = box();
    const edge = freedomForTranslation(design, ['t0', 't1']);
    expect(edge.dof).toBe(2);
    for (const direction of edge.basis) expect(Math.abs(direction.x)).toBeCloseTo(0, 9);
  });

  it('an edge whose face is not a parallelogram is constrained by it', () => {
    const design = baseAndWall();
    // Skew the far side of the base so b2-b3 no longer runs parallel to b0-b1.
    design.vertices = design.vertices.map((v) =>
      v.id === 'b2' ? { ...v, position: at(5, 4, 0) } : v.id === 'b3' ? { ...v, position: at(1, 3, 0) } : v,
    );
    const freedom = freedomForTranslation(design, ['b0', 'b1']);
    expect(freedom.dof).toBe(2);
    // The lost direction is straight up: tilting this edge would warp the skewed base.
    const move = constrainTranslation(design, ['b0', 'b1'], at(0, 0, 1));
    expect(V.length(move.translation)).toBeCloseTo(0, 9);
  });
});

describe('a constrained move keeps every face flat', () => {
  it('redirects a drag rather than warping the faces it would have warped', () => {
    const design = baseAndWall();
    // Ask to drag b0 straight up — which both quads forbid.
    const move = constrainVertexMove(design, 'b0', at(0, 0, 2));
    expect(V.length(move.translation)).toBeCloseTo(0, 9);
    expect(validateDesign(applied(design, ['b0'], move.translation))).toEqual([]);
  });

  it('keeps the component of a drag that is allowed', () => {
    const design = baseAndWall();
    // Mostly sideways, partly upward: the sideways part survives, the rest is dropped.
    const move = constrainVertexMove(design, 'b0', at(-1.5, 0, 2));
    expect(move.translation.x).toBeCloseTo(-1.5, 9);
    expect(move.translation.y).toBeCloseTo(0, 9);
    expect(move.translation.z).toBeCloseTo(0, 9);
    expect(validateDesign(applied(design, ['b0'], move.translation))).toEqual([]);
  });

  it('leaves every vertex it was not asked to move exactly where it was', () => {
    const design = baseAndWall();
    const move = constrainVertexMove(design, 'b0', at(-2, 1, 1));
    const after = applied(design, ['b0'], move.translation);
    for (const before of design.vertices) {
      if (before.id === 'b0') continue;
      const now = after.vertices.find((v) => v.id === before.id)!;
      expect(now.position).toEqual(before.position);
    }
  });

  it('keeps an edge drag flat across every affected face', () => {
    const design = box();
    const move = constrainTranslation(design, ['b0', 'b1'], at(0.5, 1, 0.8));
    const after = applied(design, ['b0', 'b1'], move.translation);
    expect(validateDesign(after).filter((i) => i.constraint === 9)).toEqual([]);
    expect(V.length(move.translation)).toBeGreaterThan(0);
  });

  it('reports a pinned corner as pinned, and moves nothing', () => {
    const move = constrainVertexMove(box(), 'b0', at(1, 1, 1));
    expect(move.freedom.dof).toBe(0);
    expect(move.translation).toEqual(at(0, 0, 0));
  });

  it('refuses to move a locked vertex however free it would otherwise be', () => {
    const design = pyramid();
    design.vertices = design.vertices.map((v) => (v.id === 'apex' ? { ...v, locked: true } : v));
    const move = constrainVertexMove(design, 'apex', at(3, 3, 6));
    expect(move.translation).toEqual(at(0, 0, 0));
  });
});

describe('validity limits how far, not which way', () => {
  it('stops a drag before it collapses a face to a sliver', () => {
    const design = pyramid();
    // Dragging the apex onto the line through b0-b1 would leave that side face with three
    // collinear corners: still a loop, but enclosing nothing and uncuttable.
    const move = constrainVertexMove(design, 'apex', at(2, 0, 0));
    expect(move.freedom.dof).toBe(3); // planarity allows it...
    expect(move.limitedByValidity).toBe(true); // ...but that side would vanish
    const after = applied(design, ['apex'], move.translation);
    expect(validateDesign(after).filter((i) => i.constraint === 6)).toEqual([]);
    // It still travelled nearly all the way there before stopping.
    expect(after.vertices.find((v) => v.id === 'apex')!.position.y).toBeLessThan(0.05);
  });

  it('lets the apex drop flat into the base plane, which is degenerate-looking but legal', () => {
    // Worth pinning down, because it is the case that *looks* like a collapse and isn't:
    // the four sides stay real triangles, they just end up coplanar with the base.
    const design = pyramid();
    const move = constrainVertexMove(design, 'apex', at(2, 2, 0));
    expect(move.limitedByValidity).toBe(false);
    const after = applied(design, ['apex'], move.translation);
    expect(after.vertices.find((v) => v.id === 'apex')!.position.z).toBeCloseTo(0, 9);
    expect(validateDesign(after).filter((i) => i.constraint === 6)).toEqual([]);
  });

  it('leaves an ordinary move unlimited', () => {
    const move = constrainVertexMove(pyramid(), 'apex', at(2.5, 2.2, 5.4));
    expect(move.limitedByValidity).toBe(false);
    expect(move.translation.x).toBeCloseTo(0.5, 9);
  });
});

describe('describeFreedom', () => {
  it('says what is holding a vertex, so a refusal is not a mystery', () => {
    expect(describeFreedom(freedomForTranslation(pyramid(), ['apex']))).toMatch(/Free/);
    expect(describeFreedom(freedomForTranslation(baseAndWall(), ['b2']))).toMatch(/plane.*Base/);
    expect(describeFreedom(freedomForTranslation(baseAndWall(), ['b0']))).toMatch(/line/);
    const pinned = describeFreedom(freedomForTranslation(box(), ['b0']));
    expect(pinned).toMatch(/Pinned/);
    expect(pinned).toMatch(/Splitting/);
  });
});
