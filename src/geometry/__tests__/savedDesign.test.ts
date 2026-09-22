import { describe, expect, it } from 'vitest';
import { normalizeDesign } from '../normalize';
import { faceFromNewEdge } from '../loops';
import { removeEdgeKeys } from '../edges';
import { edgeKey } from '../types';
import { validateDesign } from '../validate';

/**
 * The design Shane saved when two faces failed to appear, inlined exactly as exported.
 *
 * Four vertices and six edges — a complete tetrahedron's worth of connectivity — but only
 * two faces. The last edge drawn, apex to the free base corner, closes a triangle either
 * side of itself, and both were being discarded as an ambiguity.
 */
const SAVED = {
  "vertices": [
    {
      "id": "v_mud4p1ug_1",
      "position": {
        "x": 5.999999999999998,
        "y": -3.464101615137754,
        "z": 0
      }
    },
    {
      "id": "v_mud4p1ug_2",
      "position": {
        "x": 1.9626002445968135e-15,
        "y": 6.928203230275508,
        "z": 0
      }
    },
    {
      "id": "v_mud4p1ug_3",
      "position": {
        "x": -7.294604918679159,
        "y": -5.154910583760006,
        "z": 0
      }
    },
    {
      "id": "v_mud4pja8_5",
      "position": {
        "x": -1.1151552232174917,
        "y": 0.998151372227194,
        "z": 5.889271868229173
      }
    }
  ],
  "edges": [
    {
      "a": "v_mud4p1ug_1",
      "b": "v_mud4p1ug_2"
    },
    {
      "a": "v_mud4p1ug_2",
      "b": "v_mud4p1ug_3"
    },
    {
      "a": "v_mud4p1ug_3",
      "b": "v_mud4p1ug_1"
    },
    {
      "a": "v_mud4p1ug_1",
      "b": "v_mud4pja8_5"
    },
    {
      "a": "v_mud4pja8_5",
      "b": "v_mud4p1ug_3"
    },
    {
      "a": "v_mud4pja8_5",
      "b": "v_mud4p1ug_2"
    }
  ],
  "faces": [
    {
      "id": "f_mud4p1ug_4",
      "vertexIds": [
        "v_mud4p1ug_1",
        "v_mud4p1ug_2",
        "v_mud4p1ug_3"
      ],
      "label": "Base"
    },
    {
      "id": "f_mud4pmcw_6",
      "vertexIds": [
        "v_mud4pja8_5",
        "v_mud4p1ug_1",
        "v_mud4p1ug_3"
      ],
      "label": "Side 2"
    }
  ],
  "holes": [],
  "angleLocks": [],
  "panelThicknessIn": 0.75,
  "baseFaceId": "f_mud4p1ug_4",
  "basePlaneSizeIn": 24
};

describe('the saved design that had two faces missing', () => {
  const raw = SAVED;

  it('loads with the faces it was saved with', () => {
    const { design, issues } = normalizeDesign(raw);
    expect(design.vertices.length).toBe(4);
    expect(design.edges.length).toBe(6);
    expect(design.faces.length).toBe(2); // the two that did get made
    expect(issues).toEqual([]); // nothing invalid about it — just incomplete
  });

  it('recovers the file as it stands: drawing that edge over the top fills both faces in', () => {
    // The practical question — the edge is already in the saved file, so does redrawing it
    // do anything? It does: the edge already existing is a no-op, but the detection that
    // follows it is not, and that is what was broken rather than anything about the edge.
    const { design } = normalizeDesign(raw);
    const apex = design.vertices.find((v) => v.position.z > 1)!.id;
    const free = design.vertices.find(
      (v) =>
        v.position.z === 0 &&
        !design.faces.some((f) => f.vertexIds.includes(v.id) && f.vertexIds.includes(apex)),
    )!.id;

    let counter = 0;
    const result = faceFromNewEdge(design, apex, free, () => `r${++counter}`);
    expect(result.created.length).toBe(2);
    expect(result.design.faces.length).toBe(4);
    expect(result.design.edges.length).toBe(6); // no duplicate edge added
    expect(validateDesign(result.design)).toEqual([]);
  });

  it('makes both missing faces when that last edge is drawn again', () => {
    const { design } = normalizeDesign(raw);
    const apex = design.vertices.find((v) => v.position.z > 1)!.id;
    // The free corner: the one the apex reaches but no face uses with it.
    const free = design.vertices.find(
      (v) => v.position.z === 0 && !design.faces.some((f) => f.vertexIds.includes(v.id) && f.vertexIds.includes(apex)),
    )!.id;

    // Rewind that edge and draw it again.
    const before = removeEdgeKeys(design, new Set([edgeKey(apex, free)]));
    expect(before.edges.length).toBe(5);

    let counter = 0;
    const result = faceFromNewEdge(
      { ...before, edges: [...before.edges, { a: apex, b: free }] },
      apex,
      free,
      () => `f${++counter}`,
    );

    expect(result.created.length).toBe(2);
    expect(result.design.faces.length).toBe(4);
    expect(validateDesign(result.design)).toEqual([]);

    // Every edge of a closed tetrahedron carries exactly two faces.
    for (const e of result.design.edges) {
      const uses = result.design.faces.filter((f) =>
        f.vertexIds.some((id, i) => {
          const next = f.vertexIds[(i + 1) % f.vertexIds.length];
          return edgeKey(id, next) === edgeKey(e.a, e.b);
        }),
      );
      expect(uses.length).toBe(2);
    }
  });
});
