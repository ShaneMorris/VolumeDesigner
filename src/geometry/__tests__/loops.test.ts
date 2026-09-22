import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design, Vec3 } from '../types';
import { addEdge, withFaceEdges } from '../edges';
import { validateDesign } from '../validate';
import { loopsClosedByEdge, loopIsCoplanar, faceFromNewEdge } from '../loops';

/** The single loop a new edge closed, for the cases where exactly one is expected. */
const oneLoop = (...args: Parameters<typeof loopsClosedByEdge>) => {
  const loops = loopsClosedByEdge(...args);
  return loops.length === 1 ? loops[0] : null;
};

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function withVertices(entries: Array<[string, Vec3]>): Design {
  const design = createEmptyDesign();
  design.vertices = entries.map(([id, position]) => ({ id, position }));
  return design;
}

/** Three sides of a square drawn but not yet closed: a-b, b-c, c-d. */
function openSquare(): Design {
  let design = withVertices([
    ['a', at(0, 0, 0)],
    ['b', at(4, 0, 0)],
    ['c', at(4, 4, 0)],
    ['d', at(0, 4, 0)],
  ]);
  design = addEdge(design, 'a', 'b');
  design = addEdge(design, 'b', 'c');
  design = addEdge(design, 'c', 'd');
  return design;
}

describe('a face appears when edges enclose something', () => {
  it('finds the square the closing edge completed', () => {
    const design = addEdge(openSquare(), 'd', 'a');
    const loop = oneLoop(design, 'd', 'a');
    expect(loop).not.toBeNull();
    expect(new Set(loop!)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('finds nothing while the outline is still open', () => {
    const design = openSquare();
    expect(oneLoop(design, 'c', 'd')).toBeNull();
  });

  it('finds nothing for an edge that dead-ends', () => {
    let design = openSquare();
    design.vertices.push({ id: 'spur', position: at(8, 2, 0) });
    design = addEdge(design, 'b', 'spur');
    expect(oneLoop(design, 'b', 'spur')).toBeNull();
  });

  it('finds a triangle', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(3, 0, 0)],
      ['c', at(0, 3, 0)],
    ]);
    design = addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'a');
    expect(new Set(oneLoop(design, 'c', 'a')!)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('will not put a third face on an edge that already has two', () => {
    // A closed box has every edge fully spoken for; nothing new may attach to one.
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['c', at(4, 4, 0)],
      ['d', at(0, 4, 0)],
      ['e', at(0, 0, 3)],
      ['f', at(4, 0, 3)],
    ]);
    design.faces = [
      { id: 'base', vertexIds: ['a', 'b', 'c', 'd'], label: 'Base' },
      { id: 'w1', vertexIds: ['a', 'b', 'f', 'e'], label: 'W1' },
    ];
    design = withFaceEdges(design);
    // A third loop through a-b would need that edge a third time.
    design.vertices.push({ id: 'g', position: at(2, -3, 0) });
    design = addEdge(addEdge(design, 'a', 'g'), 'g', 'b');
    expect(oneLoop(design, 'g', 'b')).toBeNull();
  });
});

describe('the smallest loop wins', () => {
  /** A quad with a chord drawn across it, corner to corner. */
  function quadWithChord(): Design {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['c', at(4, 4, 0)],
      ['d', at(0, 4, 0)],
    ]);
    design = addEdge(addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'd'), 'd', 'a');
    design.faces = [{ id: 'quad', vertexIds: ['a', 'b', 'c', 'd'], label: 'Quad' }];
    return addEdge(design, 'a', 'c'); // the chord
  }

  it('never returns the outline a chord now crosses', () => {
    // The 4-corner loop has a chord across it, so it is no longer a minimal loop and is
    // not a panel: whatever comes back, it is not that.
    const loop = oneLoop(quadWithChord(), 'a', 'c');
    expect(loop?.length !== 4).toBe(true);
  });

  it('leaves a chord across an existing face to the split operation', () => {
    // Detection would find the two halves, but a chord across a face that already exists
    // is that face being *divided*, and the parent owns a label, holes and angle locks
    // that have to be handed on. So the routing sends it to `splitFace` and never asks
    // the loop finder at all.
    let counter = 0;
    const result = faceFromNewEdge(quadWithChord(), 'a', 'c', () => `s${++counter}`);
    expect(result.created.length).toBe(2);
    expect(result.design.faces.some((f) => f.id === 'quad')).toBe(false); // divided, not added to
  });

  it('does not resurrect the outline when another of its edges is redrawn', () => {
    const design = quadWithChord();
    const loop = oneLoop(design, 'd', 'a');
    expect(loop === null || loop.length === 3).toBe(true);
  });
});

