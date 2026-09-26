import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDesign, BASE_PLANE_Z } from '../types';
import type { Design, Vec3 } from '../types';
import { withFaceEdges } from '../edges';
import { constrainTranslation, constrainVertexMove, freedomForTranslation } from '../constrain';
import { validateDesign } from '../validate';
import { dihedralAngleDeg, findSharedEdge } from '../mesh';
import { useDesignStore } from '../../store/designStore';

/**
 * The base face is the base plane (requirements §3, constraint 11).
 *
 * Reported from use: a base corner could be dragged up off the plane. Constraint 9 never
 * covered this and could not have. A triangular base imposes no planarity equation at all,
 * since any three points are coplanar; a rectangular one imposes none on a whole edge,
 * since the corners staying behind run parallel to the pair moving. Both were liftable.
 * Measured before the fix: a triangular base's corner and edge, and a square base's edge,
 * all took a 3in lift in full.
 */

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const state = () => useDesignStore.getState();
const zOf = (id: string) => state().design.vertices.find((v) => v.id === id)!.position.z;

/** A triangular base with one wall standing on it — the shape from the report. */
function triangularBase(): Design {
  const design: Design = {
    ...createEmptyDesign(),
    vertices: [
      { id: 'a', position: at(-4, -3, 0) },
      { id: 'b', position: at(4, -3, 0) },
      { id: 'c', position: at(0, 4, 0) },
      { id: 'apex', position: at(0, 0, 5) },
    ],
    faces: [
      { id: 'base', vertexIds: ['a', 'b', 'c'], label: 'Base' },
      { id: 'wall', vertexIds: ['a', 'b', 'apex'], label: 'Wall' },
    ],
    baseFaceId: 'base',
  };
  return withFaceEdges(design);
}

/** A square base, alone. */
function squareBase(): Design {
  const design: Design = {
    ...createEmptyDesign(),
    vertices: [
      { id: 'a', position: at(-4, -4, 0) },
      { id: 'b', position: at(4, -4, 0) },
      { id: 'c', position: at(4, 4, 0) },
      { id: 'd', position: at(-4, 4, 0) },
    ],
    faces: [{ id: 'base', vertexIds: ['a', 'b', 'c', 'd'], label: 'Base' }],
    baseFaceId: 'base',
  };
  return withFaceEdges(design);
}

describe('a base corner cannot be lifted off the base plane', () => {
  it('refuses the lift on a triangular base, which nothing else was holding', () => {
    const design = triangularBase();
    expect(constrainVertexMove(design, 'a', at(-4, -3, 3)).translation.z).toBeCloseTo(0, 12);
  });

  it('refuses it on a square base too', () => {
    const design = squareBase();
    expect(constrainVertexMove(design, 'a', at(-4, -4, 3)).translation.z).toBeCloseTo(0, 12);
  });

  it('still lets the corner slide about within the plane', () => {
    // The rule is about leaving the plane, not about moving. A triangular base's corner
    // has the whole plane to roam.
    const design = triangularBase();
    const moved = constrainVertexMove(design, 'c', at(2, 6, 0)).translation;
    expect(moved.x).toBeCloseTo(2, 9); // c starts at (0, 4, 0)
    expect(moved.y).toBeCloseTo(2, 9);
    expect(moved.z).toBeCloseTo(0, 12);
  });

  it('keeps the sideways part of a drag that also tried to lift', () => {
    // A drag is redirected, not refused: the vertical component is dropped and the rest
    // goes through, which is how every other constraint here behaves.
    const design = triangularBase();
    const moved = constrainVertexMove(design, 'c', at(0, 6, 4)).translation;
    expect(moved.y).toBeCloseTo(2, 9);
    expect(moved.z).toBeCloseTo(0, 12);
  });

  it('leaves the plane as one of the two directions a base corner may use', () => {
    const freedom = freedomForTranslation(triangularBase(), ['c']);
    expect(freedom.dof).toBe(2);
    for (const direction of freedom.basis) expect(Math.abs(direction.z)).toBeCloseTo(0, 9);
    expect(freedom.holdingFaceLabels).toContain('Base');
  });

  it('does not hold a vertex that merely sits at the same height', () => {
    // The rule is about belonging to the base face, not about being level with it.
    const design = triangularBase();
    design.vertices.push({ id: 'loose', position: at(8, 0, 0) });
    expect(freedomForTranslation(design, ['loose']).dof).toBe(3);
  });

  it('leaves a vertex that is not on the base alone', () => {
    expect(freedomForTranslation(triangularBase(), ['apex']).dof).toBe(3);
  });
});

describe('a whole base edge cannot be lifted either', () => {
  it('refuses the lift on a triangular base', () => {
    const design = triangularBase();
    expect(constrainTranslation(design, ['a', 'b'], at(0, 0, 3)).translation.z).toBeCloseTo(0, 12);
  });

  it('refuses it on a square base, where the opposite side gave no equation at all', () => {
    // This is the case the planarity rule could never have caught: the two corners staying
    // behind run parallel to the two moving, so the face stays flat however far it is
    // lifted. It was liftable on a *square* base, not only a triangular one.
    const design = squareBase();
    expect(constrainTranslation(design, ['a', 'b'], at(0, 0, 3)).translation.z).toBeCloseTo(0, 12);
  });

  it('still slides the edge across the plane', () => {
    const design = squareBase();
    const moved = constrainTranslation(design, ['a', 'b'], at(0, 2, 3)).translation;
    expect(moved.y).toBeCloseTo(2, 9);
    expect(moved.z).toBeCloseTo(0, 12);
  });
});

