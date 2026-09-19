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
2. **Build the solid face-by-face** — draw edges from base vertices upward (or between any two existing vertices) to form each side face; a new edge's endpoint snaps to an existing vertex to close a face. Drag any vertex to reshape connected faces live. A straight "pull up" shortcut is available as an option when the base face is selected, but it is not the default action — manual face-by-face construction is the primary, general-purpose method.
3. **Measure and set face angles** — for any two faces sharing an edge, see the dihedral (face-to-face) angle along that edge. Optionally lock that angle to an exact value (including standard commercial-bit angles), which repositions the connected vertices to satisfy it.
4. **Review the 3D solid** — rotate/pan/zoom a live 3D preview; see live dimension read-outs (edge lengths, dihedral angles) as numbers, not just visually.
5. **Place mounting hardware** — add T-nut/bolt holes at chosen points on chosen faces (typically the base), with standard hole diameter presets and precise X/Y placement on that face.
6. **Unfold faces to flat panels** — every face of the solid (base, each side) becomes its own flat 2D panel, correctly sized to its true (non-projected) dimensions, including hole positions from step 5 and the bevel angle needed along each edge (from step 3).
7. **Export DXF** — each unfolded panel exported as its own DXF file (or one DXF with panels laid out separately), ready to hand to CNC software.

The core value of the app is steps 3, 6 and 7: giving precise, settable control over the bevel angle between faces, then turning the 3D design into accurate, individually-labeled flat parts — with the correct cut angle attached — without hand-calculating panel geometry or bevel trigonometry.

## 3. Feature: 3D shape modeling

**Base polygon sketch**

- Draw a closed 2D polygon by placing vertices (click to add, snap to grid as a starting aid).
- Select any edge and enter its exact length numerically; the opposite vertex/vertices adjust to match.
- Select any vertex and enter its exact interior angle numerically.
- Sketch must visibly indicate when it is *not* closed (open wire) vs. closed (valid face).
- Support at minimum triangles, quadrilaterals, and irregular polygons up to \~8 sides — no need for curves/arcs.

**Face construction & editing**

