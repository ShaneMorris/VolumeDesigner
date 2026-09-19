import { useDesignStore } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';

export function SketchPanel() {
  const openSketch = useDesignStore((s) => s.openSketch);
  const undoSketchPoint = useDesignStore((s) => s.undoSketchPoint);
  const clearSketch = useDesignStore((s) => s.clearSketch);
  const closeSketch = useDesignStore((s) => s.closeSketch);
  const design = useDesignStore((s) => s.design);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);

  return (
    <div>
      <p className="panel-hint">
        Click on the ground grid to place the base polygon's vertices (3+). Click "Close Shape" once you've placed
        them all, then fine-tune each edge length / vertex angle numerically below.
      </p>
      <div className="status-row">
        <span>
          {openSketch.length === 0 && 'No points yet — click the grid.'}
          {openSketch.length > 0 && openSketch.length < 3 && `${openSketch.length} point(s) — need at least 3.`}
          {openSketch.length >= 3 && `${openSketch.length} points — open wire (not yet closed).`}
        </span>
      </div>
      <div className="button-row">
        <button disabled={openSketch.length === 0} onClick={undoSketchPoint}>
          Undo point
        </button>
        <button disabled={openSketch.length === 0} onClick={clearSketch}>
          Clear
        </button>
        <button disabled={openSketch.length < 3} className="primary" onClick={() => closeSketch('Base')}>
          Close Shape
        </button>
      </div>

      {design.baseFaceId && (
        <>
          <hr />
          <p className="panel-hint">
            Base is closed. Select a vertex in the viewport to edit its edges/angle numerically.
          </p>
          {selectedVertexId && <VertexInspector />}
        </>
      )}
    </div>
  );
}
