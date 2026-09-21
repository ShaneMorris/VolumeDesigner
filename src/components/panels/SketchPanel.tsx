import { useState } from 'react';
import { useDesignStore } from '../../store/designStore';
import { VertexInspector } from './VertexInspector';
import { NumberField } from '../ui/NumberField';
import { POLYGON_PRESETS } from '../../geometry/polygons';
import { BASE_PLANE_MAX_IN, BASE_PLANE_MIN_IN } from '../../geometry/types';
import { saveDefaultBasePlaneSize } from '../../persistence/storage';

export function SketchPanel() {
  const openSketch = useDesignStore((s) => s.openSketch);
  const undoSketchPoint = useDesignStore((s) => s.undoSketchPoint);
  const clearSketch = useDesignStore((s) => s.clearSketch);
  const closeSketch = useDesignStore((s) => s.closeSketch);
  const createBasePolygon = useDesignStore((s) => s.createBasePolygon);
  const setBasePlaneSize = useDesignStore((s) => s.setBasePlaneSize);
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
        <div className="inspector-group-title">Work area</div>
        <NumberField
          label="Base plane"
          value={design.basePlaneSizeIn}
          suffix="in"
          min={BASE_PLANE_MIN_IN}
          max={BASE_PLANE_MAX_IN}
          onCommit={setBasePlaneSize}
        />
        <div className="button-row">
          <button onClick={() => saveDefaultBasePlaneSize(design.basePlaneSizeIn)}>
            Save as default
          </button>
        </div>
        <p className="panel-hint">
          The square grid your volume is built on, {BASE_PLANE_MIN_IN}–{BASE_PLANE_MAX_IN}in a side. Sketch
          points stay inside it, so a click near the horizon can't strand a point off in the distance. "Save
          as default" makes this the starting size for new designs.
        </p>
      </div>

      <div className="inspector-group">
        <div className="inspector-group-title">Start from a preset shape</div>
        <NumberField
          label="Width across"
          value={presetWidth}
          suffix="in"
          min={1}
          max={design.basePlaneSizeIn}
          onCommit={setPresetWidth}
        />
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
