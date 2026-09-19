import { useDesignStore } from '../../store/designStore';
import { NumberField } from '../ui/NumberField';

export function HolesPanel() {
  const design = useDesignStore((s) => s.design);
  const selectedHoleId = useDesignStore((s) => s.selectedHoleId);
  const selectHole = useDesignStore((s) => s.selectHole);
  const updateHole = useDesignStore((s) => s.updateHole);
  const removeHole = useDesignStore((s) => s.removeHole);

  const faceLabel = (id: string) => design.faces.find((f) => f.id === id)?.label ?? id;

  return (
    <div>
      <p className="panel-hint">
        Click anywhere on a face to drop a 0.5in T-nut hole there, then fine-tune its position numerically. X/Y are
        measured from the face's first vertex, along its first edge.
      </p>

      {design.holes.length === 0 && <div className="status-row">No holes yet.</div>}

      {design.holes.map((hole) => (
        <div
          key={hole.id}
          className={`inspector-group ${selectedHoleId === hole.id ? 'row-selected' : ''}`}
          onClick={() => selectHole(hole.id)}
        >
          <div className="inspector-group-title">
            {faceLabel(hole.faceId)} — ⌀{hole.diameterIn}in
          </div>
          <NumberField label="X (u)" value={hole.u} suffix="in" onCommit={(v) => updateHole(hole.id, v, hole.v)} />
          <NumberField label="Y (v)" value={hole.v} suffix="in" onCommit={(v) => updateHole(hole.id, hole.u, v)} />
          <div className="button-row">
            <button className="danger" onClick={() => removeHole(hole.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
