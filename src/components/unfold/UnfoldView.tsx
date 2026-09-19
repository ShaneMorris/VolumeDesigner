import type { LaidOutPanel } from '../../geometry/unfold';

const SCALE = 24; // px per inch

interface UnfoldViewProps {
  panels: LaidOutPanel[];
}

export function UnfoldView({ panels }: UnfoldViewProps) {
  if (panels.length === 0) {
    return <div className="panel-hint">No faces to unfold yet.</div>;
  }

  let maxX = 0;
  let maxY = 0;
  for (const panel of panels) {
    for (const p of panel.outline) {
      maxX = Math.max(maxX, p.x + panel.offset.x);
      maxY = Math.max(maxY, p.y + panel.offset.y);
    }
  }
  const widthPx = (maxX + 1) * SCALE;
  const heightPx = (maxY + 1) * SCALE;

  // Flip Y for screen coordinates (SVG y grows downward, our panel space grows upward).
  const toScreen = (x: number, y: number): [number, number] => [x * SCALE, heightPx - y * SCALE];

  return (
    <svg width="100%" viewBox={`0 0 ${widthPx} ${heightPx}`} style={{ background: '#0f1115', border: '1px solid #2a2f38' }}>
      {panels.map((panel) => {
        const pts = panel.outline.map((p) => toScreen(p.x + panel.offset.x, p.y + panel.offset.y));
        const pathD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z';

        const centroid = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]).map((v) => v / pts.length);

        return (
          <g key={panel.faceId}>
            <path d={pathD} fill={panel.isPlanar ? '#20303d' : '#402a1f'} stroke="#7dd3fc" strokeWidth={1.5} />
            {!panel.isPlanar && panel.internalDiagonal && (
              <line
                x1={pts[panel.internalDiagonal[0]][0]}
                y1={pts[panel.internalDiagonal[0]][1]}
                x2={pts[panel.internalDiagonal[1]][0]}
                y2={pts[panel.internalDiagonal[1]][1]}
                stroke="#f59e0b"
                strokeDasharray="4 3"
                strokeWidth={1}
              />
            )}
            {panel.edges.map((edge, i) => {
              if (edge.bevelAngleDeg === null) return null;
              const a = pts[i];
              const b = pts[(i + 1) % pts.length];
              const mx = (a[0] + b[0]) / 2;
              const my = (a[1] + b[1]) / 2;
              return (
                <text key={i} x={mx} y={my} fontSize={11} fill="#facc15" textAnchor="middle">
                  {edge.bevelAngleDeg.toFixed(1)}°
                </text>
              );
            })}
            {panel.holes.map((hole) => {
              const [hx, hy] = toScreen(hole.x + panel.offset.x, hole.y + panel.offset.y);
              return <circle key={hole.holeId} cx={hx} cy={hy} r={(hole.diameterIn / 2) * SCALE} fill="none" stroke="#ef4444" strokeWidth={1.5} />;
            })}
            <text x={centroid[0]} y={centroid[1]} fontSize={13} fill="#e5e7eb" textAnchor="middle" fontWeight="bold">
              {panel.label}
            </text>
            {!panel.isPlanar && (
              <text x={centroid[0]} y={centroid[1] + 16} fontSize={10} fill="#f59e0b" textAnchor="middle">
                non-planar (approximated)
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
