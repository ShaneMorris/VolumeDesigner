# Climbing Volume Modeler

A purpose-built, browser-based tool for designing climbing volumes as precise 3D
polygon solids, then unfolding each face into a CNC-ready flat DXF panel with bevel
angles and mounting holes. See `docs/requirements.md` for the full spec this
implements.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (tsc + vite build)
npx vitest run    # geometry engine test suite
```

Everything runs client-side — there's no backend. A design autosaves to the browser's
`localStorage` as you work, and "Save JSON" / "Open JSON" export/import a design file
explicitly.

## Workflow

The toolbar's five modes match the spec's workflow:

1. **Sketch Base** — click the ground grid to place the base polygon's vertices (3+),
   then "Close Shape". Once closed, select any vertex to edit its adjacent edge
   lengths and interior angle numerically.
2. **Build Faces** — click an existing vertex to start a new face, keep clicking
   vertices to add edges, click the first vertex again to close the face. Drag a
   selected vertex (translate gizmo) to reshape every face that touches it, live. The
   "pull-up" shortcut extrudes the selected base face straight up by a numeric height —
   available, never automatic.
3. **Angles** — click one face then an adjacent face to select their shared edge and
   see its live dihedral (bevel) angle. Type an exact value (or use a preset) to lock
   it; the solver rotates the second face's vertices about that shared edge until the
   angle matches, never stretching an edge to do it.
4. **Holes** — click anywhere on a face to drop a 0.5in T-nut hole, then fine-tune its
   X/Y numerically (measured from the face's first vertex, along its first edge).
5. **Unfold / Export** — every face flattens to its true (non-projected) 2D shape,
   labeled and annotated with each edge's bevel angle. Export one DXF per panel, or a
   single combined layout DXF, in inches.

An always-visible sidebar table lists every edge length and every dihedral angle in
the current solid.

## Architecture

- `src/geometry/` — the core engine, framework-free and unit-tested (`vitest`):
  vertex/face/hole data model, dihedral angle measurement, the angle-lock rotation
  solver, planarity check, face unfolding (planar projection, or a non-planar
  fan-triangulated true-length approximation), and corner miter correction.
- `src/store/designStore.ts` — a Zustand store wrapping the design with selection
  state, undo/redo, and the mode-specific in-progress drafts (open sketch, face-build
  chain).
- `src/components/viewport/` — the Three.js/`@react-three/fiber` 3D scene.
- `src/components/panels/` — the per-mode side panels and the always-on dimensions
  table.
- `src/export/dxf.ts` — DXF (R12-family ASCII, inches) via `dxf-writer`.
- `src/persistence/` — localStorage autosave and JSON file save/load.

## Scope notes / judgment calls

A few things the spec left open, resolved pragmatically for v1:

- **Bevel-bit presets** — the spec flags the exact list as "TBD with Shane"; the
  presets shown (90/108/120/135/144°) are placeholders for common regular-polygon
  prism fold angles, not confirmed commercial bit angles.
- **Angle-lock solver scope** — locks one shared edge at a time (rotate the second
  face's free vertices about that edge until the angle matches; never stretches an
  edge). Multiple simultaneous locks are reconciled by re-applying every lock a few
  times after any edit (a simple relaxation), not a full constraint solver — the spec
  calls out the single-edge solver as the piece to validate early, which is what's
  covered by the geometry test suite.
- **Corner miter correction** — implemented per the spec's "recommendation" framing:
  offsets each beveled edge outward by `(thickness/2) * tan((180 - bevel)/2)` and
  re-intersects adjacent offset edges for the corner point. This assumes a specific
  outer-face reference convention; verify against a physical test part before trusting
  it at tight tolerances (it's a toggle in the Unfold panel, on by default).
- **Hole coordinate reference** — X/Y are relative to the face's first vertex, with X
  along the face's first edge (rather than the face center), since that frame is also
  what the unfold step already uses internally — holes carry over exactly.
