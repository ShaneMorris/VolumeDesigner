import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useDesignStore, resolvePendingPoint } from '../../store/designStore';
import type { Face, Vec3 } from '../../geometry/types';
import { facePositions, findSharedEdge } from '../../geometry/mesh';
import { faceEdgePairs } from '../../geometry/edges';
import { edgeKey } from '../../geometry/types';
import { faceLocalBasis, fromFaceLocal, toFaceLocal } from '../../geometry/basis';
import { verticalPlaneFacingCamera } from '../../geometry/drawPlane';
import { fanTriangulatePositions, toArray } from './threeHelpers';
import { installDragGuard, pointerDragged } from './dragGuard';
import { V } from '../../geometry/vec3';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Hard ceiling on handle size, so a big work area can't produce absurd spheres. */
const MAX_HANDLE_RADIUS_IN = 0.5;

/** The square work area the model is built on, at its user-set size. */
function GroundGrid() {
  const size = useDesignStore((s) => s.design.basePlaneSizeIn);
  // One grid line per inch stays readable at 24in but turns to mush at 96in.
  const divisions = size <= 36 ? Math.round(size) : Math.round(size / 2);
  return <gridHelper args={[size, divisions, '#5b6470', '#2a2f38']} rotation={[Math.PI / 2, 0, 0]} />;
}

function SketchPreview() {
  const sketchRadius = useHandleRadius();
  const openSketch = useDesignStore((s) => s.openSketch);
  const addSketchPoint = useDesignStore((s) => s.addSketchPoint);
  const mode = useDesignStore((s) => s.mode);
  const basePlaneSizeIn = useDesignStore((s) => s.design.basePlaneSizeIn);

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

  const onPlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'sketch') return;
    if (pointerDragged(e)) return; // the camera was being orbited, not a point placed
    e.stopPropagation();
    const point = new THREE.Vector3();
    e.ray.intersectPlane(plane, point);
    if (!point) return;
    // A click near the horizon meets the ground plane a very long way off, so keep
    // sketch points inside the work area rather than stranding one in the distance.
    const half = basePlaneSizeIn / 2;
    const clamp = (value: number) => Math.min(half, Math.max(-half, Math.round(value * 8) / 8));
    addSketchPoint({ x: clamp(point.x), y: clamp(point.y), z: 0 });
  };

  const points = openSketch.map((p) => new THREE.Vector3(p.x, p.y, p.z));

  return (
    <group>
      <mesh rotation={[0, 0, 0]} onClick={onPlaneClick} visible={false}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial />
      </mesh>
      {points.length >= 2 && <Line points={points} color="#f5a623" dashed={false} lineWidth={2} />}
      {points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[sketchRadius, 12, 12]} />
          <meshBasicMaterial color={i === 0 ? '#4ade80' : '#f5a623'} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Handle radius scaled to the work area, so grab targets stay a consistent apparent size
 * whether the volume is 6in or 96in across — a fixed radius is an unclickable speck on a
 * large base and a blob on a small one.
 *
 * Deliberately keyed to the base plane rather than to the geometry: measuring the model
 * let a single stray point far out in space inflate every handle, and because the size
 * only ever grew with the outlier, the spheres never shrank back. The work area is a
 * stable reference that misplaced geometry can't move.
 */
function useHandleRadius(): number {
  const basePlaneSizeIn = useDesignStore((s) => s.design.basePlaneSizeIn);
  return Math.min(MAX_HANDLE_RADIUS_IN, Math.max(0.06, basePlaneSizeIn * 0.005));
}

/**
 * Size of the drawing surface, tied to the work area and deliberately *finite*. An
 * unbounded plane meant a click aimed near the horizon struck it at an enormous
 * distance and dropped a point far out in space; the surface has to end somewhere the
 * user can actually see. Slightly taller than the plane so walls have headroom.
 */
/**
 * How big the invisible sheet that catches drawing clicks is.
 *
 * Generously larger than anything on screen, because a *drawing plane is infinite* — the
 * mesh only exists to give the raycaster something to hit. Sized to the work area it
 * behaved as a wall: outside it no pointer event fired at all, so the cursor stopped
 * updating and clicks went nowhere, which looks exactly like being unable to draw past an
 * invisible boundary. Where the resulting point may actually land is bounded separately,
 * by the work area, rather than by how big this sheet happens to be.
 */
function useDrawSurfaceSize(): number {
  const basePlaneSizeIn = useDesignStore((s) => s.design.basePlaneSizeIn);
  return basePlaneSizeIn * 40;
}

/** Orientation quaternion that lays a default (XY) plane onto an arbitrary normal. */
function quaternionForNormal(normal: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(normal.x, normal.y, normal.z).normalize(),
  );
}

