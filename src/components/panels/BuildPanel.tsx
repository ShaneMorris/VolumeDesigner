import { useState } from 'react';
import { useDesignStore, type BuildTool } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NextPointPanel } from './NextPointPanel';
import { NumberField } from '../ui/NumberField';

const TOOL_LABELS: Record<BuildTool, string> = {
  select: '⬚ Select',
  move: '✥ Move',
  draw: '✎ Draw',
};

const TOOL_HINTS: Record<BuildTool, string> = {
  select: 'Click a vertex or face to select it for the numeric inspector, locking, or the pull-up shortcut.',
  move: 'Click and drag any vertex to move it. Dragging slides it horizontally; hold Shift while dragging to move it straight up and down. Locked vertices stay put.',
  draw: 'Click an existing point to start a face. A line then follows the cursor — click to place each next point, typing an exact length/angle first if you want. Click the first point again (3+ points) to close the face. Esc cancels.',
};

export function BuildPanel() {
  const design = useDesignStore((s) => s.design);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const selectedFaceId = useDesignStore((s) => s.selectedFaceId);
  const renameFace = useDesignStore((s) => s.renameFace);
  const deleteFace = useDesignStore((s) => s.deleteFace);
  const pullUpFace = useDesignStore((s) => s.pullUpFace);
  const setBaseFaceId = useDesignStore((s) => s.setBaseFaceId);
  const setVerticesLocked = useDesignStore((s) => s.setVerticesLocked);
  const buildTool = useDesignStore((s) => s.buildTool);
  const setBuildTool = useDesignStore((s) => s.setBuildTool);

  const [pullHeight, setPullHeight] = useState(3);
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
            {draftVertexIds.length === 0 && 'No face in progress — click an existing point to start one.'}
            {draftVertexIds.length > 0 && `Drawing face: ${draftVertexIds.length} point(s) placed.`}
          </div>
          <NextPointPanel />
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
