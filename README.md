# Climbing Volume Modeler

A purpose-built, browser-based tool for designing climbing volumes as precise 3D
polygon solids, then unfolding each face into a CNC-ready flat DXF panel with bevel
angles and mounting holes. See `docs/requirements.md` for the full spec this
implements.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build — and the real typecheck (tsc -b, then vite build)
npx vitest run    # geometry engine test suite
```

Note that `tsc --noEmit` checks **nothing** in this project: the root `tsconfig.json` is a
solution file (`"files": []` plus `references`), so type errors only surface through
`tsc -b`, which is what `npm run build` runs.

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
   - **Select** — pick a vertex, edge or face for the numeric inspector, locking, the
     pull-up shortcut, splitting, or deleting (Del also works). Deleting a **vertex** takes
     every face using it, since a face can't simply lose a corner; deleting an **edge** takes
     only the faces meeting along it and leaves both corners in place, so the geometry
     can be redrawn on the same points.

     **Splitting** subdivides what's already there. Splitting an *edge* drops a point along
     it at a typed distance, and every face using that edge gains the point — otherwise the
     face boundary would stop matching the edge set. The point lands on the line, so those
     faces stay flat and simply gain a 180° corner. Splitting a *face* divides it along a
     chord between two corners into two faces of any size: two quads is as ordinary as two
     triangles. Both children are planar automatically, which is what frees a corner that
     planarity has pinned — though a neighbouring face usually needs the same treatment
     before it can actually move. The base can't be split, and a chord that would pass
     outside a concave face, or cross one of its edges, is refused with the reason.
   - **Move** — drag a vertex, or grab an edge to move the whole edge. Dragging slides
     horizontally; hold Shift to move straight up/down. Locked vertices don't budge.

     Faces stay flat because the **drag is constrained**, not because anything is corrected
     afterward. Every move is a translation of some set of vertices; each face it would warp
     contributes one linear equation, and the move is projected onto whatever motion
     satisfies all of them. So nothing you didn't grab ever moves — which was the problem
     with the relaxation this replaced.

     That means a point sometimes won't go where the pointer does, and sometimes won't move
     at all. On a closed box every corner is pinned: three quads meet there and their planes
     intersect at a point. The panel always says what's holding it ("pinned by Base, Side 1,
     Side 4"), because a silent refusal is indistinguishable from a broken tool. Splitting
     one of those faces is the remedy.

     **Dragging an edge is its own operation**, not a shortcut for moving two vertices. Since
     both ends travel together the edge keeps its length and direction, so a face holding
     both of them gives up one degree of freedom instead of two. A box's edges therefore
     still slide even though its corners are stuck — it shears where it can't be dented.

     Two separate limits are at work and the panel distinguishes them: planarity decides
     *which way* a move can go, while the area and self-intersection rules decide *how far*,
     stopping a drag before a face becomes a sliver or folds over itself.
   - **Draw** — start anywhere: an existing point, a point along an edge, or empty space.
     A line then follows the cursor; click to place each next point.

     **Every segment is committed as it's drawn**, so Esc doesn't cancel — it just stops,
     and what you drew stays. That's what lets a defining edge be got exactly right and
     left standing while the rest of its face is worked out, which is how the design work
     actually goes. There is no "close the face" gesture either: a face appears on its own
     when edges enclose something.

     The sidebar dialog takes a **length, an angle from horizontal, and a target height**,
     and typing into a field locks it. Height stands in for length, so "45° rising to 4in"
     is two typed numbers rather than a length you first have to work out (it's 5.657in). A
     typed length wins if you set both.

     Clicking near an edge splits that edge at the click, so the point lands *exactly* on
     the line rather than a hundredth of an inch off it — the difference between geometry
     that closes and geometry that looks like it should have.

     Points land on a drawing plane, since a 2D cursor position has no single 3D answer.
     That plane is vertical and camera-facing through the start point, frozen so orbiting
     can't shift it mid-chain; once three points are down they define a plane outright and
     drawing switches onto it, which is what keeps a finished face planar and unfoldable.

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
  vertex/edge/face/hole data model, dihedral angle measurement, the angle-lock rotation
  solver, planarity check and the flatness relaxation, face unfolding (planar
  projection, or a non-planar fan-triangulated true-length approximation), and corner
  miter correction.

  The model is **edge-primary** (see `docs/requirements.md` §3): edges are stored and carry
  connectivity, and faces are an ordered overlay on them that also holds the label, base
  designation, holes and angle locks. An edge may belong to no face at all, which is what
  lets a defining edge be drawn exactly and left standing before the face around it exists,
  and what lets deleting geometry leave a wireframe behind to redraw on. An edge is
  identified by its endpoint pair rather than an id of its own, so "the same edge twice" is
  unrepresentable. `edges.ts` keeps the edge set and the face loops in step — anything that
  creates a face runs `withFaceEdges`, so no caller has to remember to.
- `src/geometry/loops.ts` — what a newly drawn edge brings into being. An edge between two
  corners of an existing face **divides** it, and goes to `splitFace` so the parent's label,
  holes and angle locks are handed on deliberately. Otherwise the edge may have **closed** a
  loop, found by breadth-first search for the smallest one through it that is coplanar,
  encloses real area, has no chord across it, and wouldn't put a third face on any edge.
  Two equally small loops means the edge closed more than one thing at once, so nothing is
  created and the user says what they meant — the edges stay either way.
- `src/geometry/constrain.ts` — the null-space solver behind Move. Builds the linear
  constraints a translation must satisfy, reduces them by Gram-Schmidt (so redundant and
  conflicting rows are dropped rather than silently picking a winner), and projects the
  requested motion onto what's left. `planarize.ts` survives only as the offered repair for
  a design that loaded warped — it is no longer in any editing path.
- `src/geometry/validate.ts` / `normalize.ts` — the ten constraints from the spec, checked.
  In normal use nothing fires: the editing operations are written not to break them. They
  earn their keep on the load path, where a design file is untrusted input. Structural
  breakage (a face pointing at a vertex that isn't there, a face side with no edge) is
  repaired, because the alternative is a crash; geometric invalidity (a warped, slivered or
  self-crossing face) is reported and left alone, with a repair offered. Both are surfaced
  in the sidebar rather than happening silently. Designs saved before edges existed migrate
  on load by deriving their edge set from face loops, once.
- `src/store/designStore.ts` — a Zustand store wrapping the design with selection
  state, undo/redo, and the mode-specific in-progress drafts (open sketch, face-build
  chain).
- `src/components/viewport/` — the Three.js/`@react-three/fiber` 3D scene.
- `src/components/panels/` — the per-mode side panels and the always-on dimensions
  table.
- `src/export/__tests__/dxfRoundTrip.test.ts` — parses the exported DXF back and checks it
  measures what the model says. Every other test works on geometry in memory; this one works
  on the bytes that leave the app, which is where the failures have actually been — the
  import that broke wasn't wrong geometry, it was correct numbers in a notation DXF readers
  reject. Its assertions were checked by mutation: emitting raw JS numbers, laying panels out
  from projected rather than true lengths, and declaring millimetres in the header each make
  the matching test fail. It cannot tell you whether the miter convention matches a real cut
  part; that needs plywood.
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
