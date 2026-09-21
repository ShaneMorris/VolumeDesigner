import { useDesignStore } from '../../store/designStore';
import { resolveNextPoint, toPolar } from '../../geometry/drawPlane';
import { NumberField } from '../ui/NumberField';

/**
 * The dialog that appears while a segment is "live" — connected between the last placed
 * point and the cursor. It reads out that segment's length and angle as the mouse moves,
 * and typing into either field locks it, so the mouse then only controls whatever is
 * still free. With both locked the point is fully determined and the mouse is ignored,
 * which is how a precise edge gets placed without any dragging at all.
 */
export function NextPointPanel() {
  const design = useDesignStore((s) => s.design);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const drawPlane = useDesignStore((s) => s.drawPlane);
  const drawCursor = useDesignStore((s) => s.drawCursor);
  const lockedLengthIn = useDesignStore((s) => s.lockedLengthIn);
  const lockedAngleDeg = useDesignStore((s) => s.lockedAngleDeg);
  const setLockedLength = useDesignStore((s) => s.setLockedLength);
  const setLockedAngle = useDesignStore((s) => s.setLockedAngle);
  const commitPendingPoint = useDesignStore((s) => s.commitPendingPoint);
  const closeDraftFace = useDesignStore((s) => s.closeDraftFace);
  const cancelDraft = useDesignStore((s) => s.cancelDraft);

  if (!drawPlane || draftVertexIds.length === 0) return null;

  const lastId = draftVertexIds[draftVertexIds.length - 1];
  const from = design.vertices.find((v) => v.id === lastId)?.position;
  if (!from) return null;

  const pending =
    drawCursor || (lockedLengthIn !== null && lockedAngleDeg !== null)
      ? resolveNextPoint(drawPlane, from, drawCursor ?? from, {
          lengthIn: lockedLengthIn,
          angleDeg: lockedAngleDeg,
        })
      : null;

  const live = pending ? toPolar(drawPlane, from, pending) : null;
  const canCommit = pending !== null;
  const canClose = draftVertexIds.length >= 3;

  return (
    <div className="inspector-group next-point">
      <div className="inspector-group-title">Next point</div>
      <p className="panel-hint">
        Move the cursor to aim the segment, or type a length/angle to pin it down. Click in the viewport (or
        "Place point") to set it. Click the first point to close the face; Esc cancels.
      </p>

      <NumberField
        label={`Length${lockedLengthIn !== null ? ' (locked)' : ''}`}
        value={lockedLengthIn ?? live?.lengthIn ?? 0}
        suffix="in"
        onCommit={(v) => setLockedLength(v)}
      />
      <NumberField
        label={`Angle${lockedAngleDeg !== null ? ' (locked)' : ''}`}
        value={lockedAngleDeg ?? live?.angleDeg ?? 0}
        suffix="°"
        onCommit={(v) => setLockedAngle(v)}
      />
      <p className="panel-hint">Angle is measured from horizontal in the drawing plane: 0° level, 90° straight up.</p>

      <div className="button-row">
        {lockedLengthIn !== null && <button onClick={() => setLockedLength(null)}>Unlock length</button>}
        {lockedAngleDeg !== null && <button onClick={() => setLockedAngle(null)}>Unlock angle</button>}
      </div>

      {pending && (
        <div className="status-row">
          Lands at X {pending.x.toFixed(3)}, Y {pending.y.toFixed(3)}, Z {pending.z.toFixed(3)} in
        </div>
      )}

      <div className="button-row">
        <button className="primary" disabled={!canCommit} onClick={commitPendingPoint}>
          Place point
        </button>
        <button disabled={!canClose} onClick={() => closeDraftFace()}>
          Close face
        </button>
        <button onClick={cancelDraft}>Cancel</button>
      </div>
    </div>
  );
}
