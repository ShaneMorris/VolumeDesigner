import { describe, expect, it } from 'vitest';
import { createEmptyDesign } from '../../geometry/types';
import type { Design, Vec3 } from '../../geometry/types';
import { withFaceEdges } from '../../geometry/edges';
import { unfoldAllFaces, layoutPanelsOnSheet } from '../../geometry/unfold';
import { applyMiterCorrection } from '../../geometry/miter';
import { panelToDxfString, combinedDxfString } from '../dxf';
import { V } from '../../geometry/vec3';

/**
 * Reads exported DXF back and checks it measures what the model says.
 *
 * Every other test here works on the geometry in memory; this one works on the bytes that
 * actually leave the app, which is where the failures have historically been. The import
 * that broke before wasn't wrong geometry — it was correct numbers written in a notation
 * DXF readers reject. Only parsing the output catches that class of thing.
 *
 * It cannot say whether the miter convention matches a real cut part. That needs plywood.
 */

interface ParsedDxf {
  header: Record<string, number>;
  polylines: Array<{ points: Array<{ x: number; y: number }>; closed: boolean }>;
  circles: Array<{ center: { x: number; y: number }; radius: number }>;
}

/** A deliberately literal R12 reader: pairs of (group code, value), walked in order. */
function parseDxf(text: string): ParsedDxf {
  const lines = text.split(/\r\n|\n/);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }

  const out: ParsedDxf = { header: {}, polylines: [], circles: [] };
  let pendingVar: string | null = null;
  let polyline: ParsedDxf['polylines'][number] | null = null;
  let vertex: { x?: number; y?: number } | null = null;
  let circle: { x?: number; y?: number; r?: number } | null = null;

  const closeCircle = () => {
    if (circle && circle.x !== undefined && circle.y !== undefined && circle.r !== undefined) {
      out.circles.push({ center: { x: circle.x, y: circle.y }, radius: circle.r });
    }
    circle = null;
  };
  const closeVertex = () => {
    if (polyline && vertex && vertex.x !== undefined && vertex.y !== undefined) {
      polyline.points.push({ x: vertex.x, y: vertex.y });
    }
    vertex = null;
  };

  for (const [code, value] of pairs) {
    if (code === 9) {
      pendingVar = value;
      continue;
    }
    if (code === 0) {
      closeVertex();
      closeCircle();
      if (value === 'POLYLINE') {
        polyline = { points: [], closed: false };
        out.polylines.push(polyline);
      } else if (value === 'VERTEX') {
        vertex = {};
      } else if (value === 'SEQEND') {
        polyline = null;
      } else if (value === 'CIRCLE') {
        circle = {};
      }
      continue;
    }

    if (pendingVar && code === 70) {
      out.header[pendingVar] = Number.parseFloat(value);
      pendingVar = null;
      continue;
    }
    if (pendingVar && (code === 10 || code === 20 || code === 30 || code === 1)) {
      pendingVar = null; // header vars we don't assert on
      continue;
    }

    if (vertex) {
      if (code === 10) vertex.x = Number.parseFloat(value);
      if (code === 20) vertex.y = Number.parseFloat(value);
    } else if (circle) {
      if (code === 10) circle.x = Number.parseFloat(value);
      if (code === 20) circle.y = Number.parseFloat(value);
      if (code === 40) circle.r = Number.parseFloat(value);
    } else if (polyline && code === 70) {
      polyline.closed = (Number.parseInt(value, 10) & 1) === 1;
    }
  }
  closeVertex();
  closeCircle();
  return out;
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A base with one wall leaning back at 45°.
 *
 * Chosen because its slanted edge is 5.657in long but only 4in across in plan, so a panel
 * measuring 4 would mean the unfolder had projected the face instead of flattening it —
 * which is the difference the whole tool exists to get right.
 */
function leaningWall(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: at(0, 0, 0) },
    { id: 'b1', position: at(10, 0, 0) },
    { id: 'b2', position: at(10, 10, 0) },
    { id: 'b3', position: at(0, 10, 0) },
    { id: 't0', position: at(0, 4, 4) },
    { id: 't1', position: at(10, 4, 4) },
  ];
  design.faces = [
    { id: 'base', vertexIds: ['b0', 'b1', 'b2', 'b3'], label: 'Base' },
    { id: 'wall', vertexIds: ['b0', 'b1', 't1', 't0'], label: 'Wall' },
  ];
  design.baseFaceId = 'base';
  return withFaceEdges(design);
}

