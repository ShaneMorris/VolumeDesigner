import type { Panel, Vec2 } from './unfold';

/**
 * Corrects a panel's outline for corner miters where beveled edges meet.
 *
 * Convention: a panel's flat outline (and its edge lengths, as unfolded) is measured at
 * the panel's OUTER face — the face visible from outside the finished volume. When an
 * edge is beveled to mate with a neighboring panel at dihedral angle `bevelAngleDeg`
 * (180° = flat, no bevel), the cut line on the outer face sits outward of the
 * unbeveled/centerline edge by `(thickness / 2) * tan((180 - bevelAngleDeg) / 2)`.
 * Each edge is offset outward by that amount and adjacent offset edge-lines are
 * re-intersected to find the corrected corner point, so a corner where two beveled
 * edges meet gets a proper miter point rather than the un-corrected 3D-projected corner.
 *
 * This is a geometric approximation (per the spec's "recommendation" scope), not a full
 * 3-plane solid intersection — verify against a physical test part before trusting it
 * at tight tolerances.
 */
export function applyMiterCorrection(panel: Panel, thicknessIn: number): Panel {
  const n = panel.outline.length;
  if (n < 3 || thicknessIn <= 0) return panel;

  const signedArea = shoelaceSignedArea(panel.outline);
  const ccw = signedArea > 0;

  const offsetLines = panel.edges.map((edge, i) => {
    const a = panel.outline[i];
    const b = panel.outline[(i + 1) % n];
    const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
    let normal: Vec2 = ccw ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
    const bevel = edge.bevelAngleDeg;
    const offsetDist = bevel === null ? 0 : (thicknessIn / 2) * Math.tan(((180 - bevel) / 2) * (Math.PI / 180));
    const offsetA = { x: a.x + normal.x * offsetDist, y: a.y + normal.y * offsetDist };
    return { point: offsetA, dir };
  });

  const newOutline: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = offsetLines[(i - 1 + n) % n];
    const cur = offsetLines[i];
    const corner = lineIntersection(prev.point, prev.dir, cur.point, cur.dir) ?? panel.outline[i];
    newOutline.push(corner);
  }

  return { ...panel, outline: newOutline };
}

function shoelaceSignedArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function normalize(v: Vec2): Vec2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}