/**
 * The surface the face in progress is drawn on. It's a bounded quad oriented to the
 * current draw plane — vertical and facing the camera for the first couple of points,
 * then the face's own plane once three points have fixed it. Pointer moves over it feed
 * the rubber-band segment; clicks commit the pending point.
 */
/**
 * What the pointer is over, if it's over real geometry.
 *
 * The drawing plane stands in front of (or through) the model, so without this the point
 * follows the plane even while the cursor is plainly over a face — which reads as the point
 * hanging in the foreground instead of settling onto the thing being pointed at.
 *
 * Geometry wins over the plane wherever the two disagree, including geometry *behind* it.
 * That is deliberate, and it is the opposite of the rule used for deciding what a click
 * selects: there, a broad face far behind the target is usually an accident, whereas here
 * the cursor is visibly on the face and that is what the user means. Typing an exact
 * length or angle overrides the snap, which is the way to put a point in open space in
 * front of the model.
 *
 * A corner beats everything at any depth — it is a small target, so hitting one at all
 * means it was aimed at. Otherwise the nearest edge or face takes it.
 */
function snapFromIntersections(
  intersections: Array<{ object: THREE.Object3D; point: THREE.Vector3; distance: number }>,
): Vec3 | null {
  for (const i of intersections) {
    const snapTo = i.object.userData?.snapTo as Vec3 | undefined;
    if (i.object.userData?.isVertexHandle && snapTo) return snapTo;
  }

  // Already sorted near to far, so the first thing real is the thing being pointed at.
  for (const i of intersections) {
    const data = i.object.userData ?? {};
    if (data.isEdgeHandle) {
      const a = data.edgeA as Vec3 | undefined;
      const b = data.edgeB as Vec3 | undefined;
      if (!a || !b) continue;
      // Onto the line itself, not merely near it.
      const along = V.sub(b, a);
      const lengthSq = V.dot(along, along);
      if (lengthSq < 1e-12) continue;
      const t = Math.min(1, Math.max(0, V.dot(V.sub(i.point, a), along) / lengthSq));
      return V.add(a, V.scale(along, t));
    }
    if (data.isFaceHandle) return { x: i.point.x, y: i.point.y, z: i.point.z };
  }
  return null;
}

function DrawSurface() {
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const drawPlane = useDesignStore((s) => s.drawPlane);
  const setDrawCursor = useDesignStore((s) => s.setDrawCursor);
  const commitPendingPoint = useDesignStore((s) => s.commitPendingPoint);
  const size = useDrawSurfaceSize();

  const orientation = useMemo(
    () => (drawPlane ? quaternionForNormal(drawPlane.normal) : new THREE.Quaternion()),
    [drawPlane],
  );

  if (draftVertexIds.length === 0 || !drawPlane) return null;


  // The draw surface is a construction aid, so real geometry under the pointer wins
  // over it: skip placing a point and leave propagation alone, letting the handle's own
  // onClick run. Vertices and faces need different rules, because they differ in size.
  //
  // A vertex handle is a small sphere — the ray can only hit it if the user was pointing
  // at it — so it wins wherever it lies along the ray, including behind the surface
  // (which is exactly where an existing corner sits when you reach back to close a face).
  // A face is broad, and the ray routinely carries on past the point being aimed at and
  // strikes one well behind it, so a face only wins when it's in front, visibly
  // occluding the surface.
  const clickBelongsToGeometry = (e: ThreeEvent<MouseEvent>) =>
    e.intersections.some(
      (i) =>
        i.object.userData?.isVertexHandle ||
        (i.object.userData?.isFaceHandle && i.distance < e.distance),
    );

  return (
    <group>
      {/* The sheet that catches the pointer. Never drawn: a translucent fill at this size
          would tint the whole viewport, and at any size a visible plane reads as a wall
          rather than as the guide it is — which is exactly how the old one was read. The
          rubber band, the snap highlight and the numeric read-out already say where the
          point will land, without putting a surface in the way. */}
      <mesh
        position={[drawPlane.origin.x, drawPlane.origin.y, drawPlane.origin.z]}
        quaternion={orientation}
        visible={false}
        userData={{ isDrawSurface: true }}
        onPointerMove={(e) => setDrawCursor({ x: e.point.x, y: e.point.y, z: e.point.z })}
        onClick={(e) => {
          if (pointerDragged(e)) return; // an orbit ends over this sheet; that is not a click
          if (clickBelongsToGeometry(e)) return;
          e.stopPropagation();
          setDrawCursor({ x: e.point.x, y: e.point.y, z: e.point.z });
          commitPendingPoint();
        }}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial side={THREE.DoubleSide} />
      </mesh>

    </group>
  );
}

