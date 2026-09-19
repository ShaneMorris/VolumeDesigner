import Drawing from 'dxf-writer';
import type { LaidOutPanel } from '../geometry/unfold';

/** One DXF (R12 ASCII, inches) per panel: outline as a closed polyline, holes as circles. */
export function panelToDxfString(panel: LaidOutPanel): string {
  const d = new Drawing();
  d.setUnits('Inches');

  const points: [number, number][] = panel.outline.map((p) => [p.x + panel.offset.x, p.y + panel.offset.y]);
  d.drawPolyline(points, true);

  for (const hole of panel.holes) {
    d.drawCircle(hole.x + panel.offset.x, hole.y + panel.offset.y, hole.diameterIn / 2);
  }

  return d.toDxfString();
}

/** One combined DXF with every panel laid out on its own non-overlapping footprint. */
export function combinedDxfString(panels: LaidOutPanel[]): string {
  const d = new Drawing();
  d.setUnits('Inches');

  for (const panel of panels) {
    const points: [number, number][] = panel.outline.map((p) => [p.x + panel.offset.x, p.y + panel.offset.y]);
    d.drawPolyline(points, true);
    for (const hole of panel.holes) {
      d.drawCircle(hole.x + panel.offset.x, hole.y + panel.offset.y, hole.diameterIn / 2);
    }
  }

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
