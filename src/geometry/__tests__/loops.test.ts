import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../types';
import type { Design, Vec3 } from '../types';
import { addEdge, withFaceEdges } from '../edges';
import { loopClosedByEdge, loopIsCoplanar } from '../loops';

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
    const loop = loopClosedByEdge(design, 'd', 'a');
    expect(loop).not.toBeNull();
    expect(new Set(loop!)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('finds nothing while the outline is still open', () => {
    const design = openSquare();
    expect(loopClosedByEdge(design, 'c', 'd')).toBeNull();
  });

  it('finds nothing for an edge that dead-ends', () => {
    let design = openSquare();
    design.vertices.push({ id: 'spur', position: at(8, 2, 0) });
    design = addEdge(design, 'b', 'spur');
    expect(loopClosedByEdge(design, 'b', 'spur')).toBeNull();
  });

  it('finds a triangle', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(3, 0, 0)],
      ['c', at(0, 3, 0)],
    ]);
    design = addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'a');
    expect(new Set(loopClosedByEdge(design, 'c', 'a')!)).toEqual(new Set(['a', 'b', 'c']));
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
    expect(loopClosedByEdge(design, 'g', 'b')).toBeNull();
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
    const loop = loopClosedByEdge(quadWithChord(), 'a', 'c');
    expect(loop?.length !== 4).toBe(true);
  });

  it('leaves a chord across an existing face to the split operation', () => {
    // Drawing a chord closes *two* equally small triangles at once, and both of them are
    // real. That is not a loop to be discovered, it is a face being divided — so detection
    // stands aside and `splitFace` handles it, which is also what keeps the parent's label,
    // holes and angle locks from being silently thrown away.
    expect(loopClosedByEdge(quadWithChord(), 'a', 'c')).toBeNull();
  });

  it('does not resurrect the outline when another of its edges is redrawn', () => {
    const design = quadWithChord();
    const loop = loopClosedByEdge(design, 'd', 'a');
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
    expect(loopClosedByEdge(design, 'd', 'a')).toBeNull();
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
    expect(loopClosedByEdge(design, 'd', 'a')).not.toBeNull();
  });

  it('refuses a loop of three collinear points, which encloses nothing', () => {
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(2, 0, 0)],
      ['c', at(4, 0, 0)],
    ]);
    design = addEdge(addEdge(addEdge(design, 'a', 'b'), 'b', 'c'), 'c', 'a');
    expect(loopClosedByEdge(design, 'c', 'a')).toBeNull();
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
    expect(loopClosedByEdge(design, 'd', 'a')).toBeNull();
  });
});

describe('ambiguity is left to the user', () => {
  it('creates nothing when two equally small loops close at once', () => {
    // Two triangles sharing the edge a-b, mirrored either side of it. Drawing a-b last
    // closes both simultaneously and there is no reason to prefer either.
    let design = withVertices([
      ['a', at(0, 0, 0)],
      ['b', at(4, 0, 0)],
      ['left', at(2, 3, 0)],
      ['right', at(2, -3, 0)],
    ]);
    design = addEdge(addEdge(design, 'a', 'left'), 'left', 'b');
    design = addEdge(addEdge(design, 'a', 'right'), 'right', 'b');
    design = addEdge(design, 'a', 'b');
    expect(loopClosedByEdge(design, 'a', 'b')).toBeNull();
  });
});
