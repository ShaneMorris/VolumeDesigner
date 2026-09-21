# Climbing Volume Modeler — Requirements

2026-09-19 · @Someone

## 1. Overview

Shane models **climbing volumes** — hollow geometric shapes (wedges, pyramids, tapered blocks) that get bolted to a climbing wall as holds. Volumes are typically built from flat plywood/composite panels cut on a CNC, then assembled into a 3D solid.

Existing tools are a poor fit:

- **SketchUp** — reasonably close, but no native way to unfold 3D faces into flat, real-world-dimensioned CNC parts.
- **Tinkercad** — too limited for tapered/lofted shapes, and has no unfolding or DXF export at all.
- **FreeCAD** — has the underlying capability (Part Design, Sketcher, Loft) but the workflow is scattered across workbenches and steps, and is general-purpose CAD rather than built for this one job.

This app is a **purpose-built tool for one job**: design a climbing volume as a precise 3D polygon-based solid, then flatten ("unfold") each face into a CNC-ready DXF panel with mounting holes — in far fewer steps than a general CAD tool requires.

## 2. User workflow

Single user (Shane), one volume at a time. End-to-end flow the app must support:

1. **Sketch the base polygon** — draw an arbitrary closed polygon (3+ sides), setting each edge's exact length and each vertex's exact interior angle numerically (typed values, not just drag-to-snap).
2. **Build the solid face-by-face** — draw edges from base vertices upward (or between any two existing vertices); a face appears wherever those edges close a loop (§3). Edges may be drawn precisely and left standing before the face around them is finished. Drag any vertex, or any whole edge, to reshape connected faces live, within the limits that keep every face planar (§3). A straight "pull up" shortcut is available as an option when the base face is selected, but it is not the default action — manual face-by-face construction is the primary, general-purpose method.
3. **Measure and set face angles** — for any two faces sharing an edge, see the dihedral (face-to-face) angle along that edge. Optionally lock that angle to an exact value (including standard commercial-bit angles), which repositions the connected vertices to satisfy it.
4. **Review the 3D solid** — rotate/pan/zoom a live 3D preview; see live dimension read-outs (edge lengths, dihedral angles) as numbers, not just visually.
5. **Place mounting hardware** — add T-nut/bolt holes at chosen points on chosen faces (typically the base), with standard hole diameter presets and precise X/Y placement on that face.
6. **Unfold faces to flat panels** — every face of the solid (base, each side) becomes its own flat 2D panel, correctly sized to its true (non-projected) dimensions, including hole positions from step 5 and the bevel angle needed along each edge (from step 3).
7. **Export DXF** — each unfolded panel exported as its own DXF file (or one DXF with panels laid out separately), ready to hand to CNC software.

The core value of the app is steps 3, 6 and 7: giving precise, settable control over the bevel angle between faces, then turning the 3D design into accurate, individually-labeled flat parts — with the correct cut angle attached — without hand-calculating panel geometry or bevel trigonometry.

## 3. Geometry model & constraints

The model is **edge-primary**: vertices join into edges, and a face comes into being where
edges close a loop. An edge does not need a face to exist. That is what lets a defining edge
— "rise at 45° to a height of 4 inches" — be drawn exactly and left standing while the rest of
the face is worked out, which is how the design work actually proceeds.

> v1 was built face-primary: faces were stored and edges derived from their loops, so a
> standalone edge could not be represented. The constraints below describe the target model;
> see §8 for the migration.

**Entities**

- **Vertex** — a point in 3D space, nothing more.
- **Edge** — joins exactly two distinct vertices. Stored in its own right, and may belong to
  zero, one or two faces.
- **Face** — an ordered, closed loop of three or more vertices, every consecutive pair of which
  is an edge. The face owns the label, the base designation, its holes and its angle locks.

**Constraints**

These are invariants: the app must not be able to reach a state that breaks one, whether by
drawing, editing, or loading a file.

1. **An edge joins exactly two distinct vertices.** No self-edges, no edge with one endpoint.
2. **A vertex with no incident edge is _orphaned_.** Orphans are legal and are never swept
   automatically — they are the scaffold left behind by deletion, and the in-progress state of
   drawing. Only the points created by a draw that was then abandoned get discarded.
