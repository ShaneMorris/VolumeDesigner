import { useMemo, useState } from 'react';
import { useDesignStore } from '../../store/designStore';
import { unfoldAllFaces, layoutPanelsOnSheet } from '../../geometry/unfold';
import { applyMiterCorrection } from '../../geometry/miter';
import { exportAllPanelsAsFiles, exportCombinedFile } from '../../export/dxf';
import { UnfoldView } from '../unfold/UnfoldView';
import { NumberField } from '../ui/NumberField';

export function UnfoldPanel() {
  const design = useDesignStore((s) => s.design);
  const setPanelThickness = useDesignStore((s) => s.setPanelThickness);
  const [applyMiter, setApplyMiter] = useState(true);

  const panels = useMemo(() => {
    const raw = unfoldAllFaces(design);
    const mitered = applyMiter ? raw.map((p) => applyMiterCorrection(p, design.panelThicknessIn)) : raw;
    return layoutPanelsOnSheet(mitered);
  }, [design, applyMiter]);

  const nonPlanarCount = panels.filter((p) => !p.isPlanar).length;

  return (
    <div>
      <p className="panel-hint">
        Each face unfolds to its true flat shape. Bevel angles shown per edge come from that edge's dihedral angle
        in the 3D model.
      </p>

      <NumberField
        label="Panel thickness"
        value={design.panelThicknessIn}
        suffix="in"
        step={0.0625}
        onCommit={setPanelThickness}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={applyMiter} onChange={(e) => setApplyMiter(e.target.checked)} />
        Apply corner miter correction (uses panel thickness — verify against a test part)
      </label>

      {nonPlanarCount > 0 && (
        <div className="warning-row">
          {nonPlanarCount} face(s) are non-planar and approximated as two flat triangles split along a diagonal.
        </div>
      )}

      <div className="button-row">
        <button className="primary" onClick={() => exportAllPanelsAsFiles(panels)}>
          Export DXF (one file per panel)
        </button>
        <button onClick={() => exportCombinedFile(panels)}>Export combined DXF</button>
      </div>

      <UnfoldView panels={panels} />
    </div>
  );
}