/**
 * Where a chain begins when it doesn't begin on existing geometry.
 *
 * A first point has no previous point to hang a plane off, so it lands on the work area
 * itself — the one plane that's always meaningful. After that the chain's own plane takes
 * over. Without this, drawing could only ever start from something already drawn, which
 * rules out roughing in a shape from nothing.
 */
function ChainStartSurface() {
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const basePlaneSizeIn = useDesignStore((s) => s.design.basePlaneSizeIn);
  const startChainAtPoint = useDesignStore((s) => s.startChainAtPoint);
  const { camera } = useThree();
  const size = useDrawSurfaceSize();

  if (draftVertexIds.length > 0) return null;

  return (
    <mesh
      visible={false}
      onClick={(e) => {
        if (pointerDragged(e)) return; // an orbit that happened to end here
        // Existing geometry under the pointer has its own handlers and wins.
        if (e.intersections.some((i) => i.object.userData?.isVertexHandle || i.object.userData?.isEdgeHandle)) {
          return;
        }
        e.stopPropagation();
        const half = basePlaneSizeIn / 2;
        const clamp = (value: number) => Math.min(half, Math.max(-half, value));
        const origin = { x: clamp(e.point.x), y: clamp(e.point.y), z: 0 };
        startChainAtPoint(
          origin,
          verticalPlaneFacingCamera(origin, {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          }),
        );
      }}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial />
    </mesh>
  );
}

/**
 * The live segment from the last placed point to wherever the next one would land —
 * the "line that moves with the cursor" — plus a marker at that landing point.
 */
