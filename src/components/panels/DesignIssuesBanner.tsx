import { useDesignStore } from '../../store/designStore';

/**
 * What validation found in a design as it was opened (requirements §3).
 *
 * Repairs already happened — they were the price of the file opening at all — so they're
 * reported as fact. Warnings haven't been acted on: a warped or slivered face is the
 * user's geometry, and the app offers to fix it rather than doing so behind their back.
 */
export function DesignIssuesBanner() {
  const issues = useDesignStore((s) => s.designIssues);
  const repairs = useDesignStore((s) => s.designRepairs);
  const dismiss = useDesignStore((s) => s.dismissDesignIssues);
  const makeFacesPlanar = useDesignStore((s) => s.makeFacesPlanar);
  const settleBaseOntoPlane = useDesignStore((s) => s.settleBaseOntoPlane);

  if (issues.length === 0 && repairs.length === 0) return null;

  const warped = issues.filter((i) => i.constraint === 9);
  const offBase = issues.filter((i) => i.constraint === 11);

  return (
    <div className="issues-banner">
      <div className="issues-banner-title">This design needed a closer look</div>

      {repairs.length > 0 && (
        <>
          <p className="panel-hint">Repaired so the design would open:</p>
          <ul className="issues-list">
            {repairs.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}

      {issues.length > 0 && (
        <>
          <p className="panel-hint">
            Left as found — these are your geometry, so nothing has been moved:
          </p>
          <ul className="issues-list">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </>
      )}

      <div className="button-row">
        {warped.length > 0 && (
          <button onClick={makeFacesPlanar}>
            Make {warped.length} warped {warped.length === 1 ? 'face' : 'faces'} flat
          </button>
        )}
        {offBase.length > 0 && (
          <button onClick={settleBaseOntoPlane}>
            Put the base back on the base plane
          </button>
        )}
        <button onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}
