import { useState } from 'react';
import { useDesignStore, type BuildTool } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NextPointPanel } from './NextPointPanel';
import { NumberField } from '../ui/NumberField';
import { SplitEdgeControl, SplitFaceControl, ActionError } from './SplitControls';
import { FreedomReadout } from './FreedomReadout';

const TOOL_LABELS: Record<BuildTool, string> = {
  select: '⬚ Select',
  move: '✥ Move',
  draw: '✎ Draw',
};

const TOOL_HINTS: Record<BuildTool, string> = {
  select: 'Click a vertex, edge or face to select it — for the numeric inspector, locking, the pull-up shortcut, or deleting. Del removes the selection.',
  move: 'Drag a vertex to move it, or grab an edge to move the whole edge. Dragging slides horizontally; hold Shift to move straight up and down. Motion is limited to whatever keeps every face flat, so some points barely move and some cannot move at all — the panel says what is holding them.',
  draw: 'Click anywhere to start drawing — an existing point, a point along an edge, or empty space. A line then follows the cursor; click to place each next point, or type an exact length, angle and height first. Every segment is drawn for real as you go, so Esc just stops and what you drew stays. A face appears on its own when the edges close a loop.',
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
  const selectedEdgePair = useDesignStore((s) => s.selectedEdgePair);
  const deleteVertex = useDesignStore((s) => s.deleteVertex);
  const deleteEdge = useDesignStore((s) => s.deleteEdge);

  const [pullHeight, setPullHeight] = useState(3);
  const selectedFace = design.faces.find((f) => f.id === selectedFaceId);
  const baseFace = design.faces.find((f) => f.id === design.baseFaceId);
  const baseVertices = baseFace ? design.vertices.filter((v) => baseFace.vertexIds.includes(v.id)) : [];
  const baseFullyLocked = baseVertices.length > 0 && baseVertices.every((v) => v.locked);

  // How much a delete would take with it, so the count is visible before committing.
  const facesOnSelectedVertex = selectedVertexId
    ? design.faces.filter((f) => f.vertexIds.includes(selectedVertexId))
    : [];
  const facesOnSelectedEdge = selectedEdgePair
    ? design.faces.filter((f) => {
        const n = f.vertexIds.length;
        return f.vertexIds.some((id, i) => {
          const next = f.vertexIds[(i + 1) % n];
          return (
            (id === selectedEdgePair.a && next === selectedEdgePair.b) ||
            (id === selectedEdgePair.b && next === selectedEdgePair.a)
          );
        });
      })
    : [];

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
      <ActionError />

      {buildTool === 'move' && <FreedomReadout />}

      {buildTool === 'draw' && (
        <>
          <div className="status-row">
            {draftVertexIds.length === 0 && 'Click anywhere to start a chain of edges.'}
            {draftVertexIds.length > 0 &&
              `Drawing: ${draftVertexIds.length} point(s), ${Math.max(0, draftVertexIds.length - 1)} edge(s) committed.`}
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
            A locked vertex can still be drawn from and drawn to, but the Move tool won't budge it.
          </p>
          <div className="button-row">
            <button onClick={() => setVerticesLocked(baseVertices.map((v) => v.id), !baseFullyLocked)}>
              {baseFullyLocked ? 'Unlock base vertices' : 'Lock base vertices'}
            </button>
          </div>
        </>
      )}

      {selectedEdgePair && (
        <>
          <hr />
          <SplitEdgeControl />
          <div className="inspector-group-title">Delete this edge</div>
          <p className="panel-hint">
            Deleting an edge removes the {facesOnSelectedEdge.length === 1 ? 'face' : 'faces'} meeting along it
            but keeps both corners, so you can redraw on the same points.
          </p>
          <div className="status-row">
            Removes {facesOnSelectedEdge.length}{' '}
            {facesOnSelectedEdge.length === 1 ? 'face' : 'faces'}
            {facesOnSelectedEdge.length > 0 && `: ${facesOnSelectedEdge.map((f) => f.label).join(', ')}`}
          </div>
          <div className="button-row">
            <button
              className="danger"
              disabled={facesOnSelectedEdge.length === 0}
              onClick={() => deleteEdge(selectedEdgePair.a, selectedEdgePair.b)}
            >
              Delete edge
            </button>
          </div>
        </>
      )}

      {selectedFace && (
        <>
          <hr />
          <div className="inspector-group-title">Selected face: {selectedFace.label}</div>
          <SplitFaceControl />
          <div className="inspector-group-title">Face details</div>
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
          <p className="panel-hint">
            A face can't lose a corner, so deleting this point also removes every face using it. The other
            corners of those faces stay behind, ready to redraw on.
          </p>
          <div className="status-row">
            Removes {facesOnSelectedVertex.length}{' '}
            {facesOnSelectedVertex.length === 1 ? 'face' : 'faces'}
            {facesOnSelectedVertex.length > 0 && `: ${facesOnSelectedVertex.map((f) => f.label).join(', ')}`}
          </div>
          <div className="button-row">
            <button className="danger" onClick={() => deleteVertex(selectedVertexId)}>
              Delete point
            </button>
          </div>
        </>
      )}
    </div>
  );
}
