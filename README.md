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

1. **Sketch Base** — set the **work area** first: a square base plane, 24in by default
   and capped at 96in a side, which everything is built on. "Save as default" keeps
   that size for future designs. Then start from a preset regular polygon (triangle,
   square, pentagon, hexagon, octagon) at a given width, or click the grid to place
   vertices by hand (3+) and hit "Close Shape". Either way, select a vertex afterward
   to edit its adjacent edge lengths and interior angle numerically.

   Sketch clicks are clamped inside the work area: a click near the horizon meets the
   ground plane an enormous distance away, and a point stranded out there is both
   invisible and disruptive (it used to inflate every on-screen handle).
2. **Build Faces** — three CAD-style tools:
   - **Select** — pick a vertex or face for the numeric inspector, locking, or pull-up.
   - **Move** — click and drag a vertex to reshape every face touching it, live.
     Dragging slides it horizontally; hold Shift to move it straight up/down. Locked
     vertices don't budge.

     "Keep faces flat" (on by default) stops a drag from warping faces. Four corners
     don't generally share a plane, so moving one warps every face it belongs to — a
     crease along the renderer's triangulation diagonal, and a panel the unfolder has to
     approximate. The model is relaxed instead: each warped face's free corners are
     projected onto its best-fit plane, repeatedly, until everything settles. Correcting
     only the dragged corner's own faces isn't enough — whichever corner absorbs the fix
     belongs to further faces that then warp in turn, the base among them. The dragged
     corner, locked corners, and the base face are all held fixed throughout.
   - **Draw** — click an existing point to start a face; a line then follows the cursor.
     Click to place each next point, click the first point again (3+ points) to close
     the face, Esc to cancel. While a segment is live, a sidebar dialog reads out its
     length and angle-from-horizontal, and typing into either field locks it — so the
     mouse only steers whatever is still free, and with both typed the point is exact
     without any dragging.

     Points land on a drawing plane, since a 2D cursor position has no single 3D
     answer. That plane is vertical and camera-facing through the start point, frozen
     so orbiting can't shift it mid-face; once three points are down they define the
     face's plane outright and drawing switches onto it, which is also what keeps the
     finished face planar and cleanly unfoldable.

   The "pull-up" shortcut extrudes the selected base face straight up by a numeric
   height — available, never automatic.
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
  solver, planarity check and the flatness relaxation, face unfolding (planar
  projection, or a non-planar fan-triangulated true-length approximation), and corner
  miter correction.
- `src/store/designStore.ts` — a Zustand store wrapping the design with selection
  state, undo/redo, and the mode-specific in-progress drafts (open sketch, face-build
  chain).
- `src/components/viewport/` — the Three.js/`@react-three/fiber` 3D scene.
- `src/components/panels/` — the per-mode side panels and the always-on dimensions
  table.
- `src/export/dxfWriter.ts` / `dxf.ts` — a small hand-written AutoCAD R12 (AC1009)
  ASCII DXF writer. Deliberately not library-generated: `dxf-writer` emits AC1021 with
  LWPOLYLINE entities and stringifies coordinates with plain JS formatting, which
  produces values like `5.551115123125783e-17` for floating-point near-zeros. DXF
  readers expect plain decimal reals and reject exponent notation, so those files
  failed to import. This writer formats every real as fixed decimal, snaps near-zeros,
  and refuses non-finite or implausible coordinates outright.
- `src/persistence/` — localStorage autosave, JSON file save/load, and the saved
  work-area default that new designs start from.

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
  offsets each beveled edge outward by `(thickness/2) * tan((180 - bevel)/2)` (capped at
  a few panel thicknesses, since that tangent runs away toward infinity as the fold
  angle approaches zero) and re-intersects adjacent offset edges for the corner point. This assumes a specific
  outer-face reference convention; verify against a physical test part before trusting
  it at tight tolerances (it's a toggle in the Unfold panel, on by default).
- **Hole coordinate reference** — X/Y are relative to the face's first vertex, with X
  along the face's first edge (rather than the face center), since that frame is also
  what the unfold step already uses internally — holes carry over exactly.
