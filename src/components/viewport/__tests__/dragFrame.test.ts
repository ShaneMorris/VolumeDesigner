import { describe, expect, it } from 'vitest';
import {
  MAX_ANISOTROPY,
  horizontalDragAxes,
  horizontalDragFrame,
  planarTranslation,
  verticalTranslation,
  worldPerPixel,
  type ViewAxes,
} from '../dragFrame';
import type { Vec3 } from '../../../geometry/types';

/**
 * How far a vertex travels for how far the pointer travels.
 *
 * The defect these pin down: dragging in a horizontal plane by intersecting the pointer
 * ray with it, a vertex flew off into the distance and left a sliver behind. The gain up
 * the screen went as 1/sin(angle to the plane), so a shallow view magnified every pixel
 * and magnified it more the further the cursor rose.
 */

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const VIEWPORT_PX = 800;
const FOV = 50;

/**
 * A camera `distance` away, looking down at the origin from `pitchDeg` above the horizon,
 * from along -Y. At 90 degrees it is directly overhead; near 0 it is nearly level with the
 * ground, which is the case that used to misbehave.
 */
function view(pitchDeg: number, distance = 20): { axes: ViewAxes; position: Vec3 } {
  const pitch = (pitchDeg * Math.PI) / 180;
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  return {
    axes: {
      right: { x: 1, y: 0, z: 0 },
      forward: { x: 0, y: cos, z: -sin },
      up: { x: 0, y: sin, z: cos },
    },
    position: { x: 0, y: -distance * cos, z: distance * sin },
  };
}

function frameAt(pitchDeg: number, distance = 20) {
  const { axes, position } = view(pitchDeg, distance);
  return horizontalDragFrame(axes, position, ORIGIN, FOV, VIEWPORT_PX)!;
}

const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

describe('what a pixel is worth', () => {
  it('scales with how far away the thing being dragged is', () => {
    expect(worldPerPixel(FOV, 40, VIEWPORT_PX)).toBeCloseTo(2 * worldPerPixel(FOV, 20, VIEWPORT_PX), 9);
  });

  it('gives nothing for a point behind the camera or a viewport of no height', () => {
    expect(worldPerPixel(FOV, -5, VIEWPORT_PX)).toBe(0);
    expect(worldPerPixel(FOV, 20, 0)).toBe(0);
  });

  it('leaves movement across the screen exactly as the geometry says', () => {
    // A horizontal plane holds the camera's right axis with no foreshortening at all, so
    // there was never anything wrong with this direction and nothing here changes it.
    const frame = frameAt(35);
    expect(frame.acrossInPerPx).toBeCloseTo(worldPerPixel(FOV, 20, VIEWPORT_PX), 9);
  });
});

describe('movement up the screen, where the drag used to run away', () => {
  it('follows the exact rate while the view is steep enough to afford it', () => {
    // Looking down at 45 degrees the honest figure is 1/sin(45) = 1.41x across-screen,
    // which is under the limit, so it is used unchanged and the point tracks the cursor.
    const frame = frameAt(45);
    expect(frame.awayInPerPx / frame.acrossInPerPx).toBeCloseTo(Math.SQRT2, 6);
  });

  it('holds the rate down once the plane turns edge-on', () => {
    // 10 degrees above the plane: the exact figure is 5.8x, which is the flinging. What
    // comes back is the limit.
    const frame = frameAt(10);
    expect(1 / Math.sin((10 * Math.PI) / 180)).toBeGreaterThan(5); // the rate being refused
    expect(frame.awayInPerPx / frame.acrossInPerPx).toBeCloseTo(MAX_ANISOTROPY, 9);
  });

  it('never lets a pixel up the screen outrun a pixel across it by more than the limit', () => {
    // The whole range, including the grazing angles that have no usable exact answer.
    for (const pitch of [0, 0.5, 1, 2, 5, 15, 30, 45, 60, 90]) {
      const frame = frameAt(pitch);
      expect(frame.awayInPerPx).toBeLessThanOrEqual(frame.acrossInPerPx * MAX_ANISOTROPY + 1e-12);
      expect(frame.awayInPerPx).toBeGreaterThan(0);
      expect(Number.isFinite(frame.awayInPerPx)).toBe(true);
    }
  });

  it('is worth the same per pixel at the end of a sweep as at the start', () => {
    // The old mapping accelerated: each pixel nearer the vanishing line was worth more
    // than the last. A drag is one fixed rate now, so twice the pixels is twice the model.
    const frame = frameAt(20);
    const short = planarTranslation(frame, 0, -40);
    const long = planarTranslation(frame, 0, -80);
    expect(length(long)).toBeCloseTo(2 * length(short), 9);
  });

  it('keeps a realistic drag to inches rather than feet', () => {
    // The measured defect: 40px up the screen at a raised vertex moved it 6.8in and the
    // work-area clamp turned the face into a sliver. The same drag is small now.
    const frame = frameAt(10, 20);
    expect(length(planarTranslation(frame, 0, -40))).toBeLessThan(2);
  });
});

