import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BASE_ORANGE,
  EDGE_PAIR_PURPLE,
  HOVER_LIFT,
  PANEL_BLUE,
  SELECTED_LIFT,
  faceLook,
  lighten,
} from '../faceColors';

/**
 * A face keeps its own colour through everything that happens to it.
 *
 * Reported from use: picking a panel turned it the base's orange, and the base — selected
 * from the moment it is created, so never seen otherwise — turned out to be slate
 * underneath and looked like it had become a panel whenever anything else was picked.
 */

const hsl = (color: string | THREE.Color) => {
  const out = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(out);
  return out;
};

/** The colour as it would be written, for comparing against a swatch. */
const hex = (color: THREE.Color) => `#${color.getHexString()}`;

const state = (over: Partial<Parameters<typeof faceLook>[0]> = {}) => ({
  isBase: false,
  isSelected: false,
  hovered: false,
  inSelectedEdgePair: false,
  ...over,
});

describe('a face is its own colour when nothing is happening to it', () => {
  it('draws the base orange', () => {
    expect(hex(faceLook(state({ isBase: true })).color)).toBe(BASE_ORANGE);
  });

  it('draws a panel robin’s egg blue', () => {
    expect(hex(faceLook(state()).color)).toBe(PANEL_BLUE);
  });

  it('keeps the two far enough apart to tell at a glance', () => {
    // Which face the volume mounts on has to be obvious, and brightness alone is now
    // spoken for — so the difference between them has to be the hue.
    const apart = Math.abs(hsl(BASE_ORANGE).h - hsl(PANEL_BLUE).h);
    expect(Math.min(apart, 1 - apart)).toBeGreaterThan(0.25);
  });
});

describe('selecting a face brightens it without recolouring it', () => {
  it('keeps the base in its own hue', () => {
    const picked = faceLook(state({ isBase: true, isSelected: true }));
    expect(hsl(picked.color).h).toBeCloseTo(hsl(BASE_ORANGE).h, 2);
  });

  it('keeps a panel in its own hue', () => {
    const picked = faceLook(state({ isSelected: true }));
    expect(hsl(picked.color).h).toBeCloseTo(hsl(PANEL_BLUE).h, 2);
  });

  it('never gives a panel the base’s colour, which is what was reported', () => {
    const picked = faceLook(state({ isSelected: true })).color;
    expect(hex(picked)).not.toBe(BASE_ORANGE);
    expect(hsl(picked).h).not.toBeCloseTo(hsl(BASE_ORANGE).h, 1);
  });

  it('never gives the base a panel’s colour either', () => {
    const picked = faceLook(state({ isBase: true, isSelected: true })).color;
    expect(hex(picked)).not.toBe(PANEL_BLUE);
    expect(hsl(picked).h).not.toBeCloseTo(hsl(PANEL_BLUE).h, 1);
  });

  it('is brighter than the same face unpicked, both ways round', () => {
    for (const isBase of [true, false]) {
      const resting = faceLook(state({ isBase }));
      const picked = faceLook(state({ isBase, isSelected: true }));
      expect(hsl(picked.color).l).toBeGreaterThan(hsl(resting.color).l);
      expect(picked.emissiveIntensity).toBeGreaterThan(resting.emissiveIntensity);
    }
  });

  it('brightens both families by the same amount, so neither shouts louder', () => {
    const baseLift = hsl(faceLook(state({ isBase: true, isSelected: true })).color).l - hsl(BASE_ORANGE).l;
    const panelLift = hsl(faceLook(state({ isSelected: true })).color).l - hsl(PANEL_BLUE).l;
    expect(baseLift).toBeCloseTo(panelLift, 9);
    expect(baseLift).toBeCloseTo(SELECTED_LIFT.lightness, 9);
  });
});

describe('hovering says less than selecting', () => {
  it('lifts a face, but not as far', () => {
    for (const isBase of [true, false]) {
      const resting = hsl(faceLook(state({ isBase })).color).l;
      const hover = hsl(faceLook(state({ isBase, hovered: true })).color).l;
      const picked = hsl(faceLook(state({ isBase, isSelected: true })).color).l;
      expect(hover).toBeGreaterThan(resting);
      expect(hover).toBeLessThan(picked);
    }
  });

  it('stays in the face’s own hue as well', () => {
    expect(hsl(faceLook(state({ hovered: true })).color).h).toBeCloseTo(hsl(PANEL_BLUE).h, 2);
  });

  it('does not add the selected face’s glow', () => {
    expect(faceLook(state({ hovered: true })).emissiveIntensity).toBe(
      faceLook(state()).emissiveIntensity,
    );
  });

  it('gives way to selection when a face is both', () => {
    const both = faceLook(state({ isSelected: true, hovered: true }));
    expect(hex(both.color)).toBe(hex(faceLook(state({ isSelected: true })).color));
  });
});

describe('the pair of faces at a selected edge', () => {
  it('is tinted as a pair, which brightness could not say', () => {
    // Angles mode marks *both* faces of the edge being measured. That is a statement about
    // the two of them together, so it deliberately outranks a face's own colour.
    expect(hex(faceLook(state({ inSelectedEdgePair: true })).color)).toBe(EDGE_PAIR_PURPLE);
    expect(hex(faceLook(state({ isBase: true, inSelectedEdgePair: true })).color)).toBe(EDGE_PAIR_PURPLE);
  });

  it('outranks selection too, so the pair reads as one thing', () => {
    expect(hex(faceLook(state({ isSelected: true, inSelectedEdgePair: true })).color)).toBe(EDGE_PAIR_PURPLE);
  });
});

describe('lighten', () => {
  it('holds the hue exactly', () => {
    const after = hsl(lighten(PANEL_BLUE, { lightness: 0.2, saturation: 0.1 }));
    expect(after.h).toBeCloseTo(hsl(PANEL_BLUE).h, 9);
  });

  it('raises lightness and saturation by what it was asked for', () => {
    const before = hsl(PANEL_BLUE);
    const after = hsl(lighten(PANEL_BLUE, HOVER_LIFT));
    expect(after.l - before.l).toBeCloseTo(HOVER_LIFT.lightness, 9);
    expect(after.s - before.s).toBeCloseTo(HOVER_LIFT.saturation, 9);
  });

  it('deepens the colour as it lightens, which is the point of the pair', () => {
    // Lightness on its own drains the hue; a colour near white is barely a colour.
    expect(SELECTED_LIFT.saturation).toBeGreaterThan(0);
    const picked = hsl(faceLook(state({ isSelected: true })).color);
    expect(picked.s).toBeGreaterThan(hsl(PANEL_BLUE).s);
  });

  it('stops at white rather than wrapping round', () => {
    const white = lighten('#ffffff', { lightness: 0.5, saturation: 0.5 });
    expect(hsl(white).l).toBeLessThanOrEqual(1);
    expect(hsl(white).l).toBeCloseTo(1, 5);
  });
});
