import Drawing from 'dxf-writer';
import type { LaidOutPanel } from '../geometry/unfold';

// `dxf-writer`'s type declarations omit this method, even though it exists at runtime.
interface DrawingWithAutocadExtras extends Drawing {
  generateAutocadExtras(): Drawing;
}

/**
 * `dxf-writer`'s `setUnits('Inches')` only writes the `$INSUNITS` header variable.
 * Several importers (Carveco Maker among them) instead — or additionally — check the
 * older `$MEASUREMENT` variable (0 = imperial/inches, 1 = metric) to decide whether a
 * drawing carries real-world units at all; without it they treat the file as unitless
 * and either prompt for units or fall back to some default scaling. `generateAutocadExtras`
 * fills in the standard tables (VPORT/STYLE/VIEW/UCS/APPID/DIMSTYLE) that a plain
 * `dxf-writer` drawing otherwise omits, which stricter commercial importers expect.
 */
function newInchDrawing(): Drawing {
  const d = new Drawing();
  d.setUnits('Inches');
  d.header('MEASUREMENT', [[70, 0]]);
  (d as DrawingWithAutocadExtras).generateAutocadExtras();
  return d;
}

function drawPanel(d: Drawing, panel: LaidOutPanel) {
  const points: [number, number][] = panel.outline.map((p) => [p.x + panel.offset.x, p.y + panel.offset.y]);
  d.drawPolyline(points, true);
  for (const hole of panel.holes) {
    d.drawCircle(hole.x + panel.offset.x, hole.y + panel.offset.y, hole.diameterIn / 2);
  }
}

/** One DXF (inches, unit-tagged) per panel: outline as a closed polyline, holes as circles. */
export function panelToDxfString(panel: LaidOutPanel): string {
  const d = newInchDrawing();
  drawPanel(d, panel);
  return d.toDxfString();
}

/** One combined DXF with every panel laid out on its own non-overlapping footprint. */
export function combinedDxfString(panels: LaidOutPanel[]): string {
  const d = newInchDrawing();
  for (const panel of panels) drawPanel(d, panel);
  return d.toDxfString();
}

export function downloadTextFile(filename: string, content: string, mime = 'application/dxf') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(label: string): string {
  return label.replace(/[^a-z0-9_-]+/gi, '_');
}

export function exportAllPanelsAsFiles(panels: LaidOutPanel[]) {
  panels.forEach((panel, i) => {
    const dxf = panelToDxfString(panel);
    downloadTextFile(`${String(i + 1).padStart(2, '0')}_${sanitizeFilename(panel.label)}.dxf`, dxf);
  });
}

export function exportCombinedFile(panels: LaidOutPanel[]) {
  const dxf = combinedDxfString(panels);
  downloadTextFile('volume_layout.dxf', dxf);
}
