/**
 * Minimal AutoCAD R12 (AC1009) ASCII DXF writer.
 *
 * Hand-written rather than library-generated on purpose. `dxf-writer` emits AC1021
 * with LWPOLYLINE entities and stringifies coordinates with plain JS number formatting,
 * which produces values like `5.551115123125783e-17` for floating-point near-zeros.
 * DXF readers expect plain decimal reals and reject scientific notation, so those files
 * fail to import (Carveco Maker reports "Unable to read <file>"). R12 is also the most
 * broadly accepted flavor — it's what the project spec called for.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Coordinates below this magnitude are floating-point noise and are written as 0. */
const ZERO_SNAP = 1e-9;
const DECIMALS = 6;
/**
 * No real panel coordinate approaches this. Anything beyond it is a geometry bug, and
 * `toFixed` also reverts to exponent notation past 1e21, so reject rather than emit
 * something a DXF reader can't parse.
 */
const MAX_MAGNITUDE = 1e9;

/**
 * Formats a real for DXF: fixed decimal notation only, never exponent form, with
 * floating-point noise snapped to zero and `-0` normalized.
 */
export function formatDxfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to write non-finite DXF coordinate: ${value}`);
  }
  if (Math.abs(value) > MAX_MAGNITUDE) {
    throw new Error(`Refusing to write implausible DXF coordinate: ${value}`);
  }
  const snapped = Math.abs(value) < ZERO_SNAP ? 0 : value;
  const text = snapped.toFixed(DECIMALS);
  return text === `-${(0).toFixed(DECIMALS)}` ? (0).toFixed(DECIMALS) : text;
}

class DxfBuilder {
  private lines: string[] = [];

  tag(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === 'number' ? formatDxfNumber(value) : value);
    return this;
  }

  /** Group codes that carry integers (flags, counts, colors) must not be decimal-formatted. */
  intTag(code: number, value: number): this {
    this.lines.push(String(code), String(Math.trunc(value)));
    return this;
  }

  toString(): string {
    return this.lines.join('\r\n') + '\r\n';
  }
}

export interface DxfCircle {
  center: Vec2;
  radius: number;
}

export interface DxfPolyline {
  points: Vec2[];
  closed: boolean;
}

export interface DxfDrawingInput {
  polylines: DxfPolyline[];
  circles: DxfCircle[];
}

const LAYER = '0';

function extents(input: DxfDrawingInput): { min: Vec2; max: Vec2 } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of input.polylines) {
    for (const pt of p.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  }
  for (const c of input.circles) {
    xs.push(c.center.x - c.radius, c.center.x + c.radius);
    ys.push(c.center.y - c.radius, c.center.y + c.radius);
  }
  if (xs.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

export function buildDxf(input: DxfDrawingInput): string {
  for (const p of input.polylines) {
    for (const pt of p.points) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        throw new Error('Panel outline contains a non-finite coordinate; refusing to export.');
      }
    }
  }
  for (const c of input.circles) {
    if (!Number.isFinite(c.center.x) || !Number.isFinite(c.center.y) || !Number.isFinite(c.radius)) {
      throw new Error('Hole contains a non-finite coordinate; refusing to export.');
    }
  }

  const { min, max } = extents(input);
  const d = new DxfBuilder();

  // HEADER — R12 version plus the two unit variables importers look at.
  d.tag(0, 'SECTION').tag(2, 'HEADER');
  d.tag(9, '$ACADVER').tag(1, 'AC1009');
  d.tag(9, '$INSUNITS').intTag(70, 1); // 1 = Inches
  d.tag(9, '$MEASUREMENT').intTag(70, 0); // 0 = Imperial
  d.tag(9, '$EXTMIN').tag(10, min.x).tag(20, min.y).tag(30, 0);
  d.tag(9, '$EXTMAX').tag(10, max.x).tag(20, max.y).tag(30, 0);
  d.tag(0, 'ENDSEC');

  // TABLES — just the default layer, which some readers require to exist.
  d.tag(0, 'SECTION').tag(2, 'TABLES');
  d.tag(0, 'TABLE').tag(2, 'LAYER').intTag(70, 1);
  d.tag(0, 'LAYER').tag(2, LAYER).intTag(70, 0).intTag(62, 7).tag(6, 'CONTINUOUS');
  d.tag(0, 'ENDTAB');
  d.tag(0, 'ENDSEC');

  // ENTITIES
  d.tag(0, 'SECTION').tag(2, 'ENTITIES');
  for (const polyline of input.polylines) {
    if (polyline.points.length < 2) continue;
    d.tag(0, 'POLYLINE').tag(8, LAYER).intTag(66, 1).intTag(70, polyline.closed ? 1 : 0);
    d.tag(10, 0).tag(20, 0).tag(30, 0);
    for (const pt of polyline.points) {
      d.tag(0, 'VERTEX').tag(8, LAYER).tag(10, pt.x).tag(20, pt.y).tag(30, 0);
    }
    d.tag(0, 'SEQEND').tag(8, LAYER);
  }
  for (const circle of input.circles) {
    d.tag(0, 'CIRCLE').tag(8, LAYER);
    d.tag(10, circle.center.x).tag(20, circle.center.y).tag(30, 0);
    d.tag(40, circle.radius);
  }
  d.tag(0, 'ENDSEC');

  d.tag(0, 'EOF');
  return d.toString();
}