function RubberBandSegment() {
  const design = useDesignStore((s) => s.design);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const drawPlane = useDesignStore((s) => s.drawPlane);
  const drawCursor = useDesignStore((s) => s.drawCursor);
  const drawSnap = useDesignStore((s) => s.drawSnap);
  const lockedLengthIn = useDesignStore((s) => s.lockedLengthIn);
  const lockedAngleDeg = useDesignStore((s) => s.lockedAngleDeg);
  const lockedHeightIn = useDesignStore((s) => s.lockedHeightIn);
  const handleRadius = useHandleRadius();

  if (!drawPlane || draftVertexIds.length === 0) return null;

  const lastId = draftVertexIds[draftVertexIds.length - 1];
  const from = design.vertices.find((v) => v.id === lastId)?.position;
  if (!from) return null;

  // The same resolver the click uses, so the line previews exactly what will be placed.
  const to = resolvePendingPoint({
    design,
    draftVertexIds,
    drawPlane,
    drawCursor,
    drawSnap,
    lockedLengthIn,
    lockedAngleDeg,
    lockedHeightIn,
  });
  if (!to) return null;

  return (
    <group>
      <Line
        points={[new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]}
        color={drawSnap ? '#4ade80' : '#fbbf24'}
        lineWidth={2}
      />
      {/* Green marks a point resting on real geometry rather than on the drawing plane. */}
      <mesh position={[to.x, to.y, to.z]}>
        <sphereGeometry args={[handleRadius * (drawSnap ? 1.3 : 1), 12, 12]} />
        <meshBasicMaterial color={drawSnap ? '#4ade80' : '#fbbf24'} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

/**
 * Works out what the drawing cursor is resting on, by raycasting the scene directly.
 *
 * Deliberately not hung off the draw surface's own pointer events: that surface is a
 * bounded quad, so wherever it doesn't happen to lie under the cursor there was no event
 * at all and the snap never updated — which is precisely the case this is for, since the
 * model is usually beside or behind the plane rather than on it.
 */
function DrawInference() {
  const { camera, gl, scene, raycaster } = useThree();
  const drawing = useDesignStore((s) => s.draftVertexIds.length > 0);
  const setDrawSnap = useDesignStore((s) => s.setDrawSnap);

  useEffect(() => {
    if (!drawing) {
      setDrawSnap(null);
      return;
    }
    const canvas = gl.domElement;
    const ndc = new THREE.Vector2();

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      setDrawSnap(snapFromIntersections(raycaster.intersectObjects(scene.children, true)));
    };

    canvas.addEventListener('pointermove', onMove);
    return () => canvas.removeEventListener('pointermove', onMove);
  }, [drawing, camera, gl, scene, raycaster, setDrawSnap]);

  return null;
}

/**
 * Where a pointer ray meets a horizontal plane, when that answer is worth having.
 *
 * A ray nearly parallel to the plane meets it enormously far away — a pixel of mouse
 * movement then becomes yards of model, which is what makes a drag suddenly fling a corner
 * into the distance and leave a long slender face behind. Below a shallow angle there is no
 * usable answer, so the drag simply doesn't move rather than moving wildly.
 *
 * What does come back is held inside the work area, the same way sketch clicks are: a
 * vertex stranded outside it is both unreachable and disruptive.
 */
const MIN_RAY_PITCH = 0.08; // ~4.6 degrees off parallel

function hitHorizontalPlane(
  ray: THREE.Ray,
  planeZ: number,
  halfExtent: number,
  into: THREE.Vector3,
): THREE.Vector3 | null {
  if (Math.abs(ray.direction.z) < MIN_RAY_PITCH) return null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  if (!ray.intersectPlane(plane, into)) return null;
  const clamp = (value: number) => Math.min(halfExtent, Math.max(-halfExtent, value));
  into.set(clamp(into.x), clamp(into.y), planeZ);
  return into;
}

/**
 * Click-drag movement for the Move tool. Pointer moves are tracked on the window rather
 * than on scene objects so the drag survives the cursor leaving the (small) vertex
 * sphere. Dragging is horizontal by default — along the plane through the vertex — and
 * vertical (Z only) while Shift is held, which is the pair of constraints that actually
 * matter for these shapes.
 */
function VertexDragHandler() {
  const { camera, gl } = useThree();
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);
  const endDrag = useDesignStore((s) => s.endDrag);

  useEffect(() => {
    if (!draggingVertexId) return;

    const start = useDesignStore.getState().design.vertices.find((v) => v.id === draggingVertexId)?.position;
    if (!start) return;

    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const half = useDesignStore.getState().design.basePlaneSizeIn / 2;

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray;

      if (ev.shiftKey) {
        // Closest point on the vertical line through the vertex to the pointer ray.
        const w0 = new THREE.Vector3().subVectors(start, ray.origin);
        const b = ray.direction.z;
        const denom = 1 - b * b;
        if (Math.abs(denom) < 1e-6) return; // looking straight down the axis
        const sc = (b * ray.direction.dot(w0) - w0.z) / denom;
        useDesignStore
          .getState()
          .moveVertex(draggingVertexId, { x: start.x, y: start.y, z: start.z + sc }, { commit: false });
        return;
      }

      if (hitHorizontalPlane(ray, start.z, half, hit)) {
        useDesignStore
          .getState()
          .moveVertex(draggingVertexId, { x: hit.x, y: hit.y, z: start.z }, { commit: false });
      }
    };

    // The whole drag is one undo step, recorded from where it started rather than from
    // the position it ended at.
    const onUp = () => endDrag();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingVertexId, camera, gl, endDrag]);

  return null;
}

/**
 * Click-drag movement for a whole edge: both ends travel together, so the edge keeps its
 * length and direction and only the translation is up for negotiation. Same pointer
 * conventions as a vertex drag — horizontal by default, vertical while Shift is held —
 * measured from the edge's midpoint, which is where it was grabbed.
 */
