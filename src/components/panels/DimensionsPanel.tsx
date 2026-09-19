import { useDesignStore } from '../../store/designStore';
import { deriveEdges, dihedralAngleDeg } from '../../geometry/mesh';
import { V } from '../../geometry/vec3';

/** Always-visible, live read-out of every edge length and every dihedral angle in the solid. */
export function DimensionsPanel() {
  const design = useDesignStore((s) => s.design);
  const edges = deriveEdges(design);

  const posOf = (id: string) => design.vertices.find((v) => v.id === id)!.position;

  return (
    <div className="dimensions-panel">
      <div className="inspector-group-title">Edge lengths ({edges.length})</div>
      <table className="dim-table">
        <thead>
          <tr>
            <th>Edge</th>
            <th>Length</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e) => (
            <tr key={e.key}>
              <td>
                {e.a.slice(0, 5)}–{e.b.slice(0, 5)}
              </td>
              <td>{V.distance(posOf(e.a), posOf(e.b)).toFixed(3)}in</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inspector-group-title">Dihedral angles</div>
      <table className="dim-table">
        <thead>
          <tr>
            <th>Faces</th>
            <th>Angle</th>
          </tr>
        </thead>
        <tbody>
          {edges
            .filter((e) => e.faceIds.length === 2)
            .map((e) => {
              const a = design.faces.find((f) => f.id === e.faceIds[0])?.label ?? '?';
              const b = design.faces.find((f) => f.id === e.faceIds[1])?.label ?? '?';
              return (
                <tr key={e.key}>
                  <td>
                    {a} ↔ {b}
                  </td>
                  <td>{dihedralAngleDeg(design, e).toFixed(2)}°</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
