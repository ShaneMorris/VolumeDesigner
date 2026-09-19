import { useDesignStore } from '../../store/designStore';
import { dihedralAngleDeg, findSharedEdge, sharedEdges } from '../../geometry/mesh';
import { NumberField } from '../ui/NumberField';

// Placeholder bevel-bit presets — spec calls out the exact list as "TBD with Shane".
// These are common faceted-construction fold angles (regular-polygon prism corners).
const PRESETS = [
  { label: '90° (box)', deg: 90 },
  { label: '108° (pentagon)', deg: 108 },
  { label: '120° (hexagon)', deg: 120 },
  { label: '135° (octagon)', deg: 135 },
  { label: '144° (decagon)', deg: 144 },
];

export function AnglesPanel() {
  const design = useDesignStore((s) => s.design);
  const selectedEdge = useDesignStore((s) => s.selectedEdge);
  const selectedFaceId = useDesignStore((s) => s.selectedFaceId);
  const selectFace = useDesignStore((s) => s.selectFace);
  const selectEdge = useDesignStore((s) => s.selectEdge);
  const lockDihedralAngle = useDesignStore((s) => s.lockDihedralAngle);
  const unlockDihedralAngle = useDesignStore((s) => s.unlockDihedralAngle);

  const edges = sharedEdges(design);
  const currentAngle = selectedEdge ? dihedralAngleDeg(design, findSharedEdge(design, selectedEdge.faceAId, selectedEdge.faceBId)!) : null;
  const currentLock = selectedEdge
    ? design.angleLocks.find(
        (l) =>
          (l.faceAId === selectedEdge.faceAId && l.faceBId === selectedEdge.faceBId) ||
          (l.faceAId === selectedEdge.faceBId && l.faceBId === selectedEdge.faceAId),
      )
    : undefined;

  const faceLabel = (id: string) => design.faces.find((f) => f.id === id)?.label ?? id;

  return (
    <div>
      <p className="panel-hint">
        Click one face, then an adjacent face, to select the edge between them and see/lock its dihedral (bevel)
        angle. 180° = flat (no fold); smaller values fold the faces together more sharply.
      </p>

      <div className="status-row">
        {!selectedEdge && !selectedFaceId && 'Click a face to begin.'}
        {!selectedEdge && selectedFaceId && `${faceLabel(selectedFaceId)} selected — click an adjacent face.`}
      </div>

      {selectedEdge && currentAngle !== null && (
        <div className="inspector-group">
          <div className="inspector-group-title">
            {faceLabel(selectedEdge.faceAId)} ↔ {faceLabel(selectedEdge.faceBId)}
          </div>
          <NumberField
            label="Dihedral angle"
            value={currentAngle}
            suffix="°"
            min={0}
            max={180}
            onCommit={(v) => lockDihedralAngle(selectedEdge.faceAId, selectedEdge.faceBId, v)}
          />
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button key={p.deg} onClick={() => lockDihedralAngle(selectedEdge.faceAId, selectedEdge.faceBId, p.deg)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="button-row">
            {currentLock ? (
              <button className="danger" onClick={() => unlockDihedralAngle(currentLock.id)}>
                Unlock angle
              </button>
            ) : (
              <span className="panel-hint">Not locked — edit the value above to lock it.</span>
            )}
            <button
              onClick={() => {
                selectEdge(null);
                selectFace(null);
              }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      <hr />
      <div className="inspector-group-title">All shared edges</div>
      <table className="dim-table">
        <thead>
          <tr>
            <th>Faces</th>
            <th>Angle</th>
            <th>Locked</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e) => {
            const angle = dihedralAngleDeg(design, e);
            const lock = design.angleLocks.find(
              (l) =>
                (l.faceAId === e.faceIds[0] && l.faceBId === e.faceIds[1]) ||
                (l.faceAId === e.faceIds[1] && l.faceBId === e.faceIds[0]),
            );
            return (
              <tr
                key={e.key}
                className={
                  selectedEdge && selectedEdge.a === e.a && selectedEdge.b === e.b ? 'row-selected' : undefined
                }
                onClick={() =>
                  selectEdge({ a: e.a, b: e.b, faceAId: e.faceIds[0], faceBId: e.faceIds[1] })
                }
              >
                <td>
                  {faceLabel(e.faceIds[0])} ↔ {faceLabel(e.faceIds[1])}
                </td>
                <td>{angle.toFixed(2)}°</td>
                <td>{lock ? `${lock.targetAngleDeg}°` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