describe('a corner that has already drifted is brought back', () => {
  it('returns it to the plane the first time it is touched', () => {
    // Stated as "z = 0" rather than "don't change z", so a design saved by a version that
    // let it drift is repaired by use rather than preserved.
    const design = triangularBase();
    design.vertices[2] = { id: 'c', position: at(0, 4, 1.25) };
    const moved = constrainVertexMove(design, 'c', at(0, 5, 1.25)).translation;
    expect(moved.z).toBeCloseTo(-1.25, 9);
  });
});

describe('through the store, as a drag arrives', () => {
  beforeEach(() => state().loadDesign(triangularBase()));

  it('holds a base corner down however hard the drag pulls up', () => {
    state().moveVertex('a', at(-4, -3, 9), { commit: true });
    expect(zOf('a')).toBeCloseTo(BASE_PLANE_Z, 12);
  });

  it('holds it for a Shift drag, which asks for nothing else', () => {
    // A vertical drag sends a pure-Z target. It has nowhere to go and the vertex stays put.
    state().moveVertex('a', at(-4, -3, 4), { commit: true });
    expect(state().design.vertices.find((v) => v.id === 'a')!.position).toEqual(at(-4, -3, 0));
  });

  it('holds a base edge down too', () => {
    state().moveEdgeBy('a', 'b', at(0, 0, 3), { commit: true });
    expect(zOf('a')).toBeCloseTo(0, 12);
    expect(zOf('b')).toBeCloseTo(0, 12);
  });

  it('leaves the design valid', () => {
    state().moveVertex('c', at(0, 7, 5), { commit: true });
    expect(validateDesign(state().design)).toEqual([]);
  });
});

describe('an angle lock never rotates the base', () => {
  beforeEach(() => state().loadDesign(triangularBase()));

  it('turns the other face instead when asked to turn the base', () => {
    // Which face a lock rotates comes from the order the two happen to sit in, so the base
    // can be picked as the one to turn. Before this it tilted, and the base came off the
    // plane without anything being dragged at all.
    state().lockDihedralAngle('wall', 'base', 60);
    for (const id of ['a', 'b', 'c']) expect(zOf(id)).toBeCloseTo(BASE_PLANE_Z, 9);
  });

  it('reaches the angle that was asked for anyway', () => {
    // Nothing is given up by refusing: a dihedral angle belongs to the pair of faces, so
    // it is reached just as well by turning either one of them.
    state().lockDihedralAngle('wall', 'base', 60);
    const design = state().design;
    const edge = findSharedEdge(design, 'wall', 'base')!;
    expect(dihedralAngleDeg(design, edge)).toBeCloseTo(60, 6);
  });

  it('moves the face that should have moved', () => {
    state().lockDihedralAngle('wall', 'base', 60);
    expect(zOf('apex')).not.toBeCloseTo(5, 3);
  });

  it('agrees with a lock named the other way round', () => {
    state().lockDihedralAngle('wall', 'base', 60);
    const asked = state().design.vertices.find((v) => v.id === 'apex')!.position;

    state().loadDesign(triangularBase());
    state().lockDihedralAngle('base', 'wall', 60);
    const natural = state().design.vertices.find((v) => v.id === 'apex')!.position;

    expect(asked.x).toBeCloseTo(natural.x, 9);
    expect(asked.y).toBeCloseTo(natural.y, 9);
    expect(asked.z).toBeCloseTo(natural.z, 9);
  });
});

describe('a design that arrives with its base off the plane', () => {
  it('is reported rather than passed off as sound', () => {
    const design = triangularBase();
    design.vertices[1] = { id: 'b', position: at(4, -3, 0.75) };
    const issues = validateDesign(design).filter((i) => i.constraint === 11);
    expect(issues.length).toBe(1);
    expect(issues[0].vertexId).toBe('b');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('base plane');
  });

  it('says nothing about a base that is where it should be', () => {
    expect(validateDesign(triangularBase()).filter((i) => i.constraint === 11)).toEqual([]);
  });

  it('says nothing when no face has been made the base', () => {
    const design = triangularBase();
    design.baseFaceId = null;
    design.vertices[1] = { id: 'b', position: at(4, -3, 0.75) };
    expect(validateDesign(design).filter((i) => i.constraint === 11)).toEqual([]);
  });
});

describe('putting a drifted base back', () => {
  /** A base saved by a version that let it drift, as a whole design. */
  function drifted(): Design {
    const design = triangularBase();
    design.vertices[0] = { id: 'a', position: at(-4, -3, 1.5) };
    design.vertices[2] = { id: 'c', position: at(0, 4, -0.5) };
    return design;
  }

  beforeEach(() => state().loadDesign(drifted()));

  it('reports the drift on opening, rather than quietly correcting it', () => {
    expect(state().designIssues.filter((i) => i.constraint === 11).length).toBe(2);
  });

  it('settles every base corner onto the plane when asked', () => {
    state().settleBaseOntoPlane();
    for (const id of ['a', 'b', 'c']) expect(zOf(id)).toBe(BASE_PLANE_Z);
    expect(state().designIssues.filter((i) => i.constraint === 11)).toEqual([]);
  });

  it('keeps the footprint the user drew — only the height changes', () => {
    state().settleBaseOntoPlane();
    const a = state().design.vertices.find((v) => v.id === 'a')!.position;
    expect(a.x).toBe(-4);
    expect(a.y).toBe(-3);
  });

  it('leaves everything that is not on the base where it was', () => {
    const apex = { ...state().design.vertices.find((v) => v.id === 'apex')!.position };
    state().settleBaseOntoPlane();
    expect(state().design.vertices.find((v) => v.id === 'apex')!.position).toEqual(apex);
  });

  it('is a single undo step', () => {
    state().settleBaseOntoPlane();
    state().undo();
    expect(zOf('a')).toBeCloseTo(1.5, 9);
  });
});