describe('a loop has to be a real panel', () => {
  it('refuses a loop whose corners are not coplanar', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['c', at(4, 4, 2)], // lifted out of the plane of the other three
      ['d', at(0, 4, 0)],
    ]);
    design = addEdge(addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'd'), 'd', 'a');
    expect(loopIsCoplanar(design, ['a', 'b', 'c', 'd'])).toBe(false);
    expect(oneLoop(design, 'd', 'a')).toBeNull();
  });

  it('accepts a coplanar loop that is not axis-aligned', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 4)],
      ['c', at(4, 4, 4)],
      ['d', at(0, 4, 0)],
    ]);
    design = addEdge(addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'd'), 'd', 'a');
    expect(loopIsCoplanar(design, ['a', 'b', 'c', 'd'])).toBe(true);
    expect(oneLoop(design, 'd', 'a')).not.toBeNull();
  });

  it('refuses a loop of three collinear points, which encloses nothing', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(2, 0, 0)],
      ['c', at(4, 0, 0)],
    ]);
    design = addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'a');
    expect(oneLoop(design, 'c', 'a')).toBeNull();
  });

  it('does not re-find a face that already exists', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['c', at(4, 4, 0)],
      ['d', at(0, 4, 0)],
    ]);
    design.faces = [{ id: 'q', vertexIds: ['a', 'b', 'c', 'd'], label: 'Q' }];
    design = withFaceEdges(design);
    expect(oneLoop(design, 'd', 'a')).toBeNull();
  });
});

describe('an edge can close two faces at once', () => {
  let counter = 0;
  const makeId = () => `f${++counter}`;

  /** Two triangles waiting on one shared edge, mirrored either side of it. */
  function twoPending(): Design {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['left', at(2, 3, 0)],
      ['right', at(2, -3, 0)],
    ]);
    design = addEdge(addEdge(design, 'a', 'left'), 'left', 'b');
    design = addEdge(addEdge(design, 'a', 'right'), 'right', 'b');
    return addEdge(design, 'a', 'b');
  }

  it('reports both loops rather than calling them ambiguous', () => {
    // Both are real faces. Constraint 10 caps this edge at two, so two is the most that
    // can ever be right here and is never a guess.
    expect(loopsClosedByEdge(twoPending(), 'a', 'b').length).toBe(2);
  });

  it('creates both of them', () => {
    const result = faceFromNewEdge(twoPending(), 'a', 'b', makeId);
    expect(result.created.length).toBe(2);
    expect(result.design.faces.length).toBe(2);
    const sizes = result.design.faces.map((f) => f.vertexIds.length);
    expect(sizes).toEqual([3, 3]);
  });

  it('completes a tetrahedron, which is the case that first exposed this', () => {
    // A triangular base with an apex, three of the four faces already made, and the last
    // edge drawn between the apex and the free base corner. It closes a triangle on each
    // side of itself; both were being discarded as "ambiguous", leaving a shell with two
    // faces missing and no way to tell from the viewport.
    let design = withVertices([
      ['b1', at(6, -3.46, 0)],
      ['b2', at(0, 6.93, 0)],
      ['b3', at(-7.29, -5.15, 0)],
      ['apex', at(-1.12, 1.0, 5.89)],
    ]);
    for (const [x, y] of [
      ['b1', 'b2'],
      ['b2', 'b3'],
      ['b3', 'b1'],
      ['b1', 'apex'],
      ['apex', 'b3'],
    ] as Array<[string, string]>) {
      design = addEdge(design, x, y);
    }
    design.faces = [
      { id: 'base', vertexIds: ['b1', 'b2', 'b3'], label: 'Base' },
      { id: 'side', vertexIds: ['apex', 'b1', 'b3'], label: 'Side 2' },
    ];
    design = addEdge(design, 'apex', 'b2');

    const result = faceFromNewEdge(design, 'apex', 'b2', makeId);
    expect(result.created.length).toBe(2);
    expect(result.design.faces.length).toBe(4); // a closed tetrahedron
    expect(validateDesign(result.design)).toEqual([]);
  });

  it('stops at two, since a third cannot attach to the same edge', () => {
    // A fin: three triangles all wanting the same edge. Which two would be a guess.
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['p', at(2, 3, 0)],
      ['q', at(2, -3, 0)],
      ['r', at(2, 0, 3)],
    ]);
    for (const [x, y] of [
      ['a', 'p'],
      ['p', 'b'],
      ['a', 'q'],
      ['q', 'b'],
      ['a', 'r'],
      ['r', 'b'],
    ] as Array<[string, string]>) {
      design = addEdge(design, x, y);
    }
    design = addEdge(design, 'a', 'b');
    expect(loopsClosedByEdge(design, 'a', 'b').length).toBe(3);
    expect(faceFromNewEdge(design, 'a', 'b', makeId).created).toEqual([]);
  });
});
