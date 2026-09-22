import { useDesignStore, resolvePendingPoint } from '../../store/designStore';
import { toPolar } from '../../geometry/drawPlane';
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
  const drawSnap = useDesignStore((s) => s.drawSnap);
  const lockedLengthIn = useDesignStore((s) => s.lockedLengthIn);
  const lockedAngleDeg = useDesignStore((s) => s.lockedAngleDeg);
  const setLockedLength = useDesignStore((s) => s.setLockedLength);
  const setLockedAngle = useDesignStore((s) => s.setLockedAngle);
  const lockedHeightIn = useDesignStore((s) => s.lockedHeightIn);
  const setLockedHeight = useDesignStore((s) => s.setLockedHeight);
  const commitPendingPoint = useDesignStore((s) => s.commitPendingPoint);
  const endChain = useDesignStore((s) => s.endChain);

  if (!drawPlane || draftVertexIds.length === 0) return null;

  const lastId = draftVertexIds[draftVertexIds.length - 1];
  const from = design.vertices.find((v) => v.id === lastId)?.position;
  if (!from) return null;

  // The same resolver the viewport and the click both use, so every reading agrees.
  const pending = resolvePendingPoint({
    design,
    draftVertexIds,
    drawPlane,
    drawCursor,
    drawSnap,
    lockedLengthIn,
    lockedAngleDeg,
    lockedHeightIn,
  });

  // Only for telling the user a typed height can't be reached along a level segment.
  let effectiveLength = lockedLengthIn;
  if (effectiveLength === null && lockedHeightIn !== null && lockedAngleDeg !== null) {
    const sin = Math.sin((lockedAngleDeg * Math.PI) / 180);
    if (Math.abs(sin) > 1e-6) effectiveLength = Math.abs((lockedHeightIn - from.z) / sin);
  }

  const live = pending ? toPolar(drawPlane, from, pending) : null;
  const canCommit = pending !== null;
  const heightUnreachable =
    lockedHeightIn !== null && lockedAngleDeg !== null && effectiveLength === null;

  return (
    <div className="inspector-group next-point">
      <div className="inspector-group-title">Next point</div>
      <p className="panel-hint">
        Move the cursor to aim the segment, or type values to pin it down. Click in the viewport (or "Place
        point") to set it.
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
      <NumberField
        label={`Rise to height${lockedHeightIn !== null ? ' (locked)' : ''}`}
        value={lockedHeightIn ?? Number((pending?.z ?? from.z).toFixed(4))}
        suffix="in"
        onCommit={(v) => setLockedHeight(v)}
      />
      <p className="panel-hint">
        Angle is measured from horizontal in the drawing plane: 0° level, 90° straight up. Set an angle and a
        height and the length follows — so "45° rising to 4in" needs no trigonometry. A typed length wins if
        you set both.
      </p>

      {heightUnreachable && (
        <div className="warning-row">
          A level segment can't change height. Give it an angle other than 0° or 180°, or set a length instead.
        </div>
      )}

      <div className="button-row">
        {lockedLengthIn !== null && <button onClick={() => setLockedLength(null)}>Unlock length</button>}
        {lockedAngleDeg !== null && <button onClick={() => setLockedAngle(null)}>Unlock angle</button>}
        {lockedHeightIn !== null && <button onClick={() => setLockedHeight(null)}>Unlock height</button>}
      </div>

      {pending && (
        <div className="status-row">
          Lands at X {pending.x.toFixed(3)}, Y {pending.y.toFixed(3)}, Z {pending.z.toFixed(3)} in
          {drawSnap && !lockedLengthIn && lockedAngleDeg === null && ' — on existing geometry'}
        </div>
      )}

      <div className="button-row">
        <button className="primary" disabled={!canCommit} onClick={commitPendingPoint}>
          Place point
        </button>
        <button onClick={endChain}>Done (Esc)</button>
      </div>
    </div>
  );
}
