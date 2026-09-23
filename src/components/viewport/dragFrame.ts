import type { Vec3 } from '../../geometry/types';
import { V } from '../../geometry/vec3';

/**
 * Turning pointer travel into model travel while dragging.
 *
 * A drag used to work by intersecting the pointer ray with a horizontal plane through the
 * grabbed point and putting the vertex wherever that landed. It keeps the point exactly
 * under the cursor, which sounds like the right thing and is why it was written that way —
 * but the gain is `1 / sin(angle between the ray and the plane)`, and that diverges at the
 * plane's vanishing line. Measured on a default view: across the screen a pixel was worth
 * 0.02in, while up the screen it was worth 0.17in at a raised vertex and grew as the
 * cursor rose. Forty pixels of mouse became nearly seven inches of model, the work-area
 * clamp caught it at the boundary, and what was left was a long slender sliver. That is
 * the "shoots into the distance" report. A shallow-ray cutoff did not fix it: by the time
 * a ray is shallow enough to trip a cutoff, the gain has been unusable for a long while.
 *
 * So the pointer is read as a *delta*, against rates worked out once when the drag begins.
 * Two things follow from fixing them at the start. The drag is linear: the same pixel is
 * worth the same distance at the end of a sweep as at the beginning, where before it
 * accelerated. And it is bounded: no part of the screen is worth an unbounded amount.
 *
 * Across the screen the exact rate is used, because there is nothing wrong with it — a
 * horizontal plane holds the camera's right axis with no foreshortening at all. Up the
 * screen the exact rate is used too, up to a limit: a pixel up the screen may be worth at
 * most `MAX_ANISOTROPY` times a pixel across it. Under an ordinary three-quarter view that
 * limit doesn't bite and the point sits under the cursor as before; looking along a plane
 * nearly edge-on it does, and the point then trails the cursor rather than flying. Trailing
 * is the right way to fail, because a drag that lags can still be aimed.
 */

/** The camera's world axes, which is all of the camera this needs to know about. */
export interface ViewAxes {
  /** Unit vector pointing right across the screen. */
  right: Vec3;
  /** Unit vector the camera looks along. */
  forward: Vec3;
  /** Unit vector pointing up the screen. */
  up: Vec3;
}

export interface DragFrame {
  /** Inches of model per pixel of pointer travel across the screen. */
  acrossInPerPx: number;
  /** Inches per pixel up the screen, within the drag plane. */
  awayInPerPx: number;
  /** Inches per pixel up the screen, for a drag held to the vertical axis. */
  upInPerPx: number;
  /** Where the model goes when the pointer moves right. Unit length. */
  right: Vec3;
  /** Where it goes when the pointer moves up the screen. Unit length. */
  away: Vec3;
}

/** How much more a pixel up the screen may be worth than a pixel across it. */
export const MAX_ANISOTROPY = 2;

/** Below this a direction has no usable bearing, and the drag is refused rather than guessed. */
const DEGENERATE = 1e-6;

/**
 * How much model one pixel covers at a given depth, for a perspective camera.
 *
 * The view frustum is `2·tan(fov/2)·depth` tall in world units and `heightPx` tall in
 * pixels, so the ratio is what a pixel is worth there.
 */
export function worldPerPixel(fovDeg: number, depthIn: number, viewportHeightPx: number): number {
  if (depthIn <= 0 || viewportHeightPx <= 0) return 0;
  return (2 * Math.tan(((fovDeg * Math.PI) / 180) / 2) * depthIn) / viewportHeightPx;
}

/**
 * The exact rate, held to `MAX_ANISOTROPY` times the across-screen rate.
 *
 * `foreshortening` is how much of a pixel's worth survives the tilt — the sine of the
 * angle between the line of sight and the surface being dragged in. It goes to zero as
 * that surface turns edge-on, which is exactly where the exact rate goes to infinity.
 */
function boundedRate(acrossInPerPx: number, foreshortening: number): number {
  const exact = foreshortening > DEGENERATE ? acrossInPerPx / foreshortening : Infinity;
  return Math.min(exact, acrossInPerPx * MAX_ANISOTROPY);
}

/** The horizontal part of a direction, normalized — what it points at on the floor. */
function flatten(direction: Vec3): Vec3 | null {
  const flat = { x: direction.x, y: direction.y, z: 0 };
  const length = V.length(flat);
  return length < DEGENERATE ? null : V.scale(flat, 1 / length);
}

/**
 * The two horizontal directions the screen axes correspond to.
 *
 * Screen-up means "further away across the floor", which is the camera's heading. Looking
 * straight down there is no heading, and the camera's own up vector is then lying flat and
 * gives the same answer, so that is the fallback.
 */
export function horizontalDragAxes(view: ViewAxes): { right: Vec3; away: Vec3 } | null {
  const right = flatten(view.right);
  const away = flatten(view.forward) ?? flatten(view.up);
  if (!right || !away) return null;

  // Square them up, so a camera with any roll in it still gives independent axes.
  const squared = V.sub(away, V.scale(right, V.dot(away, right)));
  const length = V.length(squared);
  if (length < DEGENERATE) return null;
  return { right, away: V.scale(squared, 1 / length) };
}

/**
 * The frame for a drag that grabbed `grabbed`, or null if the view gives no usable answer.
 */
export function horizontalDragFrame(
  view: ViewAxes,
  cameraPosition: Vec3,
  grabbed: Vec3,
  fovDeg: number,
  viewportHeightPx: number,
): DragFrame | null {
  const axes = horizontalDragAxes(view);
  if (!axes) return null;

  // Depth along the view direction rather than straight-line distance: that is what sets
  // how big a pixel is, and it keeps the rate even across the width of the screen.
  const toPoint = V.sub(grabbed, cameraPosition);
  const acrossInPerPx = worldPerPixel(fovDeg, V.dot(toPoint, view.forward), viewportHeightPx);
  if (acrossInPerPx <= 0) return null;

  const distance = V.length(toPoint);
  if (distance < DEGENERATE) return null;
  const sight = V.scale(toPoint, 1 / distance);

  return {
    acrossInPerPx,
    // How steeply the line of sight meets the horizontal plane.
    awayInPerPx: boundedRate(acrossInPerPx, Math.abs(sight.z)),
    // The vertical axis foreshortens the other way round: it is the part of Z that is
    // across the line of sight that shows on screen, and it vanishes looking straight down.
    upInPerPx: boundedRate(acrossInPerPx, Math.sqrt(Math.max(0, 1 - sight.z * sight.z))),
    right: axes.right,
    away: axes.away,
  };
}

/** How far the grabbed point should have moved after `dxPx`, `dyPx` of pointer travel. */
export function planarTranslation(frame: DragFrame, dxPx: number, dyPx: number): Vec3 {
  // Screen y counts downward, so moving up the screen is a move away.
  return V.add(
    V.scale(frame.right, dxPx * frame.acrossInPerPx),
    V.scale(frame.away, -dyPx * frame.awayInPerPx),
  );
}

/** The same, for a drag held to the vertical axis. */
export function verticalTranslation(frame: DragFrame, dyPx: number): Vec3 {
  return { x: 0, y: 0, z: -dyPx * frame.upInPerPx };
}
