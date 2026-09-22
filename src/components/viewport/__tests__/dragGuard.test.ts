import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAG_SLOP_PX,
  installDragGuard,
  pointerDragged,
  __setPressedAtForTest,
} from '../dragGuard';

/**
 * Telling a click apart from the end of an orbit.
 *
 * The behaviour this protects can only be seen in a browser — a camera sweep that ends
 * over the drawing sheet used to place a point. What can be pinned down here is the rule
 * it turns on: how far the pointer may wander and still be a click.
 */

afterEach(() => __setPressedAtForTest(null));

const at = (x: number, y: number) => ({ clientX: x, clientY: y });

describe('pointerDragged', () => {
  it('treats a still pointer as a click', () => {
    __setPressedAtForTest({ x: 100, y: 100 });
    expect(pointerDragged(at(100, 100))).toBe(false);
  });

  it('forgives a wobble, since nobody holds a mouse perfectly still', () => {
    __setPressedAtForTest({ x: 100, y: 100 });
    expect(pointerDragged(at(102, 101))).toBe(false);
  });

  it('calls a sweep across the viewport what it is', () => {
    __setPressedAtForTest({ x: 100, y: 100 });
    expect(pointerDragged(at(400, 260))).toBe(true);
  });

  it('measures distance, not distance along one axis', () => {
    __setPressedAtForTest({ x: 0, y: 0 });
    // Just inside the slop diagonally, and just outside it.
    expect(pointerDragged(at(2, 2))).toBe(false);
    expect(pointerDragged(at(DRAG_SLOP_PX, DRAG_SLOP_PX))).toBe(true);
  });

  it('says no when nothing has been pressed yet', () => {
    __setPressedAtForTest(null);
    expect(pointerDragged(at(999, 999))).toBe(false);
  });
});

describe('installDragGuard', () => {
  /** Stands in for the window, so this needs no DOM. */
  function fakeTarget() {
    let registered: ((event: { clientX: number; clientY: number }) => void) | null = null;
    let capture = false;
    return {
      press(x: number, y: number) {
        registered?.({ clientX: x, clientY: y });
      },
      get listening() {
        return registered !== null;
      },
      get inCapturePhase() {
        return capture;
      },
      addEventListener(_type: 'pointerdown', handler: (event: never) => void, useCapture: boolean) {
        registered = handler as unknown as (event: { clientX: number; clientY: number }) => void;
        capture = useCapture;
      },
      removeEventListener() {
        registered = null;
      },
    };
  }

  it('listens in the capture phase, ahead of the handlers that consult it', () => {
    const target = fakeTarget();
    const remove = installDragGuard(target);
    expect(target.listening).toBe(true);
    expect(target.inCapturePhase).toBe(true);
    remove();
  });

  it('records where the pointer went down', () => {
    const target = fakeTarget();
    const remove = installDragGuard(target);
    target.press(50, 50);

    expect(pointerDragged(at(52, 51))).toBe(false);
    expect(pointerDragged(at(300, 300))).toBe(true);
    remove();
  });

  it('starts fresh from each new press, rather than from the first one ever', () => {
    const target = fakeTarget();
    const remove = installDragGuard(target);
    target.press(0, 0);
    target.press(500, 500);

    // Measured from the second press: a click there, not a 700px drag from the first.
    expect(pointerDragged(at(501, 500))).toBe(false);
    remove();
  });

  it('stops listening once removed', () => {
    const target = fakeTarget();
    const remove = installDragGuard(target);
    remove();
    expect(target.listening).toBe(false);
    target.press(10, 10);
    expect(pointerDragged(at(900, 900))).toBe(false);
  });
});
