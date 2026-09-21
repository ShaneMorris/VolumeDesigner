import type { Vec3 } from './types';

export interface PolygonPreset {
  id: string;
  label: string;
  sides: number;
}

export const POLYGON_PRESETS: PolygonPreset[] = [
  { id: 'triangle', label: 'Triangle', sides: 3 },
  { id: 'square', label: 'Square', sides: 4 },
  { id: 'pentagon', label: 'Pentagon', sides: 5 },
  { id: 'hexagon', label: 'Hexagon', sides: 6 },
  { id: 'octagon', label: 'Octagon', sides: 8 },
];

/**
 * A regular polygon centered on the origin in the z=0 base plane, oriented flat-bottom,
 * wound counter-clockwise seen from above.
 *
 * `widthIn` is the shape's overall left-to-right width (its bounding-box width), which
 * for a triangle or square works out to the side length. The unit polygon is built first
 * and then scaled to hit that width exactly, so the same definition holds for every
 * side count rather than needing per-shape trigonometry.
 */
export function regularPolygonPoints(sides: number, widthIn: number): Vec3[] {
  if (sides < 3) throw new Error('A polygon needs at least 3 sides');
  if (!(widthIn > 0)) throw new Error('Width must be greater than zero');

  const step = (2 * Math.PI) / sides;
  // Offsetting by half a step from straight-down puts an edge (not a vertex) at the
  // bottom for any side count.
  const startAngle = -Math.PI / 2 + step / 2;

  const unit = Array.from({ length: sides }, (_, i) => {
    const angle = startAngle + i * step;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });

  const xs = unit.map((p) => p.x);
  const unitWidth = Math.max(...xs) - Math.min(...xs);
  const scale = widthIn / unitWidth;

  return unit.map((p) => ({ x: p.x * scale, y: p.y * scale, z: 0 }));
}