- Draw an edge from an existing vertex (a base vertex, or a vertex on any face already built) to a new point or to another existing vertex; the endpoint snaps to a nearby existing vertex so faces close cleanly.
- When a set of edges forms a closed loop, that loop becomes a face (if the loop's vertices are, or can be treated as, planar — see Face unfolding for the non-planar case).
- Select and drag any vertex in 3D to reshape every face that touches it, live.
- A straight "pull up" shortcut (take the base polygon and extrude it a numeric height, unmodified cross-section) is available as an option when the base face is selected, but is never the default action — its result is just ordinary editable faces/vertices afterward. If this is ever extended to a top-profile (loft-style) shortcut, matching vertex counts between base and top is sufficient — no need to support mismatched counts.

**Face angles**

- For any two faces that share an edge, display the dihedral angle between them (the angle a CNC bevel bit would need to cut along that shared edge) as a live, numeric read-out.
- Allow explicitly setting that dihedral angle to a numeric value, including quick-pick presets for common commercial bevel-bit angles (exact preset list TBD with Shane). Setting the angle repositions the connected face's vertices to satisfy it. Edge lengths are never protected at the expense of a locked angle — if a later edit would conflict with a locked angle, the app adjusts edge lengths to preserve the angle, not the other way around (lengths are rarely critical for these shapes; angles usually are).
- Triangular faces are always planar and therefore always safely unfoldable; quad/polygon faces can become non-planar if a vertex is dragged independently — flag this to the user (see Face unfolding).

**Precision requirements**

- All lengths and angles are numeric text entry fields, not just mouse-dragged.
- Display a live, always-visible dimension read-out for every edge length and every dihedral (face-to-face) angle in the current solid.
- Round-trip precision: a value typed in should be exactly what gets exported, not rounded/approximated by internal geometry math.

## 4. Feature: face unfolding

Each planar face of the solid (base, top, each side wall) must be converted to its true flat 2D shape — the shape's real edge lengths and angles as they exist in 3D, not a projection.

- For a face that is planar (a triangle, always; or a quad/polygon whose vertices happen to lie in one plane), unfolding is a straightforward projection into the face's own plane.
- For any side face that is *not* planar (a twisted quad between vertices that don't share a plane — increasingly likely once vertices are dragged independently during manual editing), the app must either:
  - warn the user the face is non-planar and cannot be cut from flat stock as-is, or
  - approximate it as two flat triangles (split along a diagonal) and unfold each separately.
- Each unfolded panel should be labeled (e.g. "Base", "Side 1", "Side 2", "Top") matching its position on the 3D model, so Shane can tell which flat part goes where during assembly.
- Unfolded panels should be laid out with no overlap when placed on a single sheet view (a simple non-overlapping layout is enough — true nesting/optimization is not required for v1).
- Each unfolded panel should show the bevel (dihedral) angle needed to cut each of its edges, taken from that edge's angle to its neighboring face in the 3D model — this is the main reason the angle needs to be both precisely measurable and settable.
- Material thickness is not needed for kerf/toolpath (handled in Carveco's CAM), but does affect the true outline of a panel near a corner where two or more beveled edges meet — the correct miter line there depends on panel thickness and the bevel angles involved. Recommendation: take panel thickness as a single global design parameter and use it only to compute correct corner miters on each panel's outline.

## 5. Feature: mounting hardware (T-nuts / bolt holes)

- Add one or more hole markers to any face (typically the base, but any face should be supported).
- Each hole has: X/Y position on that face (numeric, relative to a corner or the face's center — pick one consistent reference), and a fixed diameter of 0.5 in (matches Shane's T-nut hardware) — no other diameter presets needed for v1.
- Holes must survive the unfold step — i.e. they appear in the correct position on the corresponding flat DXF panel, in the panel's true (unfolded) coordinate space.
- A simple visual snap/guide (center of face, evenly spaced along an edge) is helpful but not required for v1; numeric X/Y entry is the minimum bar.

## 6. Feature: DXF export

- Export each unfolded panel as a DXF file containing: the panel outline (closed polyline) and any hole circles, in inches, as a plain/standard DXF (e.g. AutoCAD R12 ASCII) — Carveco Maker imports standard DXF with a unit choice at import time, so no special header or layer convention is required.
- Either one DXF per panel, or one DXF with panels arranged on separate non-overlapping layouts/layers — whichever is simpler to implement first; multi-file export is likely the safer v1 choice.
- Exported geometry must match the app's internal precision (no visible rounding error at typical CNC tolerances).
- Nice to have, not required for v1: label text (panel name, and the bevel angle for each edge) included in the DXF as an annotation layer, so parts are identifiable and the correct bit/angle is clear after cutting.

## 7. Technical approach

- **Platform**: local web app, runs in-browser (no install, cross-platform). Revisit desktop packaging (e.g. Electron/Tauri) only if offline use or file-system integration becomes a real pain point.
- **3D rendering**: Three.js (or similar WebGL library) for the interactive 3D preview.
- **Geometry engine**: a general polyhedron mesh model (vertices, edges, faces — e.g. a half-edge structure) that the user builds up manually, rather than a parametric extrude. The angle-lock feature (setting the dihedral angle between two faces to an exact value) needs a small geometric solver: given a target angle along a shared edge, rotate the affected face's vertices about that edge until the angle matches, always resolving conflicts in favor of the locked angle — adjusting edge lengths, never silently breaking a locked angle. This solver is the single most technically involved part of the app and should be prototyped early to validate feasibility before the rest of the UI is built around it.
- **DXF export**: use an existing JS DXF-writing library rather than hand-rolling the DXF format.
- **State/data model**: the design (mesh vertices/edges/faces, any locked angle constraints, and hole positions) should be representable as a single serializable JSON structure, so save/load and undo/redo are straightforward to add.
- **Persistence**: local save/load of a design (as a file or browser storage) so Shane can return to a volume in progress. Cloud sync/accounts are out of scope.

## 8. Out of scope for v1

- Curved/rounded edges or organic (non-polygonal) shapes.
- True nesting/optimization of panel layouts for material efficiency.
- Multi-volume assemblies or libraries of reusable volume templates.
- Rendering/texturing for visual presentation (this is a fabrication tool, not a marketing render tool).
- Multi-user accounts, cloud storage, or sharing features.
- CNC toolpath generation (G-code) — v1 stops at DXF; the CNC software handles toolpathing.

## 9. Decisions log

- **Units & format**: inches; plain/standard DXF (e.g. AutoCAD R12 ASCII) — confirmed compatible with Carveco Maker, which lets the user pick units on import.
- **T-nut hole size**: fixed at 0.5 in diameter; no other presets needed.
- **Vertex-count matching**: any future top-profile (loft-style) shortcut only needs to support matching vertex counts between base and top.
- **Material thickness**: not needed for kerf/toolpath (handled in Carveco's CAM), but affects the true panel outline at a corner where two or more beveled edges meet (a miter). Recommendation: take panel thickness as a single global parameter, used only to compute correct corner miters (see Face unfolding).
- **Pull-up shortcut**: available as an option when the base face is selected; never the default action.
- **Angle vs. length conflicts**: always resolved by adjusting edge lengths — a locked angle is never silently broken.
