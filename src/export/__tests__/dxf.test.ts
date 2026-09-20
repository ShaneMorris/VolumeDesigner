import { describe, expect, it } from 'vitest';
import { combinedDxfString, panelToDxfString } from '../dxf';
import type { LaidOutPanel } from '../../geometry/unfold';

function makeSquarePanel(): LaidOutPanel {
  return {
    faceId: 'f1',
    label: 'Base',
    outline: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    edges: [],
    holes: [{ holeId: 'h1', x: 1, y: 1, diameterIn: 0.5 }],
    isPlanar: true,
    internalDiagonal: null,
    offset: { x: 0, y: 0 },
  };
}

describe('DXF export unit tagging', () => {
  it('declares both $INSUNITS and $MEASUREMENT as inches/imperial', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf).toMatch(/\$INSUNITS\s*\n70\s*\n1/);
    expect(dxf).toMatch(/\$MEASUREMENT\s*\n70\s*\n0/);
  });

  it('includes the standard extra tables so stricter importers accept the file', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf).toContain('VPORT');
    expect(dxf).toContain('DIMSTYLE');
  });

  it('emits a polyline and a circle for the panel outline and hole', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf).toContain('LWPOLYLINE');
    expect(dxf).toContain('CIRCLE');
  });

  it('combined export tags units once and draws every panel', () => {
    const dxf = combinedDxfString([makeSquarePanel(), { ...makeSquarePanel(), faceId: 'f2', label: 'Side 1' }]);
    expect(dxf.match(/\$MEASUREMENT/g)?.length).toBe(1);
    expect(dxf.match(/LWPOLYLINE/g)?.length).toBe(2);
  });
});
