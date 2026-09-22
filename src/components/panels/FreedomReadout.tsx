import { useEffect } from 'react';
import { useDesignStore } from '../../store/designStore';
import { describeFreedom } from '../../geometry/constrain';

/**
 * What the current selection can actually do, and what's stopping it.
 *
 * Constrained dragging means a point sometimes barely moves, and sometimes refuses
 * outright — correct under constraint 9, but indistinguishable from a broken tool unless
 * the app says which faces are holding it. That's this.
 */
export function FreedomReadout() {
  const design = useDesignStore((s) => s.design);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const selectedEdgePair = useDesignStore((s) => s.selectedEdgePair);
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);
  const draggingEdge = useDesignStore((s) => s.draggingEdge);
  const moveFreedom = useDesignStore((s) => s.moveFreedom);
  const moveWasLimited = useDesignStore((s) => s.moveWasLimited);
  const refreshMoveFreedom = useDesignStore((s) => s.refreshMoveFreedom);

  // Whatever is under the pointer wins; otherwise report on the selection.
  const target = draggingEdge
    ? [draggingEdge.a, draggingEdge.b]
    : draggingVertexId
      ? [draggingVertexId]
      : selectedEdgePair
        ? [selectedEdgePair.a, selectedEdgePair.b]
        : selectedVertexId
          ? [selectedVertexId]
          : null;

  const key = target?.join('|') ?? '';
  useEffect(() => {
    // Recomputed on the model too, since a split or a delete changes what's free.
    refreshMoveFreedom(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, design, refreshMoveFreedom]);

  if (!target || !moveFreedom) {
    return (
      <p className="panel-hint">
        Select or grab a point or an edge to see how far it can move. Faces have to stay flat, so what's
        free depends on what it's attached to.
      </p>
    );
  }

  const what = target.length === 2 ? 'This edge' : 'This point';
  const pinned = moveFreedom.dof === 0;

  return (
    <>
      <div className={pinned ? 'warning-row' : 'status-row'}>
        {what}: {describeFreedom(moveFreedom).replace(/^(Free|Slides|Pinned)/, (m) => m.toLowerCase())}
      </div>
      {moveWasLimited && (
        <p className="panel-hint">
          That move stopped short of where the pointer went — going further would have collapsed a face to a
          sliver or folded its outline over itself. That's a different limit from the flatness one above:
          flatness decides which way it can go, this decides how far.
        </p>
      )}
      {pinned && target.length === 1 && (
        <p className="panel-hint">
          Moving the whole edge instead is often possible where the corner isn't — both ends travelling
          together costs a face one degree of freedom rather than two.
        </p>
      )}
    </>
  );
}
