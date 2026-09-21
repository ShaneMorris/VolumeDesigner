import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useDesignStore } from '../../store/designStore';
import type { Face, Vec3 } from '../../geometry/types';
import { facePositions, findSharedEdge } from '../../geometry/mesh';
import { faceLocalBasis, fromFaceLocal, toFaceLocal } from '../../geometry/basis';
import { resolveNextPoint, verticalPlaneFacingCamera } from '../../geometry/drawPlane';
import { fanTriangulatePositions, toArray } from './threeHelpers';

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
function useDrawSurfaceSize(): number {
  const basePlaneSizeIn = useDesignStore((s) => s.design.basePlaneSizeIn);
  return basePlaneSizeIn * 1.5;
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
    <mesh
      position={[drawPlane.origin.x, drawPlane.origin.y, drawPlane.origin.z]}
      quaternion={orientation}
      onPointerMove={(e) => setDrawCursor({ x: e.point.x, y: e.point.y, z: e.point.z })}
      onClick={(e) => {
        if (clickBelongsToGeometry(e)) return;
        e.stopPropagation();
        setDrawCursor({ x: e.point.x, y: e.point.y, z: e.point.z });
        commitPendingPoint();
      }}
    >
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#7dd3fc" transparent opacity={0.06} side={THREE.DoubleSide} />
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
  const lockedLengthIn = useDesignStore((s) => s.lockedLengthIn);
  const lockedAngleDeg = useDesignStore((s) => s.lockedAngleDeg);
  const handleRadius = useHandleRadius();

  if (!drawPlane || draftVertexIds.length === 0) return null;

  const lastId = draftVertexIds[draftVertexIds.length - 1];
  const from = design.vertices.find((v) => v.id === lastId)?.position;
  if (!from) return null;

  const fullyTyped = lockedLengthIn !== null && lockedAngleDeg !== null;
  if (!drawCursor && !fullyTyped) return null;

  const to = resolveNextPoint(drawPlane, from, drawCursor ?? from, {
    lengthIn: lockedLengthIn,
    angleDeg: lockedAngleDeg,
  });

  return (
    <group>
      <Line
        points={[new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z)]}
        color="#fbbf24"
        lineWidth={2}
      />
      <mesh position={[to.x, to.y, to.z]}>
        <sphereGeometry args={[handleRadius, 12, 12]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} />
      </mesh>
    </group>
  );
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
  const setDraggingVertexId = useDesignStore((s) => s.setDraggingVertexId);

  useEffect(() => {
    if (!draggingVertexId) return;

    const start = useDesignStore.getState().design.vertices.find((v) => v.id === draggingVertexId)?.position;
    if (!start) return;

    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -start.z);
    const hit = new THREE.Vector3();

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

      if (ray.intersectPlane(horizontalPlane, hit)) {
        useDesignStore
          .getState()
          .moveVertex(draggingVertexId, { x: hit.x, y: hit.y, z: start.z }, { commit: false });
      }
    };

    const onUp = () => {
      // Re-commit the final position so the whole drag lands as one undo step.
      const current = useDesignStore.getState().design.vertices.find((v) => v.id === draggingVertexId);
      if (current) useDesignStore.getState().moveVertex(draggingVertexId, current.position, { commit: true });
      setDraggingVertexId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingVertexId, camera, gl, setDraggingVertexId]);

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
  const addDraftVertexById = useDesignStore((s) => s.addDraftVertexById);
  const closeDraftFace = useDesignStore((s) => s.closeDraftFace);
  const setDraggingVertexId = useDesignStore((s) => s.setDraggingVertexId);

  const baseRadius = useHandleRadius();
  const { camera } = useThree();
  const [hovered, setHovered] = useState(false);
  const isSelected = selectedVertexId === id;
  const isInDraft = draftVertexIds.includes(id);
  const isDragging = draggingVertexId === id;
  const movable = mode === 'build' && buildTool === 'move' && !locked;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
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
        // Connecting the line to an existing point finishes the face. Shift-click
        // instead routes through the point and keeps drawing, for a face that runs
        // along several existing corners before it closes.
        const lengthAfter = isInDraft ? draftVertexIds.length : draftVertexIds.length + 1;
        if (!isInDraft) addDraftVertexById(id);
        if (lengthAfter >= 3 && !e.shiftKey) closeDraftFace();
      }
      return;
    }
    selectVertex(id);
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!movable) return;
    e.stopPropagation();
    selectVertex(id);
    setDraggingVertexId(id);
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
        userData={{ isVertexHandle: true }}
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

function FaceEdges({ face }: { face: Face }) {
  const design = useDesignStore((s) => s.design);
  const mode = useDesignStore((s) => s.mode);
  const buildTool = useDesignStore((s) => s.buildTool);
  const selectedEdge = useDesignStore((s) => s.selectedEdge);
  const selectedEdgePair = useDesignStore((s) => s.selectedEdgePair);
  const selectEdgePair = useDesignStore((s) => s.selectEdgePair);
  const handleRadius = useHandleRadius();
  const positions = facePositions(design, face);
  const points = [...positions, positions[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z));

  const pickable = mode === 'build' && buildTool === 'select';
  const n = face.vertexIds.length;

  return (
    <group>
      {Array.from({ length: n }).map((_, i) => {
        const a = face.vertexIds[i];
        const b = face.vertexIds[(i + 1) % n];
        const matches = (edge: { a: string; b: string } | null) =>
          !!edge && ((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
        const isSelected = matches(selectedEdge) || matches(selectedEdgePair);

        return (
          <group key={i}>
            <Line
              points={[points[i], points[i + 1]]}
              color={isSelected ? '#facc15' : '#1e293b'}
              lineWidth={isSelected ? 3 : 1}
            />
            {/* A line is a hairline to the raycaster, so picking rides on an invisible
                cylinder around it — thick enough to hit without hunting for the pixel. */}
            {pickable && (
              <mesh
                position={points[i].clone().add(points[i + 1]).multiplyScalar(0.5)}
                quaternion={new THREE.Quaternion().setFromUnitVectors(
                  new THREE.Vector3(0, 1, 0),
                  points[i + 1].clone().sub(points[i]).normalize(),
                )}
                visible={false}
                onClick={(e) => {
                  e.stopPropagation();
                  selectEdgePair({ a, b });
                }}
              >
                <cylinderGeometry
                  args={[handleRadius * 0.7, handleRadius * 0.7, points[i].distanceTo(points[i + 1]), 6]}
                />
                <meshBasicMaterial />
              </mesh>
            )}
          </group>
        );
      })}
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
      {mode === 'sketch' && <SketchPreview />}
      {drawing && <DrawSurface />}
      {drawing && <RubberBandSegment />}
      {drawing && <DraftFaceOutline />}
      {design.faces.map((f) => (
        <FaceMesh key={f.id} face={f} />
      ))}
      {design.faces.map((f) => (
        <FaceEdges key={`edges-${f.id}`} face={f} />
      ))}
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
          store.cancelDraft();
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
  const cancelDraft = useDesignStore((s) => s.cancelDraft);
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);
  useViewportKeyboard();

  return (
    <div
      style={{ width: '100%', height: '100%', background: '#0f1115' }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (mode === 'build' && buildTool === 'draw') cancelDraft();
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
        <OrbitControls makeDefault enabled={!draggingVertexId} />
        <SceneContent />
      </Canvas>
    </div>
  );
}
