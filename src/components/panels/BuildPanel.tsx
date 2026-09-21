import { useState } from 'react';
import { useDesignStore, type BuildTool } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NumberField } from '../ui/NumberField';

const TOOL_LABELS: Record<BuildTool, string> = {
  select: '⬚ Select',
  move: '✥ Move',
  draw: '✎ Draw',
};

const TOOL_HINTS: Record<BuildTool, string> = {
  select: 'Click a vertex or face to select it for the numeric inspector, locking, or the pull-up shortcut.',
  move: 'Click and drag any vertex to move it. Dragging slides it horizontally; hold Shift while dragging to move it straight up and down. Locked vertices stay put.',
  draw: 'Click an existing vertex to start a face, then keep clicking to add edges — click another vertex to snap to it, or click empty space to drop a new point on the work plane. Click the first vertex again (3+ points) to close the face. Right-click cancels.',
};

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
  const buildTool = useDesignStore((s) => s.buildTool);
  const setBuildTool = useDesignStore((s) => s.setBuildTool);
  const addDraftNewVertex = useDesignStore((s) => s.addDraftNewVertex);

  const [pullHeight, setPullHeight] = useState(3);
  const [exactX, setExactX] = useState(0);
  const [exactY, setExactY] = useState(0);
  const selectedFace = design.faces.find((f) => f.id === selectedFaceId);
  const baseFace = design.faces.find((f) => f.id === design.baseFaceId);
  const baseVertices = baseFace ? design.vertices.filter((v) => baseFace.vertexIds.includes(v.id)) : [];
  const baseFullyLocked = baseVertices.length > 0 && baseVertices.every((v) => v.locked);

  return (
    <div>
      <div className="tool-row">
        {(['select', 'move', 'draw'] as const).map((tool) => (
          <button
            key={tool}
            className={buildTool === tool ? 'tool-active' : ''}
            onClick={() => setBuildTool(tool)}
          >
            {TOOL_LABELS[tool]}
          </button>
        ))}
      </div>
      <p className="panel-hint">{TOOL_HINTS[buildTool]}</p>

      {buildTool === 'draw' && (
        <>
          <div className="status-row">
            {draftVertexIds.length === 0 && 'No face in progress — click an existing vertex to start one.'}
            {draftVertexIds.length > 0 && `Drawing face: ${draftVertexIds.length} point(s) picked.`}
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
                Clicks on empty space land on this horizontal plane (the blue grid). A yellow ghost marker
                shows exactly where the point will go before you click. Adjust the height between clicks to
                place points at different levels.
              </p>

              <div className="inspector-group">
                <div className="inspector-group-title">Add point by exact coordinates</div>
                <NumberField label="X" value={exactX} suffix="in" onCommit={setExactX} />
                <NumberField label="Y" value={exactY} suffix="in" onCommit={setExactY} />
                <div className="button-row">
                  <button onClick={() => addDraftNewVertex({ x: exactX, y: exactY, z: workPlaneZ })}>
                    Add point at X/Y, Z={workPlaneZ}
                  </button>
                </div>
              </div>

              <div className="button-row">
                <button onClick={cancelDraft}>Cancel</button>
                <button disabled={draftVertexIds.length < 3} className="primary" onClick={() => closeDraftFace()}>
                  Close Face
                </button>
              </div>
            </>
          )}
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
            A locked vertex can still be clicked to start/close a face, but the Move tool won't budge it.
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