function box(): Design {
  const design = createEmptyDesign();
  design.vertices = [
    { id: 'b0', position: at(0, 0, 0) },
    { id: 'b1', position: at(12, 0, 0) },
    { id: 'b2', position: at(12, 8, 0) },
    { id: 'b3', position: at(0, 8, 0) },
    { id: 't0', position: at(0, 0, 5) },
    { id: 't1', position: at(12, 0, 5) },
    { id: 't2', position: at(12, 8, 5) },
    { id: 't3', position: at(0, 8, 5) },
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

function exportedPanels(design: Design) {
  return layoutPanelsOnSheet(unfoldAllFaces(design));
}

describe('what the file says about its units', () => {
  it('declares inches and imperial measurement', () => {
    const panels = exportedPanels(leaningWall());
    const parsed = parseDxf(panelToDxfString(panels[0]));
    expect(parsed.header.$INSUNITS).toBe(1); // 1 = inches
    expect(parsed.header.$MEASUREMENT).toBe(0); // 0 = imperial
  });

  it('writes every real as plain decimal, never exponent notation', () => {
    // The regression that made files unreadable: a near-zero coordinate serialized as
    // 5.551115123125783e-17. DXF readers expect plain decimals and reject that outright.
    const design = leaningWall();
    const text = combinedDxfString(exportedPanels(design));
    expect(text).not.toMatch(/[0-9][eE][+-]?[0-9]/);
  });
});

describe('panels come out at their true size, not their shadow', () => {
  it('measures the leaning wall by its real slope, not its footprint', () => {
    const panels = exportedPanels(leaningWall());
    const wall = panels.find((p) => p.label === 'Wall')!;
    const parsed = parseDxf(panelToDxfString(wall));
    const outline = parsed.polylines[0].points;

    // b1 -> t1 climbs 4in and leans back 4in: 5.657in of material, 4in of floor.
    const trueLength = Math.hypot(4, 4);
    const sides = outline.map((p, i) => dist2(p, outline[(i + 1) % outline.length]));
    expect(sides.some((s) => Math.abs(s - trueLength) < 1e-6)).toBe(true);
    expect(sides.some((s) => Math.abs(s - 4) < 1e-6)).toBe(false); // the projected length
  });

  it('matches every exported side to the 3D edge it came from', () => {
    const design = box();
    const panels = exportedPanels(design);
    const pos = (id: string) => design.vertices.find((v) => v.id === id)!.position;

    for (const panel of panels) {
      const outline = parseDxf(panelToDxfString(panel)).polylines[0].points;
      expect(outline.length).toBe(panel.outline.length);
      for (const edge of panel.edges) {
        const a = outline[edge.index];
        const b = outline[(edge.index + 1) % outline.length];
        expect(dist2(a, b)).toBeCloseTo(V.distance(pos(edge.aVertexId), pos(edge.bVertexId)), 9);
      }
    }
  });

  it('closes every outline, so the panel is a cuttable profile', () => {
    for (const panel of exportedPanels(box())) {
      expect(parseDxf(panelToDxfString(panel)).polylines[0].closed).toBe(true);
    }
  });
});

describe('holes survive the trip', () => {
  it('lands a hole the right distance from the panel corner it was measured from', () => {
    const design = leaningWall();
    // Face-local coordinates run from the face's first vertex, along its first edge.
    design.holes = [{ id: 'h', faceId: 'wall', u: 3, v: 2, diameterIn: 0.5 }];

    const wall = exportedPanels(design).find((p) => p.label === 'Wall')!;
    const parsed = parseDxf(panelToDxfString(wall));
    expect(parsed.circles.length).toBe(1);

    const corner = parsed.polylines[0].points[0];
    // Its distance from that corner has to be exactly what was asked for in 3D.
    expect(dist2(parsed.circles[0].center, corner)).toBeCloseTo(Math.hypot(3, 2), 9);
    expect(parsed.circles[0].radius).toBeCloseTo(0.25, 9);
  });

  it('carries one circle per hole and no strays', () => {
    const design = box();
    design.holes = [
      { id: 'h1', faceId: 'base', u: 2, v: 2, diameterIn: 0.5 },
      { id: 'h2', faceId: 'base', u: 9, v: 6, diameterIn: 0.5 },
      { id: 'h3', faceId: 'front', u: 4, v: 2, diameterIn: 0.5 },
    ];
    const parsed = parseDxf(combinedDxfString(exportedPanels(design)));
    expect(parsed.circles.length).toBe(3);
    expect(parsed.circles.every((c) => Math.abs(c.radius - 0.25) < 1e-9)).toBe(true);
  });
});

describe('the combined sheet', () => {
  it('carries every panel', () => {
    const design = box();
    const parsed = parseDxf(combinedDxfString(exportedPanels(design)));
    expect(parsed.polylines.length).toBe(design.faces.length);
  });

  it('keeps the panels from overlapping each other', () => {
    const parsed = parseDxf(combinedDxfString(exportedPanels(box())));
    const boxes = parsed.polylines.map((p) => ({
      minX: Math.min(...p.points.map((q) => q.x)),
      maxX: Math.max(...p.points.map((q) => q.x)),
      minY: Math.min(...p.points.map((q) => q.y)),
      maxY: Math.max(...p.points.map((q) => q.y)),
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY;
        expect(apart).toBe(true);
      }
    }
  });

  it('places everything at or above the origin, so nothing sits off the sheet', () => {
    const parsed = parseDxf(combinedDxfString(exportedPanels(box())));
    for (const p of parsed.polylines) {
      for (const point of p.points) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});

describe('miter correction, as far as a file can tell', () => {
  it('moves corners by no more than the cap allows', () => {
    // This cannot check the convention is right — only a cut part can. What it can check
    // is that the correction stays bounded, since its tangent runs to infinity as a fold
    // closes up, and an uncapped value would put coordinates somewhere absurd.
    const design = box();
    const thickness = 0.75;
    const plain = exportedPanels(design);
    const mitered = plain.map((p) => ({ ...applyMiterCorrection(p, thickness), offset: p.offset }));

    for (let i = 0; i < plain.length; i++) {
      const before = parseDxf(panelToDxfString(plain[i])).polylines[0].points;
      const after = parseDxf(panelToDxfString(mitered[i])).polylines[0].points;
      expect(after.length).toBe(before.length);
      for (let k = 0; k < before.length; k++) {
        // The cap is 4x thickness per edge, and a corner answers to two of them.
        expect(dist2(before[k], after[k])).toBeLessThanOrEqual(thickness * 8 + 1e-6);
      }
    }
  });
});
