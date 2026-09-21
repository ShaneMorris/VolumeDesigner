import { useState } from 'react';
import { useDesignStore } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NumberField } from '../ui/NumberField';
import { POLYGON_PRESETS } from '../../geometry/polygons';

export function SketchPanel() {
  const openSketch = useDesignStore((s) => s.openSketch);
  const undoSketchPoint = useDesignStore((s) => s.undoSketchPoint);
  const clearSketch = useDesignStore((s) => s.clearSketch);
  const closeSketch = useDesignStore((s) => s.closeSketch);
  const createBasePolygon = useDesignStore((s) => s.createBasePolygon);
  const design = useDesignStore((s) => s.design);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);

  const [presetWidth, setPresetWidth] = useState(12);

  const startPreset = (sides: number) => {
    const hasGeometry = design.faces.length > 0 || design.vertices.length > 0;
    if (hasGeometry && !confirm('Replace the current design with a new base polygon?')) return;
    createBasePolygon(sides, presetWidth);
  };

  return (
    <div>
      <div className="inspector-group">
        <div className="inspector-group-title">Start from a preset shape</div>
        <NumberField label="Width across" value={presetWidth} suffix="in" onCommit={setPresetWidth} />
        <div className="preset-row">
          {POLYGON_PRESETS.map((preset) => (
            <button key={preset.id} onClick={() => startPreset(preset.sides)}>
              {preset.label}
            </button>
          ))}
        </div>
        <p className="panel-hint">
          Creates a regular polygon centered on the base plane, flat side down. "Width across" is the overall
          left-to-right size — for a triangle or square that's the same as the side length.
        </p>
      </div>

      <hr />

      <p className="panel-hint">
        Or draw it by hand: click the ground grid to place the base polygon's vertices (3+), then "Close Shape"
        and fine-tune each edge length / vertex angle numerically below.
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