function EdgeDragHandler() {
  const { camera, gl } = useThree();
  const draggingEdge = useDesignStore((s) => s.draggingEdge);
  const endDrag = useDesignStore((s) => s.endDrag);

  useEffect(() => {
    if (!draggingEdge) return;
    const { a, b } = draggingEdge;
    const verts = useDesignStore.getState().design.vertices;
    const pa = verts.find((v) => v.id === a)?.position;
    const pb = verts.find((v) => v.id === b)?.position;
    if (!pa || !pb) return;

    const origin = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const half = useDesignStore.getState().design.basePlaneSizeIn / 2;
    // Measured against where the edge sits right now, so each move is a delta rather than
    // an absolute — the store has already refused or redirected everything before it.
    const midpointNow = () => {
      const current = useDesignStore.getState().design.vertices;
      const ca = current.find((v) => v.id === a)!.position;
      const cb = current.find((v) => v.id === b)!.position;
      return new THREE.Vector3((ca.x + cb.x) / 2, (ca.y + cb.y) / 2, (ca.z + cb.z) / 2);
    };

    const onMove = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray;
      const from = midpointNow();

      if (ev.shiftKey) {
        const w0 = new THREE.Vector3().subVectors(origin, ray.origin);
        const d = ray.direction.z;
        const denom = 1 - d * d;
        if (Math.abs(denom) < 1e-6) return;
        const sc = (d * ray.direction.dot(w0) - w0.z) / denom;
        const targetZ = origin.z + sc;
        useDesignStore.getState().moveEdgeBy(a, b, { x: 0, y: 0, z: targetZ - from.z }, { commit: false });
        return;
      }

      if (hitHorizontalPlane(ray, origin.z, half, hit)) {
        useDesignStore
          .getState()
          .moveEdgeBy(a, b, { x: hit.x - from.x, y: hit.y - from.y, z: 0 }, { commit: false });
      }
    };

    const onUp = () => endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingEdge, camera, gl, endDrag]);

  return null;
}

/** Live preview of the face currently being drawn in Build mode: connects its picked
 * vertices (existing or freshly-placed on the work plane) in order, open until closed. */
function DraftFaceOutline() {
  const design = useDesignStore((s) => s.design);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);

  if (draftVertexIds.length < 2) return null;

  const points = draftVertexIds
    .map((id) => design.vertices.find((v) => v.id === id)?.position)
    .filter((p): p is Vec3 => !!p)
    .map((p) => new THREE.Vector3(p.x, p.y, p.z));

  if (points.length < 2) return null;

  return <Line points={points} color="#f5a623" lineWidth={2} dashed />;
}

