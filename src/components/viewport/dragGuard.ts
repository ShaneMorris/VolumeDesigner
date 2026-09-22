/**
 * Tells a click apart from the end of a drag.
 *
 * React Three Fiber decides whether to fire `onClick` by asking whether pointer-down and
 * pointer-up landed on the *same object*. It never asks whether the pointer moved. It does
 * have a 2px distance threshold, but only on the path for clicks that hit nothing at all.
 *
 * So orbiting the camera ends in a click: the press lands on some object, the pointer
 * sweeps across the viewport turning the model, and the release is still over that same
 * object — which in Draw mode placed a point nobody asked for, and in Holes mode would drop
 * a T-nut. The orbit in between is invisible to the check.
 *
 * Hence this: every handler that *does* something on click asks first whether the pointer
 * travelled. A sweep across the viewport is not a click under any reading.
 */

/** How far the pointer may wander and still count as a click, in screen pixels. */
const DRAG_SLOP_PX = 4;

let pressedAt: { x: number; y: number } | null = null;

function onPointerDown(event: { clientX: number; clientY: number }) {
  pressedAt = { x: event.clientX, y: event.clientY };
}

/** What `installDragGuard` needs of its target — enough for a test to stand in for one. */
export interface PressTarget {
  addEventListener(type: 'pointerdown', handler: (event: never) => void, capture: boolean): void;
  removeEventListener(type: 'pointerdown', handler: (event: never) => void, capture: boolean): void;
}

/**
 * Starts watching for pointer presses. Called once, from the viewport.
 *
 * Capture phase, on the window: the position has to be recorded before any handler that
 * might consult it runs, including ones on objects deep in the scene. The target is a
 * parameter only so a test can supply one without needing a DOM.
 */
export function installDragGuard(target?: PressTarget): () => void {
  const on = (target ?? (window as unknown as PressTarget)) as PressTarget;
  const handler = onPointerDown as unknown as (event: never) => void;
  on.addEventListener('pointerdown', handler, true);
  return () => {
    on.removeEventListener('pointerdown', handler, true);
    pressedAt = null;
  };
}

/** Whether the pointer travelled far enough since it went down to count as a drag. */
export function pointerDragged(event: { clientX: number; clientY: number }): boolean {
  if (!pressedAt) return false;
  return Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > DRAG_SLOP_PX;
}

/** Test seam: pretend the pointer went down at a position. */
export function __setPressedAtForTest(point: { x: number; y: number } | null) {
  pressedAt = point;
}

export { DRAG_SLOP_PX };
