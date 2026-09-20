import { useState } from 'react';
import { useDesignStore } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NumberField } from '../ui/NumberField';

export function BuildPanel() {
  const design = useDesignStore((s) => s.design);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const cancelDraft = useDesignStore((s) => s.cancelDraft);
  const closeDraftFace = useDesignStore((s) => s.closeDraftFace);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const selectedFaceId = useDesignStore((s) => s.selectedFaceId);
  const renameFace = useDesignStore((s) => s.renameFace);
  const deleteFace = useDesignStore((s) => s.deleteFace);
  const pullUpFace = useDesignStore((s) => s.pullUpFace);
  const setBaseFaceId = useDesignStore((s) => s.setBaseFaceId);
  const workPlaneZ = useDesignStore((s) => s.workPlaneZ);
  const setWorkPlaneZ = useDesignStore((s) => s.setWorkPlaneZ);
  const setVerticesLocked = useDesignStore((s) => s.setVerticesLocked);

  const [pullHeight, setPullHeight] = useState(3);
  const selectedFace = design.faces.find((f) => f.id === selectedFaceId);
  const baseFace = design.faces.find((f) => f.id === design.baseFaceId);
  const baseVertices = baseFace ? design.vertices.filter((v) => baseFace.vertexIds.includes(v.id)) : [];
  const baseFullyLocked = baseVertices.length > 0 && baseVertices.every((v) => v.locked);

  return (
    <div>
      <p className="panel-hint">
        Click an existing vertex to start a new face, then keep clicking to add edges: click another existing
        vertex to snap to it, or click empty space above the base to drop a new point on the work plane below.
        Click the first vertex again (with 3+ picked) to close the face. Right-click cancels.
        <br />
        <strong>Shift-click</strong> a vertex to select it instead (for the numeric inspector, drag gizmo, or
        lock toggle) without affecting any face you're drawing.
      </p>

      <div className="status-row">
        {draftVertexIds.length === 0 && 'No face in progress — click an existing vertex to start one.'}
        {draftVertexIds.length > 0 && `Drawing face: ${draftVertexIds.length} vertex/vertices picked.`}
      </div>
      {draftVertexIds.length > 0 && (
        <>
          <NumberField
            label="Work plane height (Z)"
            value={workPlaneZ}
            suffix="in"
            onCommit={setWorkPlaneZ}
          />
          <p className="panel-hint">
            New points from clicking empty space land on this horizontal plane (shown as a faint blue grid).
            Adjust it between clicks to place points at different heights.
          </p>
          <div className="button-row">
            <button onClick={cancelDraft}>Cancel</button>
            <button disabled={draftVertexIds.length < 3} className="primary" onClick={() => closeDraftFace()}>
              Close Face
            </button>
          </div>
        </>
      )}

      {design.baseFaceId && (
        <>
          <hr />
          <div className="inspector-group-title">Pull-up shortcut</div>
          <p className="panel-hint">
            Extrudes the selected base face straight up by a height. Result is ordinary editable
            geometry afterward — not the default action.
          </p>
          <NumberField label="Height" value={pullHeight} suffix="in" onCommit={setPullHeight} />
          <div className="button-row">
            <button
              disabled={!selectedFaceId}
              onClick={() => selectedFaceId && pullUpFace(selectedFaceId, pullHeight)}
            >
              Pull up selected face
            </button>
          </div>

          <div className="inspector-group-title">Vertex locking</div>
          <p className="panel-hint">
            A locked vertex can still be clicked to start/close a face, but its drag gizmo won't appear.
          </p>
          <div className="button-row">
            <button onClick={() => setVerticesLocked(baseVertices.map((v) => v.id), !baseFullyLocked)}>
              {baseFullyLocked ? 'Unlock base vertices' : 'Lock base vertices'}
            </button>
          </div>
        </>
      )}

      {selectedFace && (
        <>
          <hr />
          <div className="inspector-group-title">Selected face: {selectedFace.label}</div>
          <label className="number-field">
            <span className="number-field-label">Label</span>
            <input
              type="text"
              value={selectedFace.label}
              onChange={(e) => renameFace(selectedFace.id, e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              disabled={design.baseFaceId === selectedFace.id}
              onClick={() => setBaseFaceId(selectedFace.id)}
            >
              Set as base
            </button>
            <button className="danger" onClick={() => deleteFace(selectedFace.id)}>
              Delete face
            </button>
          </div>
        </>
      )}

      {selectedVertexId && (
        <>
          <hr />
          <VertexInspector />
        </>
      )}
    </div>
  );
}
