import type { Design, Face, Hole } from './types';
import { V } from './vec3';
import { sharedEdges, dihedralAngleDeg, getVertex, isFacePlanar, edgeLength } from './mesh';
import { faceLocalBasis, toFaceLocal } from './basis';
import { edgeKey } from './types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PanelEdge {
  /** Index into the panel's outline array; this is the edge from outline[i] to outline[i+1]. */
  index: number;
  aVertexId: string;
  bVertexId: string;
  lengthIn: number;
  /** Dihedral bevel angle to cut along this edge, or null if the edge is unshared (open/boundary). */
  bevelAngleDeg: number | null;
}

export interface PanelHole {
  holeId: string;
  x: number;
  y: number;
  diameterIn: number;
}

export interface Panel {
  faceId: string;
  label: string;
  /** True flat outline, in the panel's own local inches coordinate space (not yet sheet-laid-out). */
  outline: Vec2[];
  edges: PanelEdge[];
  holes: PanelHole[];
  isPlanar: boolean;
  /** For a non-planar face approximated as two triangles, the outline index pair of the internal diagonal. */
  internalDiagonal: [number, number] | null;
}

function circleIntersection(pA: Vec2, distAC: number, pB: Vec2, distBC: number, away: Vec2): Vec2 {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) {
    return { x: pA.x, y: pA.y + distAC };
  }
  const a = (distAC * distAC - distBC * distBC + d * d) / (2 * d);
  const h2 = Math.max(0, distAC * distAC - a * a);
  const h = Math.sqrt(h2);
  const dirX = dx / d;
  const dirY = dy / d;
  const midX = pA.x + dirX * a;
  const midY = pA.y + dirY * a;
  const perpX = -dirY;
  const perpY = dirX;
  const p1: Vec2 = { x: midX + perpX * h, y: midY + perpY * h };
  const p2: Vec2 = { x: midX - perpX * h, y: midY - perpY * h };
  const d1 = (p1.x - away.x) ** 2 + (p1.y - away.y) ** 2;
  const d2 = (p2.x - away.x) ** 2 + (p2.y - away.y) ** 2;
  return d1 >= d2 ? p1 : p2;
}

interface FanTriangle {
  /** Indices into face.vertexIds. */
  i0: number;
  i1: number;
  i2: number;
}

function fanTriangulate(n: number): FanTriangle[] {
  const tris: FanTriangle[] = [];
  for (let i = 1; i < n - 1; i++) {
    tris.push({ i0: 0, i1: i, i2: i + 1 });
  }
  return tris;
}

function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = p.x - a.x;
  const v2y = p.y - a.y;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-12) return [1, 0, 0];
  const v = (v2x * v1y - v1x * v2y) / den;
  const w = (v0x * v2y - v2x * v0y) / den;
  const u = 1 - v - w;
  return [u, v, w];
}

/**
 * Flattens a single face into its true (non-projected) 2D shape.
 * Planar faces (always true for triangles) project cleanly into their own plane.
 * Non-planar polygons are fan-triangulated and each triangle is laid out in true 2D
 * using its real 3D edge lengths, so the flattened shape is a length-accurate
 * approximation rather than a distorting projection.
 */
export function unfoldFace(design: Design, face: Face, holes: Hole[]): Panel {
  const n = face.vertexIds.length;
  const positions = face.vertexIds.map((id) => getVertex(design, id).position);
  const planar = isFacePlanar(design, face);
  const nominalBasis = faceLocalBasis(design, face);
  const nominalUV: Vec2[] = positions.map((p) => {
    const { u, v } = toFaceLocal(nominalBasis, p);
    return { x: u, y: v };
  });

  const triangles = fanTriangulate(n);
  const trueUV: Vec2[] = new Array(n);
  trueUV[0] = { x: 0, y: 0 };
  trueUV[1] = { x: V.distance(positions[0], positions[1]), y: 0 };

  for (let k = 1; k < n - 1; k++) {
    const i0 = 0;
    const i1 = k;
    const i2 = k + 1;
    const distA = V.distance(positions[i0], positions[i2]);
    const distB = V.distance(positions[i1], positions[i2]);
    const away = k >= 2 ? trueUV[k - 1] : { x: trueUV[0].x, y: trueUV[0].y - 1e6 };
    trueUV[i2] = circleIntersection(trueUV[i0], distA, trueUV[i1], distB, away);
  }

  const outline = trueUV;

  const allShared = sharedEdges(design);
  const edges: PanelEdge[] = [];
  for (let i = 0; i < n; i++) {
    const aId = face.vertexIds[i];
    const bId = face.vertexIds[(i + 1) % n];
    const key = edgeKey(aId, bId);
    const derived = allShared.find((e) => e.key === key);
    const bevel = derived ? dihedralAngleDeg(design, derived) : null;
    edges.push({
      index: i,
      aVertexId: aId,
      bVertexId: bId,
      lengthIn: edgeLength(design, aId, bId),
      bevelAngleDeg: bevel,
    });
  }

  const panelHoles: PanelHole[] = holes
    .filter((h) => h.faceId === face.id)
    .map((h) => {
      const p: Vec2 = { x: h.u, y: h.v };
      const tri = triangles.find((t) => {
        const [bu, bv, bw] = barycentric(p, nominalUV[t.i0], nominalUV[t.i1], nominalUV[t.i2]);
        return bu >= -1e-6 && bv >= -1e-6 && bw >= -1e-6;
      }) ?? triangles[0];
      const [bu, bv, bw] = barycentric(p, nominalUV[tri.i0], nominalUV[tri.i1], nominalUV[tri.i2]);
      const x = bu * outline[tri.i0].x + bv * outline[tri.i1].x + bw * outline[tri.i2].x;
      const y = bu * outline[tri.i0].y + bv * outline[tri.i1].y + bw * outline[tri.i2].y;
      return { holeId: h.id, x, y, diameterIn: h.diameterIn };
    });

  return {
    faceId: face.id,
    label: face.label,
    outline,
    edges,
    holes: panelHoles,
    isPlanar: planar,
    internalDiagonal: !planar && n === 4 ? [0, 2] : null,
  };
}

export function unfoldAllFaces(design: Design): Panel[] {
  return design.faces.map((f) => unfoldFace(design, f, design.holes));
}

export interface LaidOutPanel extends Panel {
  offset: Vec2;
}

/** Simple non-overlapping grid layout for a sheet-view: no true nesting, just side-by-side. */
export function layoutPanelsOnSheet(panels: Panel[], marginIn = 1): LaidOutPanel[] {
  let cursorX = 0;
  const result: LaidOutPanel[] = [];

  for (const panel of panels) {
    const xs = panel.outline.map((p) => p.x);
    const ys = panel.outline.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    const offset: Vec2 = { x: cursorX - minX, y: -minY };
    result.push({ ...panel, offset });
    cursorX += width + marginIn;
  }

  return result;
}
