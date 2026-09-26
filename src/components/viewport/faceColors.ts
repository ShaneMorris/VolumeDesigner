import * as THREE from 'three';

/**
 * What colour a face is, and what selecting it does to that colour.
 *
 * Selection used to *replace* a face's colour with orange, and hovering replaced it with
 * grey. That made the colours meaningless as identity: a panel turned into the base's
 * colour when picked, and the base — which is selected from the moment it is created, so
 * it had never been seen any other way — turned out to be slate underneath, and looked
 * like it had changed into a panel whenever anything else was picked. Neither face had a
 * colour that stayed its own.
 *
 * So the colour says *what a face is* and brightness says *what is happening to it*. The
 * base is orange and a panel is robin's egg blue, always; picking one lifts it, hovering
 * lifts it a little. A face never wears another face's colour.
 *
 * The one exception is a selected edge in Angles mode, which tints *both* faces that share
 * it. That is a different statement — these two are a pair, and the angle between them is
 * what is being edited — and brightness alone cannot say "these two go together".
 */

/** The base: the face the volume bolts to the wall by. */
export const BASE_ORANGE = '#f5a623';

/**
 * Every other panel.
 *
 * Written brighter than a literal robin's egg, because the scene's white ambient and
 * directional lights wash the saturation out of a standard material and a literal swatch
 * renders as a muted sage-teal.
 */
export const PANEL_BLUE = '#5fd0d6';

/** Both faces of the edge whose dihedral angle is being edited. */
export const EDGE_PAIR_PURPLE = '#8b5cf6';

/**
 * How much brighter a face gets when it is picked, and when it is merely under the cursor.
 *
 * Saturation comes up along with lightness. Lightness alone drains the hue — a colour near
 * white is barely a colour at all — and the first attempt at this made both a picked base
 * and a picked panel look like milky cream and pale sky rather than brighter orange and
 * brighter blue. Deepening the colour as it lightens holds it together.
 */
export const SELECTED_LIFT = { lightness: 0.09, saturation: 0.1 };
export const HOVER_LIFT = { lightness: 0.04, saturation: 0.05 };

/**
 * Self-lit contribution, which holds the hue steady whichever way a panel faces.
 *
 * The picked face gets a little more, but only a little: the scene's white lights already
 * have these colours near the top of their range, so piling on emission clips the strongest
 * channel while the others keep climbing, which washes the colour out — the same failure as
 * lightening too far, by a different route.
 */
export const BASE_GLOW = 0.3;
export const SELECTED_GLOW = 0.38;

export interface FaceState {
  isBase: boolean;
  isSelected: boolean;
  hovered: boolean;
  /** Shares the edge currently selected in Angles mode. */
  inSelectedEdgePair: boolean;
}

export interface FaceLook {
  color: THREE.Color;
  emissiveIntensity: number;
}

/**
 * The same colour, brighter — the hue is left exactly as it was.
 *
 * In HSL rather than by scaling the channels, because scaling drags a colour toward white
 * and loses the hue along with it, which is the whole thing this is trying to keep.
 *
 * A `THREE.Color` rather than another hex string: writing one back out rounds every
 * channel to 8 bits, and doing that on the way into a material that works in floats throws
 * away precision for nothing.
 */
export interface Lift {
  lightness: number;
  saturation: number;
}

export function lighten(color: string | THREE.Color, by: Lift): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  return new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s + by.saturation),
    Math.min(1, hsl.l + by.lightness),
  );
}

/** A face's own colour, before anything has happened to it. */
export function faceBaseColor(isBase: boolean): THREE.Color {
  return new THREE.Color(isBase ? BASE_ORANGE : PANEL_BLUE);
}

/** How a face should be drawn, given everything currently true of it. */
export function faceLook(state: FaceState): FaceLook {
  if (state.inSelectedEdgePair) {
    return { color: new THREE.Color(EDGE_PAIR_PURPLE), emissiveIntensity: BASE_GLOW };
  }
  const own = faceBaseColor(state.isBase);
  if (state.isSelected) {
    return { color: lighten(own, SELECTED_LIFT), emissiveIntensity: SELECTED_GLOW };
  }
  if (state.hovered) {
    return { color: lighten(own, HOVER_LIFT), emissiveIntensity: BASE_GLOW };
  }
  return { color: own, emissiveIntensity: BASE_GLOW };
}
