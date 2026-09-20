import { useDesignStore } from '../../store/designStore';
import { edgeLength } from '../../geometry/mesh';
import { NumberField } from '../ui/NumberField';

/**
 * Numeric editor for the currently-selected vertex: its interior angle within each face
 * it belongs to, and the length of its two adjacent edges in that face (anchored at the
 * selected vertex, so editing a length moves only the neighboring vertex).
 */
export function VertexInspector() {
  const design = useDesignStore((s) => s.design);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const setEdgeLength = useDesignStore((s) => s.setEdgeLength);
  const setInteriorAngle = useDesignStore((s) => s.setInteriorAngle);
  const setVertexLocked = useDesignStore((s) => s.setVertexLocked);

  if (!selectedVertexId) {
    return <div className="panel-hint">Select a vertex to edit its edges and angle numerically.</div>;
  }

  const vertex = design.vertices.find((v) => v.id === selectedVertexId);
  if (!vertex) return null;

  const lockToggle = (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={!!vertex.locked}
        onChange={(e) => setVertexLocked(vertex.id, e.target.checked)}
      />
      Locked (can't be dragged in Build mode)
    </label>
  );

  const memberFaces = design.faces.filter((f) => f.vertexIds.includes(selectedVertexId));
  if (memberFaces.length === 0) {
    return (
      <div>
        {lockToggle}
        <div className="panel-hint">Selected vertex isn't part of any face yet.</div>
      </div>
    );
  }

  return (
    <div className="inspector">
      {lockToggle}
      {memberFaces.map((face) => {
        const n = face.vertexIds.length;
        const idx = face.vertexIds.indexOf(selectedVertexId);
        const prevId = face.vertexIds[(idx - 1 + n) % n];
        const nextId = face.vertexIds[(idx + 1) % n];
        const prevLen = edgeLength(design, selectedVertexId, prevId);
        const nextLen = edgeLength(design, selectedVertexId, nextId);

        return (
          <div key={face.id} className="inspector-group">
            <div className="inspector-group-title">{face.label}</div>
            <NumberField
              label={`Edge → ${labelFor(prevId)}`}
              value={prevLen}
              suffix="in"
              onCommit={(v) => setEdgeLength(selectedVertexId, prevId, v)}
            />
            <NumberField
              label={`Edge → ${labelFor(nextId)}`}
              value={nextLen}
              suffix="in"
              onCommit={(v) => setEdgeLength(selectedVertexId, nextId, v)}
            />
            {n >= 3 && (
              <NumberField
                label="Interior angle"
                value={interiorAngleDeg(design, face.id, selectedVertexId)}
                suffix="°"
                onCommit={(v) => setInteriorAngle(face.id, selectedVertexId, v)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function labelFor(vertexId: string): string {
  return vertexId.slice(0, 6);
}

function interiorAngleDeg(
  design: ReturnType<typeof useDesignStore.getState>['design'],
  faceId: string,
  vertexId: string,
): number {
  const face = design.faces.find((f) => f.id === faceId)!;
  const n = face.vertexIds.length;
  const idx = face.vertexIds.indexOf(vertexId);
  const prevId = face.vertexIds[(idx - 1 + n) % n];
  const nextId = face.vertexIds[(idx + 1) % n];
  const p = design.vertices.find((v) => v.id === vertexId)!.position;
  const prev = design.vertices.find((v) => v.id === prevId)!.position;
  const next = design.vertices.find((v) => v.id === nextId)!.position;
  const toPrev = { x: prev.x - p.x, y: prev.y - p.y, z: prev.z - p.z };
  const toNext = { x: next.x - p.x, y: next.y - p.y, z: next.z - p.z };
  const dot = toPrev.x * toNext.x + toPrev.y * toNext.y + toPrev.z * toNext.z;
  const mag = Math.hypot(toPrev.x, toPrev.y, toPrev.z) * Math.hypot(toNext.x, toNext.y, toNext.z);
  return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
}
