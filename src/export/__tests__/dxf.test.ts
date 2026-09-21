import { describe, expect, it } from 'vitest';
import { combinedDxfString, panelToDxfString } from '../dxf';
import { buildDxf, formatDxfNumber } from '../dxfWriter';
import type { LaidOutPanel } from '../../geometry/unfold';

function makeSquarePanel(overrides: Partial<LaidOutPanel> = {}): LaidOutPanel {
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
    ...overrides,
  };
}

/** Every numeric value a DXF reader will try to parse as a real. */
function realValuesIn(dxf: string): string[] {
  const lines = dxf.split(/\r?\n/);
  const reals: string[] = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = Number(lines[i]);
    // Group codes 10-59 carry reals in the entities/headers we emit.
    if (code >= 10 && code <= 59) reals.push(lines[i + 1]);
  }
  return reals;
}

describe('formatDxfNumber', () => {
  it('never emits scientific notation, even for floating-point near-zeros', () => {
    // This exact value appeared in real exports and made Carveco reject the file.
    expect(formatDxfNumber(5.551115123125783e-17)).toBe('0.000000');
    expect(formatDxfNumber(1e-12)).not.toMatch(/e/i);
    expect(formatDxfNumber(123456.789)).not.toMatch(/e/i);
  });

  it('refuses implausibly large coordinates instead of falling back to exponent form', () => {
    expect(() => formatDxfNumber(1e21)).toThrow(/implausible/i);
  });

  it('normalizes negative zero', () => {
    expect(formatDxfNumber(-0)).toBe('0.000000');
    expect(formatDxfNumber(-1e-15)).toBe('0.000000');
  });

  it('refuses non-finite values rather than writing garbage', () => {
    expect(() => formatDxfNumber(Number.NaN)).toThrow();
    expect(() => formatDxfNumber(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('DXF output format', () => {
  it('is R12 (AC1009) and declares inches', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    expect(dxf).toMatch(/\$INSUNITS\r?\n70\r?\n1/);
    expect(dxf).toMatch(/\$MEASUREMENT\r?\n70\r?\n0/);
  });

  it('uses R12 POLYLINE/VERTEX/SEQEND rather than LWPOLYLINE', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf).toContain('POLYLINE');
    expect(dxf).toContain('VERTEX');
    expect(dxf).toContain('SEQEND');
    expect(dxf).not.toContain('LWPOLYLINE');
  });

  it('emits one vertex per outline point and a circle per hole', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf.match(/\r?\nVERTEX\r?\n/g)?.length).toBe(4);
    expect(dxf.match(/\r?\nCIRCLE\r?\n/g)?.length).toBe(1);
  });

  it('writes no coordinate in scientific notation', () => {
    // Offsets chosen so the arithmetic produces floating-point noise near zero.
    const panel = makeSquarePanel({
      outline: [
        { x: 0.1 + 0.2 - 0.3, y: 0 },
        { x: 2, y: 5.551115123125783e-17 },
        { x: 2, y: 2 },
      ],
      offset: { x: 5.551115123125783e-17, y: 0 },
      holes: [],
    });
    const dxf = panelToDxfString(panel);
    for (const value of realValuesIn(dxf)) {
      expect(value).not.toMatch(/e/i);
      expect(value).not.toMatch(/NaN|Infinity/);
    }
  });

  it('terminates with EOF and balanced sections', () => {
    const dxf = panelToDxfString(makeSquarePanel());
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf.match(/\r?\nSECTION\r?\n/g)?.length).toBe(3); // HEADER, TABLES, ENTITIES
    expect(dxf.match(/\r?\nENDSEC\r?\n/g)?.length).toBe(3);
  });

  it('combined export includes every panel in one drawing', () => {
    const dxf = combinedDxfString([makeSquarePanel(), makeSquarePanel({ faceId: 'f2', label: 'Side 1' })]);
    expect(dxf.match(/\r?\nPOLYLINE\r?\n/g)?.length).toBe(2);
    expect(dxf.match(/\r?\nCIRCLE\r?\n/g)?.length).toBe(2);
  });

  it('refuses to export a panel with non-finite geometry', () => {
    const broken = makeSquarePanel({ outline: [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 2, y: 2 }] });
    expect(() => panelToDxfString(broken)).toThrow(/non-finite/i);
  });

  it('handles an empty drawing without emitting bad extents', () => {
    const dxf = buildDxf({ polylines: [], circles: [] });
    expect(dxf).toContain('$EXTMIN');
    for (const value of realValuesIn(dxf)) expect(value).not.toMatch(/e|NaN|Infinity/i);
  });
});