describe('which way the model goes', () => {
  it('sends the point away across the floor when the pointer goes up the screen', () => {
    const frame = frameAt(35);
    const away = planarTranslation(frame, 0, -50);
    expect(away.y).toBeGreaterThan(0); // the camera looks along +Y, so away is +Y
    expect(away.z).toBeCloseTo(0, 12); // and a horizontal drag stays at its own height
  });

  it('reverses exactly when the pointer comes back down', () => {
    const frame = frameAt(35);
    const up = planarTranslation(frame, 30, -50);
    const back = planarTranslation(frame, -30, 50);
    expect(back.x).toBeCloseTo(-up.x, 12);
    expect(back.y).toBeCloseTo(-up.y, 12);
  });

  it('sends it along the camera right axis when the pointer goes right', () => {
    const frame = frameAt(35);
    const right = planarTranslation(frame, 50, 0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBeCloseTo(0, 12);
  });

  it('gives axes that are horizontal, perpendicular and of unit length', () => {
    const { axes } = view(35);
    const { right, away } = horizontalDragAxes(axes)!;
    expect(right.z).toBe(0);
    expect(away.z).toBe(0);
    expect(length(right)).toBeCloseTo(1, 12);
    expect(length(away)).toBeCloseTo(1, 12);
    expect(right.x * away.x + right.y * away.y).toBeCloseTo(0, 12);
  });

  it('still knows which way is away when the camera is directly overhead', () => {
    // Straight down there is no heading to project, so the camera's own up vector — which
    // is lying flat at that point — says which way the screen is facing.
    const axes: ViewAxes = {
      right: { x: 1, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    };
    const found = horizontalDragAxes(axes)!;
    expect(found).not.toBeNull();
    expect(found.away.y).toBeCloseTo(1, 12);
  });
});

describe('a drag held to the vertical', () => {
  it('raises the point when the pointer goes up, and only that', () => {
    const frame = frameAt(35);
    const up = verticalTranslation(frame, -60);
    expect(up.z).toBeGreaterThan(0);
    expect(up.x).toBe(0);
    expect(up.y).toBe(0);
  });

  it('is worth about a pixel across the screen at an ordinary viewing angle', () => {
    // The vertical axis is nearly side-on to a three-quarter view, so there is almost no
    // foreshortening to correct for and the two rates should agree closely.
    const frame = frameAt(35);
    expect(frame.upInPerPx / frame.acrossInPerPx).toBeCloseTo(1 / Math.cos((35 * Math.PI) / 180), 6);
  });

  it('stays usable looking straight down, where the exact rate is infinite', () => {
    // Overhead, the Z axis is a single point on screen: no pointer movement can honestly
    // raise anything. The limit keeps the drag slow rather than impossible or infinite.
    const frame = frameAt(90);
    expect(frame.upInPerPx).toBeCloseTo(frame.acrossInPerPx * MAX_ANISOTROPY, 9);
    expect(Number.isFinite(frame.upInPerPx)).toBe(true);
  });
});

describe('when there is no sensible answer at all', () => {
  it('declines a grab at the camera itself rather than dividing by nothing', () => {
    const { axes, position } = view(35);
    expect(horizontalDragFrame(axes, position, position, FOV, VIEWPORT_PX)).toBeNull();
  });

  it('declines a grab behind the camera', () => {
    const { axes, position } = view(35);
    const behind: Vec3 = { x: 0, y: position.y - 10, z: position.z };
    expect(horizontalDragFrame(axes, position, behind, FOV, VIEWPORT_PX)).toBeNull();
  });
});