3. **A face exists only where three or more vertices, joined by edges, form a closed loop.**
   Faces are not declared ahead of their edges; closing a qualifying loop is what creates one.
4. **Deleting a vertex deletes every edge incident to it** — and therefore, via 5, every face
   those edges helped form.
5. **Deleting an edge deletes every face that edge helped form.** Both of its vertices survive,
   as do the other edges of those faces: the scaffold stays up so the geometry can be redrawn
   on the same points.
6. **A face must enclose real area.** Three collinear points form a closed loop of three
   vertices but enclose nothing — no normal, no plane, no dihedral angle with a neighbour, and
   a degenerate DXF panel. Near-collinear slivers are worse than the exact case: they pass a
   naive check but their normal flips direction under tiny edits, making bevel angles jump. So
   this is a tolerance test on enclosed area, not an exact-zero test.
7. **A face's boundary must not cross itself.** Four corners taken in the order A→B→D→C give a
   bowtie whose two diagonals cross. The crossing point is not a vertex, so this cannot be
   stored as two triangles; it is one face with a boundary that crosses itself, and its area
   computes as the difference of the two lobes rather than the sum. **Do not insert a vertex at
   the crossing** (SketchUp's behaviour, deliberately not adopted). Refuse to create the face
   and tell the user why. The same rule applies to a new edge that crosses an existing one.
8. **Referential integrity.** Every id resolves: each entry in a face's loop is a real vertex,
   each consecutive pair is a real edge, both endpoints of every edge exist, every hole's face
   and both faces of every angle lock exist, and the base face id resolves or is null. No
   vertex appears twice in one loop. Enforced on file load as well as on edit — a design file
   is parsed and validated, never cast and trusted.
9. **A face's vertices must be coplanar** — at creation, and through every subsequent edit.
   This is the real statement of the "crease" problem: a warped quad is not a cosmetic glitch,
   it is a panel that cannot be cut from flat stock, and the diagonal crease visible in the
   viewport is the renderer's triangulation showing through.
10. **An edge belongs to at most two faces.** A closed volume is a shell: each edge joins
    exactly two panels, an in-progress one has edges with zero or one. Three faces meeting along
    one edge has no bevel angle to cut and no meaning for this tool. *(Proposed — confirm.)*

**Enforcing constraint 9: constrained dragging**

Dragging is restricted to motion that keeps every affected face planar. The alternative —
letting a drag warp faces and relaxing the model afterward — moves geometry the user did not
grab, and was rejected for that reason.

*Moving a vertex.* Each incident face with four or more vertices contributes one constraint:
that face's other vertices are fixed and already coplanar, so they define a plane the dragged
vertex must stay in. Triangular faces contribute nothing, being always planar. The vertex may
move only in the intersection of those planes:

| Incident faces with 4+ sides | Freedom |
| --- | --- |
| 0 | free in 3D |
| 1 | slides on a plane |
| 2 | slides along a line |
| 3 or more | cannot move at all |

*Moving an edge.* Grab an edge near its middle and both endpoints translate together by the
same vector. The constraints differ from dragging either endpoint alone, which is why an edge
sometimes moves where its vertices cannot:

- A face containing **both** endpoints contributes one constraint. Because the endpoints move
  together, the edge keeps its length and direction, and the face's coplanarity condition stays
  linear in the translation — one equation, not two.
- A face containing **only one** endpoint contributes the same plane constraint as a vertex
  drag, applied to that endpoint.

Both cases reduce to the same computation: collect the linear constraints, take the null space
of the system, and project the pointer's motion into it. Freedom is `3 − rank`.

*Limits versus freedom.* Planarity reduces the **dimension** of the allowed motion. Constraints
6 and 7 bound its **extent** — a drag is stopped before it collapses a face to zero area or
makes a boundary cross itself. The user sees both as "it won't go there", but they are separate
mechanisms and the UI should say which is acting.

*Honest consequence.* A closed box of planar quads is rigid: nothing can move without breaking
planarity, and constrained dragging will correctly refuse every vertex. This is not a bug, and
the app must **say why** rather than silently ignoring the drag — "pinned by 3 planar faces" is
the difference between a constraint and a broken tool. The remedy is to split a face (below),
which adds the freedom back.

**Editing operations**

- **Draw edges.** Each click commits a real edge immediately. A chain may start anywhere — on an
  existing vertex, on a point along an existing edge, or in empty space. Esc ends the chain and
  **keeps** what was drawn. Faces appear on their own as loops close; there is no separate
  "close the face" gesture.
- **Inference while drawing.** Clicking near an edge must land exactly *on* it, not near it — a
  vertex 0.01in off an edge is a different and worse thing than one on it. First pass covers
  three targets: vertex endpoint, edge midpoint, and on-edge with a numeric distance-along entry.
- **Split an edge.** Inserting a vertex partway along an edge replaces it with two edges, and
  **every face using that edge gains the new vertex in its loop** — otherwise the face boundary
  stops matching the edge set, breaking constraint 8. The new vertex is collinear with its
  neighbours, so affected faces stay planar for free and show a 180° interior angle.
- **Split a face.** Draw a chord between two points on a face's boundary and it becomes two
  faces. Either may be a triangle or a polygon of any size — this is a general division, not a
  triangulation. Because the parent is planar, the chord lies in its plane and both children are
  planar automatically. The chord must stay inside the boundary (always true for a convex face,
  checked for a concave one) and must not cross another edge, per constraint 7. This is also the
  escape hatch for a fully-pinned vertex.
  - Modelled as a named operation, not as a side effect of loop detection, because the parent's
    metadata has to be divided deliberately: **holes** reassign to whichever child contains them
    with their u/v recomputed (the face-local frame starts at the face's first vertex and runs
    along its first edge, so both children have a different origin); **angle locks** follow
    whichever child still carries the locked edge; the **label** is inherited by both with a
    suffix.
  - **The base face cannot be split.**
- **Move a vertex / move an edge.** As constrained above.
- **Delete a vertex / edge / face.** Per constraints 4 and 5.

## 4. Feature: 3D shape modeling

**Base polygon sketch**

- Draw a closed 2D polygon by placing vertices (click to add, snap to grid as a starting aid).
- Select any edge and enter its exact length numerically; the opposite vertex/vertices adjust to match.
- Select any vertex and enter its exact interior angle numerically.
- Sketch must visibly indicate when it is *not* closed (open wire) vs. closed (valid face).
- Support at minimum triangles, quadrilaterals, and irregular polygons up to \~8 sides — no need for curves/arcs.

**Face construction & editing**

- Draw an edge between any two points: existing vertices, new points along existing edges, or empty space. Each segment commits as it is drawn and survives Esc — see §3 for the full drawing and inference rules.
- A face appears wherever edges close a qualifying loop (§3, constraints 3, 6, 7 and 9). There is no separate "close the face" gesture.
- Enter a segment's exact length and angle as it is drawn, or its target height, so a defining edge such as "45° rising to 4in" is two typed numbers rather than a trigonometry problem.
- Select and drag any vertex, or any whole edge, to reshape every face that touches it, live — restricted to motion that keeps those faces planar, and with the reason shown when a drag is limited or refused (§3).
- Split an edge (insert a vertex along it) or split a face (draw a chord across it) to subdivide existing geometry; see §3 for both.
- A straight "pull up" shortcut (take the base polygon and extrude it a numeric height, unmodified cross-section) is available as an option when the base face is selected, but is never the default action — its result is just ordinary editable faces/vertices afterward. If this is ever extended to a top-profile (loft-style) shortcut, matching vertex counts between base and top is sufficient — no need to support mismatched counts.

**Face angles**

- For any two faces that share an edge, display the dihedral angle between them (the angle a CNC bevel bit would need to cut along that shared edge) as a live, numeric read-out.
- Allow explicitly setting that dihedral angle to a numeric value, including quick-pick presets for common commercial bevel-bit angles (exact preset list TBD with Shane). Setting the angle repositions the connected face's vertices to satisfy it. Edge lengths are never protected at the expense of a locked angle — if a later edit would conflict with a locked angle, the app adjusts edge lengths to preserve the angle, not the other way around (lengths are rarely critical for these shapes; angles usually are).
- Every face is planar by construction (§3, constraint 9), so every face is safely unfoldable. Faces cannot become non-planar through editing; the only route to a warped face is a design file predating this rule (see Face unfolding).

**Precision requirements**

- All lengths and angles are numeric text entry fields, not just mouse-dragged.
- Display a live, always-visible dimension read-out for every edge length and every dihedral (face-to-face) angle in the current solid.
- Round-trip precision: a value typed in should be exactly what gets exported, not rounded/approximated by internal geometry math.

## 5. Feature: face unfolding

Each planar face of the solid (base, top, each side wall) must be converted to its true flat 2D shape — the shape's real edge lengths and angles as they exist in 3D, not a projection.

- For a face that is planar (a triangle, always; or a quad/polygon whose vertices happen to lie in one plane), unfolding is a straightforward projection into the face's own plane.
- Constraint 9 means editing can no longer produce a non-planar face, so the twisted-quad case is now reachable only by loading a design file created before that rule. Such a file is flagged on load with the offending faces named, and the user is offered an explicit "make planar" repair — the geometry is never silently moved. Until repaired, those faces unfold as an approximation (split along a diagonal into two flat triangles) and are marked as approximate on the panel.
- Each unfolded panel should be labeled (e.g. "Base", "Side 1", "Side 2", "Top") matching its position on the 3D model, so Shane can tell which flat part goes where during assembly.
- Unfolded panels should be laid out with no overlap when placed on a single sheet view (a simple non-overlapping layout is enough — true nesting/optimization is not required for v1).
- Each unfolded panel should show the bevel (dihedral) angle needed to cut each of its edges, taken from that edge's angle to its neighboring face in the 3D model — this is the main reason the angle needs to be both precisely measurable and settable.
- Material thickness is not needed for kerf/toolpath (handled in Carveco's CAM), but does affect the true outline of a panel near a corner where two or more beveled edges meet — the correct miter line there depends on panel thickness and the bevel angles involved. Recommendation: take panel thickness as a single global design parameter and use it only to compute correct corner miters on each panel's outline.

## 6. Feature: mounting hardware (T-nuts / bolt holes)

- Add one or more hole markers to any face (typically the base, but any face should be supported).
- Each hole has: X/Y position on that face (numeric, relative to a corner or the face's center — pick one consistent reference), and a fixed diameter of 0.5 in (matches Shane's T-nut hardware) — no other diameter presets needed for v1.
- Holes must survive the unfold step — i.e. they appear in the correct position on the corresponding flat DXF panel, in the panel's true (unfolded) coordinate space.
- A simple visual snap/guide (center of face, evenly spaced along an edge) is helpful but not required for v1; numeric X/Y entry is the minimum bar.

## 7. Feature: DXF export

- Export each unfolded panel as a DXF file containing: the panel outline (closed polyline) and any hole circles, in inches, as a plain/standard DXF (e.g. AutoCAD R12 ASCII) — Carveco Maker imports standard DXF with a unit choice at import time, so no special header or layer convention is required.
- Either one DXF per panel, or one DXF with panels arranged on separate non-overlapping layouts/layers — whichever is simpler to implement first; multi-file export is likely the safer v1 choice.
- Exported geometry must match the app's internal precision (no visible rounding error at typical CNC tolerances).
- Nice to have, not required for v1: label text (panel name, and the bevel angle for each edge) included in the DXF as an annotation layer, so parts are identifiable and the correct bit/angle is clear after cutting.

## 8. Technical approach

- **Platform**: local web app, runs in-browser (no install, cross-platform). Revisit desktop packaging (e.g. Electron/Tauri) only if offline use or file-system integration becomes a real pain point.
- **3D rendering**: Three.js (or similar WebGL library) for the interactive 3D preview.
- **Geometry engine**: a general polyhedron mesh model that the user builds up manually, rather than a parametric extrude. Vertices, edges and faces are all stored, with edges as the single source of truth for connectivity and faces as a named, ordered overlay carrying label, base designation, holes and angle locks (§3). *Migration from v1:* v1 stored only vertices and faces, deriving edges from face loops. Existing saved designs load by deriving their edge set from face loops once, then validating against §3 — including the planarity check, whose failures are reported rather than silently repaired. The angle-lock feature (setting the dihedral angle between two faces to an exact value) needs a small geometric solver: given a target angle along a shared edge, rotate the affected face's vertices about that edge until the angle matches, always resolving conflicts in favor of the locked angle — adjusting edge lengths, never silently breaking a locked angle. This solver is the single most technically involved part of the app and should be prototyped early to validate feasibility before the rest of the UI is built around it.
- **DXF export**: hand-written AutoCAD R12 (AC1009) ASCII. The library route was tried first and abandoned: `dxf-writer` emits AC1021 with LWPOLYLINE entities and stringifies coordinates with plain JS formatting, producing values like `5.551115123125783e-17` for floating-point near-zeros. DXF readers expect plain decimal reals and reject exponent notation, so those files failed to import at all. The writer formats every real as fixed decimal, snaps near-zeros, and refuses non-finite or implausible coordinates.
- **State/data model**: the design (mesh vertices/edges/faces, any locked angle constraints, and hole positions) should be representable as a single serializable JSON structure, so save/load and undo/redo are straightforward to add.
- **Persistence**: local save/load of a design (as a file or browser storage) so Shane can return to a volume in progress. Cloud sync/accounts are out of scope.

## 9. Out of scope for v1

- Curved/rounded edges or organic (non-polygonal) shapes.
- True nesting/optimization of panel layouts for material efficiency.
- Multi-volume assemblies or libraries of reusable volume templates.
- Rendering/texturing for visual presentation (this is a fabrication tool, not a marketing render tool).
- Multi-user accounts, cloud storage, or sharing features.
- CNC toolpath generation (G-code) — v1 stops at DXF; the CNC software handles toolpathing.

## 10. Decisions log

- **Units & format**: inches; plain/standard DXF (e.g. AutoCAD R12 ASCII) — confirmed compatible with Carveco Maker, which lets the user pick units on import.
- **T-nut hole size**: fixed at 0.5 in diameter; no other presets needed.
- **Vertex-count matching**: any future top-profile (loft-style) shortcut only needs to support matching vertex counts between base and top.
- **Material thickness**: not needed for kerf/toolpath (handled in Carveco's CAM), but affects the true panel outline at a corner where two or more beveled edges meet (a miter). Recommendation: take panel thickness as a single global parameter, used only to compute correct corner miters (see Face unfolding).
- **Pull-up shortcut**: available as an option when the base face is selected; never the default action.
- **Angle vs. length conflicts**: always resolved by adjusting edge lengths — a locked angle is never silently broken.
- **Edge-primary model**: edges are first-class and storable without a face, so a defining edge can be drawn exactly and left standing while the rest of its face is worked out. Faces emerge from closed loops. (Supersedes v1's face-primary model, where edges existed only as consecutive pairs inside a face loop.)
- **Face planarity (constraint 9)**: enforced by *constraining the drag* — a vertex or edge may move only where every affected face stays planar, and the app says why when motion is limited or refused. Rejected alternative: let the drag warp faces and relax the model afterward, which moves geometry the user did not grab (this was v1's "keep faces flat" behaviour and the source of the reported crease). A fully pinned vertex is a real and correct outcome; splitting a face is the remedy.
- **Edge dragging**: grabbing an edge near its middle translates both endpoints together. Deliberately a separate operation from vertex dragging, because its constraint set differs — an edge can move where neither of its endpoints could alone.
- **Face splitting**: a general division into two faces of any size, not a triangulation. Modelled as a named operation so holes, angle locks and labels are divided deliberately.
- **Base face splitting**: not allowed. Keeps the base a single panel and `baseFaceId` a single reference.
- **Crossing edges**: never split at the intersection (SketchUp does; this app does not). A face or edge that would cross is refused, with a warning naming the conflict.
- **Orphaned vertices**: legal, and never swept automatically — they are the scaffold deletion deliberately leaves behind for redrawing.
