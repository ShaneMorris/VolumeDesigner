import { describe, expect, it } from 'vitest';
import { regularPolygonPoints } from '../polygons';

function boundingWidth(points: { x: number }[]): number {
  const xs = points.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

function sideLengths(points: { x: number; y: number }[]): number[] {
  return points.map((p, i) => {
    const next = points[(i + 1) % points.length];
    return Math.hypot(next.x - p.x, next.y - p.y);
  });
}

describe('regularPolygonPoints', () => {
  it('produces the requested number of sides, all in the z=0 base plane', () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      const pts = regularPolygonPoints(sides, 10);
      expect(pts.length).toBe(sides);
      for (const p of pts) expect(p.z).toBe(0);
    }
  });

  it('hits the requested overall width exactly', () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      expect(boundingWidth(regularPolygonPoints(sides, 12))).toBeCloseTo(12, 9);
    }
  });

  it('is regular — every side the same length', () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      const lengths = sideLengths(regularPolygonPoints(sides, 7));
      for (const len of lengths) expect(len).toBeCloseTo(lengths[0], 9);
    }
  });

  it('centers on the origin', () => {
    const pts = regularPolygonPoints(6, 10);
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    expect(cx).toBeCloseTo(0, 9);
    expect(cy).toBeCloseTo(0, 9);
  });

  it('for a square, width equals the side length', () => {
    const pts = regularPolygonPoints(4, 8);
    for (const len of sideLengths(pts)) expect(len).toBeCloseTo(8, 9);
  });

  it('for an equilateral triangle, width equals the side length', () => {
    const pts = regularPolygonPoints(3, 8);
    for (const len of sideLengths(pts)) expect(len).toBeCloseTo(8, 9);
  });

  it('sits flat-bottomed — the two lowest points share a y', () => {
    for (const sides of [3, 4, 5, 6, 8]) {
      const ys = regularPolygonPoints(sides, 5)
        .map((p) => p.y)
        .sort((a, b) => a - b);
      expect(ys[0]).toBeCloseTo(ys[1], 9);
    }
  });

  it('rejects nonsense inputs', () => {
    expect(() => regularPolygonPoints(2, 10)).toThrow();
    expect(() => regularPolygonPoints(4, 0)).toThrow();
  });
});
