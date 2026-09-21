import { describe, expect, it } from 'vitest';
import {
  fromPolar,
  planeThroughPoints,
  projectOntoPlane,
  resolveNextPoint,
  toPolar,
  verticalPlaneFacingCamera,
} from '../drawPlane';
import { V } from '../vec3';

const ORIGIN = { x: 0, y: 0, z: 0 };

describe('verticalPlaneFacingCamera', () => {
  it('is vertical: its up axis is world up, and its normal is horizontal', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 4, y: -6, z: 4.5 });
    expect(plane.v.z).toBeCloseTo(1, 6);
    expect(plane.normal.z).toBeCloseTo(0, 6);
    expect(plane.u.z).toBeCloseTo(0, 6);
  });

  it('faces the camera horizontally', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: -10, z: 3 });
    // Camera is off in -Y, so the plane's normal should lie along that horizontal line.
    expect(Math.abs(plane.normal.y)).toBeCloseTo(1, 6);
    expect(plane.normal.x).toBeCloseTo(0, 6);
  });

  it('degrades gracefully when the camera is directly overhead', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: 0, z: 10 });
    expect(Number.isFinite(plane.normal.x)).toBe(true);
    expect(plane.normal.z).toBeCloseTo(0, 6);
  });
});

describe('polar round-trip', () => {
  it('maps length/angle to a point and back unchanged', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: -10, z: 0 });
    for (const polar of [
      { lengthIn: 5, angleDeg: 0 },
      { lengthIn: 3, angleDeg: 90 },
      { lengthIn: 7.25, angleDeg: 37.5 },
      { lengthIn: 2, angleDeg: -45 },
    ]) {
      const point = fromPolar(plane, ORIGIN, polar);
      const back = toPolar(plane, ORIGIN, point);
      expect(back.lengthIn).toBeCloseTo(polar.lengthIn, 9);
      expect(back.angleDeg).toBeCloseTo(polar.angleDeg, 9);
    }
  });

  it('treats 90 degrees as straight up and 0 as level', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: -10, z: 0 });
    const up = fromPolar(plane, ORIGIN, { lengthIn: 4, angleDeg: 90 });
    expect(up.z).toBeCloseTo(4, 9);
    expect(Math.hypot(up.x, up.y)).toBeCloseTo(0, 9);

    const level = fromPolar(plane, ORIGIN, { lengthIn: 4, angleDeg: 0 });
    expect(level.z).toBeCloseTo(0, 9);
    expect(Math.hypot(level.x, level.y)).toBeCloseTo(4, 9);
  });
});

describe('projectOntoPlane', () => {
  it('drops the off-plane component', () => {
    const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: -10, z: 0 });
    const projected = projectOntoPlane(plane, { x: 3, y: 8, z: 2 });
    // Plane normal is along Y here, so Y collapses to the plane's origin.
    expect(V.dot(V.sub(projected, plane.origin), plane.normal)).toBeCloseTo(0, 9);
    expect(projected.x).toBeCloseTo(3, 9);
    expect(projected.z).toBeCloseTo(2, 9);
  });
});

describe('planeThroughPoints', () => {
  it('derives the plane of three points', () => {
    const plane = planeThroughPoints([
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 0, z: 3 },
    ])!;
    expect(Math.abs(plane.normal.y)).toBeCloseTo(1, 6);
  });

  it('returns null for collinear or insufficient points', () => {
    expect(planeThroughPoints([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull();
    expect(
      planeThroughPoints([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ]),
    ).toBeNull();
  });
});

describe('resolveNextPoint', () => {
  const plane = verticalPlaneFacingCamera(ORIGIN, { x: 0, y: -10, z: 0 });

  it('follows the cursor when nothing is locked', () => {
    const p = resolveNextPoint(plane, ORIGIN, { x: 3, y: 0, z: 4 }, {});
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.z).toBeCloseTo(4, 9);
  });

  it('honors a locked length while following the cursor direction', () => {
    const p = resolveNextPoint(plane, ORIGIN, { x: 3, y: 0, z: 4 }, { lengthIn: 10 });
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(10, 9);
    // Same direction as the cursor (3,4) normalized, scaled to 10.
    expect(p.x).toBeCloseTo(6, 9);
    expect(p.z).toBeCloseTo(8, 9);
  });

  it('honors a locked angle while following the cursor distance', () => {
    const p = resolveNextPoint(plane, ORIGIN, { x: 3, y: 0, z: 4 }, { angleDeg: 90 });
    expect(p.z).toBeCloseTo(5, 9); // cursor distance 5, forced straight up
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(0, 9);
  });

  it('ignores the cursor entirely when both are locked', () => {
    const p = resolveNextPoint(plane, ORIGIN, { x: 99, y: 0, z: -40 }, { lengthIn: 2, angleDeg: 0 });
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });
});
