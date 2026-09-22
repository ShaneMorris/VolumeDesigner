import { useState } from 'react';
import { useDesignStore } from '../../store/designStore';
import { NumberField } from '../ui/NumberField';
import { edgeLength } from '../../geometry/mesh';
import { splittableCornerPairs, chordExists } from '../../geometry/split';

/**
 * Subdividing existing geometry (requirements §3).
 *
 * Both controls pick corners from a list rather than by drawing. That's the plain version:
 * once drawing commits edges as they're made, a chord will be something you draw straight
 * across a face and the split will follow from it. The operations underneath are the same
 * either way, so this is a way in, not a stopgap design.
 */

export function SplitEdgeControl() {
  const design = useDesignStore((s) => s.design);
  const selectedEdgePair = useDesignStore((s) => s.selectedEdgePair);
  const splitEdge = useDesignStore((s) => s.splitEdge);
  const [distanceIn, setDistanceIn] = useState<number | null>(null);

  if (!selectedEdgePair) return null;
  const { a, b } = selectedEdgePair;
  if (!design.vertices.some((v) => v.id === a) || !design.vertices.some((v) => v.id === b)) return null;

  const length = edgeLength(design, a, b);
  const distance = distanceIn ?? length / 2;
  const faceCount = design.faces.filter((f) =>
    f.vertexIds.some((id, i) => {
      const next = f.vertexIds[(i + 1) % f.vertexIds.length];
      return (id === a && next === b) || (id === b && next === a);
    }),
  ).length;

  const valid = distance > 0 && distance < length;

  return (
    <>
      <div className="inspector-group-title">Split this edge</div>
      <p className="panel-hint">
        Drops a point along the edge, measured from the first corner. It joins{' '}
        {faceCount === 0 ? 'no face' : faceCount === 1 ? 'the one face' : `both faces`} using this edge, so
        nothing comes loose — and since the point sits on the line, those faces stay flat.
      </p>
      <NumberField
        label="From this end"
        value={Number(distance.toFixed(4))}
        suffix="in"
        min={0}
        max={length}
        onCommit={setDistanceIn}
      />
      <div className="status-row">
        Edge is {length.toFixed(3)}in long{!valid && ' — the split has to land inside it'}
      </div>
      <div className="button-row">
        <button disabled={!valid} onClick={() => splitEdge(a, b, distance / length)}>
          Split edge
        </button>
        <button onClick={() => setDistanceIn(length / 2)}>Midpoint</button>
      </div>
    </>
  );
}

export function SplitFaceControl() {
  const design = useDesignStore((s) => s.design);
  const selectedFaceId = useDesignStore((s) => s.selectedFaceId);
  const splitFaceByCorners = useDesignStore((s) => s.splitFaceByCorners);
  const [pairIndex, setPairIndex] = useState(0);

  const face = design.faces.find((f) => f.id === selectedFaceId);
  if (!face) return null;

  const isBase = design.baseFaceId === face.id;
  const pairs = splittableCornerPairs(face);
  const cornerNumber = (id: string) => face.vertexIds.indexOf(id) + 1;
  const pair = pairs[Math.min(pairIndex, pairs.length - 1)];

  return (
    <>
      <div className="inspector-group-title">Split this face</div>
      <p className="panel-hint">
        Divides the face in two along a line between two of its corners. Either side can be a triangle or a
        polygon of any size. Both stay flat automatically, which is what frees a corner that planarity has
        pinned — though a neighbouring face usually needs the same treatment before it can actually move.
      </p>

      {isBase && <div className="warning-row">The base stays one panel, so it can't be split.</div>}

      {!isBase && pairs.length === 0 && (
        <div className="status-row">
          A triangle has no corners that aren't already neighbours — there's nothing to divide.
        </div>
      )}

      {!isBase && pairs.length > 0 && (
        <>
          <label className="number-field">
            <span className="number-field-label">From corner</span>
            <select value={pairIndex} onChange={(e) => setPairIndex(Number(e.target.value))}>
              {pairs.map((p, i) => (
                <option key={`${p.a}-${p.b}`} value={i} disabled={chordExists(design, p.a, p.b)}>
                  {cornerNumber(p.a)} → {cornerNumber(p.b)}
                  {chordExists(design, p.a, p.b) ? ' (already joined)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              disabled={!pair || chordExists(design, pair.a, pair.b)}
              onClick={() => pair && splitFaceByCorners(face.id, pair.a, pair.b)}
            >
              Split face
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Why the last split was refused. Shown where the action was, so it reads as a reply. */
export function ActionError() {
  const actionError = useDesignStore((s) => s.actionError);
  const clearActionError = useDesignStore((s) => s.clearActionError);
  if (!actionError) return null;
  return (
    <div className="warning-row" onClick={clearActionError} role="status">
      {actionError}
    </div>
  );
}
