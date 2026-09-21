import type { LaidOutPanel } from '../geometry/unfold';
import { buildDxf, type DxfCircle, type DxfDrawingInput, type DxfPolyline } from './dxfWriter';

function panelGeometry(panel: LaidOutPanel): { polyline: DxfPolyline; circles: DxfCircle[] } {
  const polyline: DxfPolyline = {
    points: panel.outline.map((p) => ({ x: p.x + panel.offset.x, y: p.y + panel.offset.y })),
    closed: true,
  };
  const circles: DxfCircle[] = panel.holes.map((hole) => ({
    center: { x: hole.x + panel.offset.x, y: hole.y + panel.offset.y },
    radius: hole.diameterIn / 2,
  }));
  return { polyline, circles };
}

/** One DXF (R12 ASCII, inches) per panel: outline as a closed polyline, holes as circles. */
export function panelToDxfString(panel: LaidOutPanel): string {
  const { polyline, circles } = panelGeometry(panel);
  return buildDxf({ polylines: [polyline], circles });
}

/** One combined DXF with every panel laid out on its own non-overlapping footprint. */
export function combinedDxfString(panels: LaidOutPanel[]): string {
  const input: DxfDrawingInput = { polylines: [], circles: [] };
  for (const panel of panels) {
    const { polyline, circles } = panelGeometry(panel);
    input.polylines.push(polyline);
    input.circles.push(...circles);
  }
  return buildDxf(input);
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