function VertexHandle({ id, position, locked }: { id: string; position: Vec3; locked: boolean }) {
  const mode = useDesignStore((s) => s.mode);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const buildTool = useDesignStore((s) => s.buildTool);
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);
  const selectVertex = useDesignStore((s) => s.selectVertex);
  const startDrawingAt = useDesignStore((s) => s.startDrawingAt);
  const extendChainTo = useDesignStore((s) => s.extendChainTo);
  const beginVertexDrag = useDesignStore((s) => s.beginVertexDrag);

  const baseRadius = useHandleRadius();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const isSelected = selectedVertexId === id;
  const isInDraft = draftVertexIds.includes(id);
  const isDragging = draggingVertexId === id;
  const movable = mode === 'build' && buildTool === 'move' && !locked;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (pointerDragged(e)) return; // released here after orbiting, not clicked here
    e.stopPropagation();
    if (mode === 'build' && buildTool === 'draw') {
      if (draftVertexIds.length === 0) {
        // Drawing starts on a vertical plane through this vertex, turned to face the
        // camera — frozen now so orbiting mid-face can't move it underneath the cursor.
        startDrawingAt(
          id,
          verticalPlaneFacingCamera(position, {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          }),
        );
      } else {
        // Just another segment. If it closes a loop a face appears on its own, and if it
        // cuts across a face that face divides — neither needs a gesture of its own, so
        // there is nothing here about finishing or routing through.
        extendChainTo(id);
      }
      return;
    }
    selectVertex(id);
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!movable) return;
    e.stopPropagation();
    selectVertex(id);
    beginVertexDrag(id);
  };

  const color = isDragging
    ? '#fbbf24'
    : isSelected
      ? '#4ade80'
      : locked
        ? '#64748b'
        : isInDraft
          ? '#f5a623'
          : hovered && movable
            ? '#fbbf24'
            : '#7dd3fc';

  // Grabbable points are drawn larger so they're easy to hit with the Move tool.
  const radius = baseRadius * (movable ? 1.6 : 1);

  return (
    <group>
      <mesh
        position={toArray(position)}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        userData={{ isVertexHandle: true, vertexId: id, snapTo: position }}
      >
        <sphereGeometry args={[radius, 14, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {locked && (
        <mesh position={toArray(position)}>
          <ringGeometry args={[radius * 1.5, radius * 1.9, 16]} />
          <meshBasicMaterial color="#64748b" side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function FaceMesh({ face }: { face: Face }) {
  const design = useDesignStore((s) => s.design);
  const mode = useDesignStore((s) => s.mode);
  const selectedFaceId = useDesignStore((s) => s.selectedFaceId);
  const selectedEdge = useDesignStore((s) => s.selectedEdge);
  const selectFace = useDesignStore((s) => s.selectFace);
  const selectEdge = useDesignStore((s) => s.selectEdge);
  const addHole = useDesignStore((s) => s.addHole);
  const [hovered, setHovered] = useState(false);

  const positions = facePositions(design, face);
  const geomPositions = useMemo(() => fanTriangulatePositions(positions), [positions]);

  const isBase = design.baseFaceId === face.id;
  const isSelected = selectedFaceId === face.id;
  const isEdgeMember = selectedEdge && (selectedEdge.faceAId === face.id || selectedEdge.faceBId === face.id);

  let color = isBase ? '#3d5a6c' : '#3d5145';
  if (isEdgeMember) color = '#8b5cf6';
  else if (isSelected) color = '#f5a623';
  else if (hovered) color = '#6b7280';

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // A face is the broadest target in the scene, so an orbit almost always ends on one —
    // which would otherwise drop a T-nut hole or change the selection.
    if (pointerDragged(e)) return;
    e.stopPropagation();
    if (mode === 'angles') {
      if (!selectedFaceId) {
        selectFace(face.id);
        return;
      }
      if (selectedFaceId === face.id) return;
      const shared = findSharedEdge(design, selectedFaceId, face.id);
      if (shared) {
        selectEdge({ a: shared.a, b: shared.b, faceAId: shared.faceIds[0], faceBId: shared.faceIds[1] });
        selectFace(null);
      } else {
        selectFace(face.id);
      }
      return;
    }
    if (mode === 'holes') {
      const basis = faceLocalBasis(design, face);
      const point = { x: e.point.x, y: e.point.y, z: e.point.z };
      const { u, v } = toFaceLocal(basis, point);
      addHole(face.id, Math.round(u * 100) / 100, Math.round(v * 100) / 100);
      return;
    }
    selectFace(face.id);
  };

  return (
    <mesh
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
      userData={{ isFaceHandle: true }}
    >
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[geomPositions, 3]} />
      </bufferGeometry>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} />
    </mesh>
  );
}

/**
 * One drawn edge, with everything the pointer can do to it.
 *
 * Shared by the edges of a face and by edges belonging to no face, so the two behave
 * identically — an edge drawn and left standing is as selectable, draggable and drawable-on
 * as one that happens to sit on a panel.
 */
function EdgeLine({ a, b, standalone }: { a: string; b: string; standalone?: boolean }) {
  const design = useDesignStore((s) => s.design);
  const mode = useDesignStore((s) => s.mode);
  const buildTool = useDesignStore((s) => s.buildTool);
  const selectedEdge = useDesignStore((s) => s.selectedEdge);
  const selectedEdgePair = useDesignStore((s) => s.selectedEdgePair);
  const selectEdgePair = useDesignStore((s) => s.selectEdgePair);
  const beginEdgeDrag = useDesignStore((s) => s.beginEdgeDrag);
  const draggingEdge = useDesignStore((s) => s.draggingEdge);
  const chainThroughEdge = useDesignStore((s) => s.chainThroughEdge);
  const { camera } = useThree();
  const handleRadius = useHandleRadius();

  const pa = design.vertices.find((v) => v.id === a)?.position;
  const pb = design.vertices.find((v) => v.id === b)?.position;
  if (!pa || !pb) return null;

  const start = new THREE.Vector3(pa.x, pa.y, pa.z);
  const end = new THREE.Vector3(pb.x, pb.y, pb.z);

  // Edges answer to the pointer in all three tools: Select picks them, Move drags them
  // whole, Draw runs a chain onto them.
  const selectable = mode === 'build' && buildTool === 'select';
  const draggable = mode === 'build' && buildTool === 'move';
  const drawable = mode === 'build' && buildTool === 'draw';
  const pickable = selectable || draggable || drawable;

  const matches = (edge: { a: string; b: string } | null) =>
    !!edge && ((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
  const isSelected = matches(selectedEdge) || matches(selectedEdgePair);
  const isDragging = matches(draggingEdge);

  // An edge on no face is drawn brighter than a panel's outline: it is scaffold the user
  // deliberately left standing, and it is the only thing marking that geometry.
  const restingColor = standalone ? '#7dd3fc' : draggable ? '#3b4a63' : '#1e293b';

  return (
    <group>
      <Line
        points={[start, end]}
        color={isDragging ? '#fbbf24' : isSelected ? '#facc15' : restingColor}
        lineWidth={isDragging || isSelected ? 3 : standalone ? 2 : draggable ? 2 : 1}
      />
      {/* A line is a hairline to the raycaster, so picking rides on an invisible cylinder
          around it — thick enough to hit without hunting for the pixel. */}
      {pickable && (
        <mesh
          position={start.clone().add(end).multiplyScalar(0.5)}
          quaternion={new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            end.clone().sub(start).normalize(),
          )}
          visible={false}
          onClick={(e) => {
            if (pointerDragged(e)) return; // an orbit that ended over this edge
            if (drawable) {
              // Landing "near" an edge isn't good enough — a point a hundredth of an inch
              // off the line is a different and worse thing than one on it. The edge is
              // split at the click so the point is genuinely on it.
              e.stopPropagation();
              chainThroughEdge(
                a,
                b,
                { x: e.point.x, y: e.point.y, z: e.point.z },
                verticalPlaneFacingCamera(
                  { x: e.point.x, y: e.point.y, z: e.point.z },
                  { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                ),
              );
              return;
            }
            if (!selectable) return;
            e.stopPropagation();
            selectEdgePair({ a, b });
          }}
          onPointerDown={(e) => {
            if (!draggable) return;
            e.stopPropagation();
            selectEdgePair({ a, b });
            beginEdgeDrag(a, b);
          }}
          userData={{ isEdgeHandle: true, edgeA: pa, edgeB: pb }}
        >
          <cylinderGeometry args={[handleRadius * 0.7, handleRadius * 0.7, start.distanceTo(end), 6]} />
          <meshBasicMaterial />
        </mesh>
      )}
    </group>
  );
}

function FaceEdges({ face }: { face: Face }) {
  const n = face.vertexIds.length;
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => (
        <EdgeLine key={i} a={face.vertexIds[i]} b={face.vertexIds[(i + 1) % n]} />
      ))}
    </group>
  );
}

/**
 * Edges that belong to no face yet.
 *
 * Without this they are invisible: the face renderer only knows about panels, and the
 * in-progress outline vanishes when the chain ends. An edge drawn deliberately and left
 * standing would exist, be listed in the dimensions table, and show nothing at all where
 * it runs — which makes the one thing the drawing tool is for impossible to see.
 */
function StandaloneEdges() {
  const design = useDesignStore((s) => s.design);
  const onAFace = new Set<string>();
  for (const face of design.faces) {
    for (const { a, b } of faceEdgePairs(face)) onAFace.add(edgeKey(a, b));
  }
  const loose = design.edges.filter((e) => !onAFace.has(edgeKey(e.a, e.b)));
  return (
    <group>
      {loose.map((e) => (
        <EdgeLine key={edgeKey(e.a, e.b)} a={e.a} b={e.b} standalone />
      ))}
    </group>
  );
}

function HoleMarkers() {
  const design = useDesignStore((s) => s.design);
  const mode = useDesignStore((s) => s.mode);
  const selectedHoleId = useDesignStore((s) => s.selectedHoleId);
  const selectHole = useDesignStore((s) => s.selectHole);

  return (
    <group>
      {design.holes.map((hole) => {
        const face = design.faces.find((f) => f.id === hole.faceId);
        if (!face) return null;
        const basis = faceLocalBasis(design, face);
        const center = fromFaceLocal(basis, hole.u, hole.v);
        const isSelected = selectedHoleId === hole.id;
        return (
          <mesh
            key={hole.id}
            position={toArray(center)}
            onClick={(e) => {
              e.stopPropagation();
              if (mode === 'holes') selectHole(hole.id);
            }}
          >
            <ringGeometry args={[hole.diameterIn / 2 - 0.015, hole.diameterIn / 2, 24]} />
            <meshBasicMaterial color={isSelected ? '#facc15' : '#ef4444'} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

function SceneContent() {
  const design = useDesignStore((s) => s.design);
  const mode = useDesignStore((s) => s.mode);
  const buildTool = useDesignStore((s) => s.buildTool);
  const drawing = mode === 'build' && buildTool === 'draw';

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 5, 8]} intensity={0.8} />
      <GroundGrid />
      <VertexDragHandler />
      <EdgeDragHandler />
      {mode === 'sketch' && <SketchPreview />}
      {drawing && <DrawInference />}
      {drawing && <ChainStartSurface />}
      {drawing && <DrawSurface />}
      {drawing && <RubberBandSegment />}
      {drawing && <DraftFaceOutline />}
      {design.faces.map((f) => (
        <FaceMesh key={f.id} face={f} />
      ))}
      {design.faces.map((f) => (
        <FaceEdges key={`edges-${f.id}`} face={f} />
      ))}
      <StandaloneEdges />
      {design.vertices.map((v) => (
        <VertexHandle key={v.id} id={v.id} position={v.position} locked={!!v.locked} />
      ))}
      <HoleMarkers />
    </>
  );
}

/**
 * Points the camera at the model and backs off far enough to see all of it. Runs once on
 * mount and again whenever something asks for a re-frame (creating a preset base, or the
 * Fit view button) — a fixed camera position can't suit both a 3in and a 30in volume.
 */
function CameraRig() {
  const { camera, controls } = useThree();
  const frameNonce = useDesignStore((s) => s.frameNonce);

  useEffect(() => {
    const { design } = useDesignStore.getState();
    const points = design.vertices.map((v) => v.position);

    const center = { x: 0, y: 0, z: 0 };
    let radius = 6;
    if (points.length > 0) {
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (const p of points) {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
      }
      center.x = (min.x + max.x) / 2;
      center.y = (min.y + max.y) / 2;
      center.z = (min.z + max.z) / 2;
      radius = Math.max(
        1,
        Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2,
      );
    }

    const perspective = camera as THREE.PerspectiveCamera;
    const fovRad = ((perspective.fov ?? 75) * Math.PI) / 180;
    const distance = (radius / Math.sin(fovRad / 2)) * 1.25;

    // Keep the established three-quarter viewing direction, just at the right distance.
    const dir = new THREE.Vector3(0.45, -0.7, 0.55).normalize();
    camera.up.set(0, 0, 1);
    camera.position.set(
      center.x + dir.x * distance,
      center.y + dir.y * distance,
      center.z + dir.z * distance,
    );
    camera.lookAt(center.x, center.y, center.z);

    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.set(center.x, center.y, center.z);
      orbit.update?.();
    }
  }, [camera, controls, frameNonce]);

  return null;
}

/** True while focus is in a text/number field, where keys belong to the field. */
function isTypingInAField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/** Esc abandons the face in progress; Del removes whatever is selected. */
function useViewportKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingInAField()) return;
      const store = useDesignStore.getState();

      if (e.key === 'Escape') {
        if (store.mode === 'build' && store.buildTool === 'draw' && store.draftVertexIds.length > 0) {
          store.endChain();
        }
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (store.mode !== 'build' || store.buildTool !== 'select') return;
      if (store.selectedEdgePair) {
        e.preventDefault();
        store.deleteEdge(store.selectedEdgePair.a, store.selectedEdgePair.b);
      } else if (store.selectedVertexId) {
        e.preventDefault();
        store.deleteVertex(store.selectedVertexId);
      } else if (store.selectedFaceId) {
        e.preventDefault();
        store.deleteFace(store.selectedFaceId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Viewport() {
  const selectVertex = useDesignStore((s) => s.selectVertex);
  const selectFace = useDesignStore((s) => s.selectFace);
  const mode = useDesignStore((s) => s.mode);
  const buildTool = useDesignStore((s) => s.buildTool);
  const endChain = useDesignStore((s) => s.endChain);
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);
  const draggingEdge = useDesignStore((s) => s.draggingEdge);
  useViewportKeyboard();
  useEffect(installDragGuard, []);

  return (
    <div
      style={{ width: '100%', height: '100%', background: '#0f1115' }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (mode === 'build' && buildTool === 'draw') endChain();
      }}
    >
      <Canvas
        onPointerMissed={() => {
          selectVertex(null);
          selectFace(null);
        }}
      >
        <CameraRig />
        {/* Orbiting has to stand down mid-drag, or the camera moves with the vertex. */}
        <OrbitControls makeDefault enabled={!draggingVertexId && !draggingEdge} />
        <SceneContent />
      </Canvas>
    </div>
  );
}
