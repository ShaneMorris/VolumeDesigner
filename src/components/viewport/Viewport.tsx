import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useDesignStore } from '../../store/designStore';
import type { Face, Vec3 } from '../../geometry/types';
import { facePositions, findSharedEdge } from '../../geometry/mesh';
import { faceLocalBasis, fromFaceLocal, toFaceLocal } from '../../geometry/basis';
import { fanTriangulatePositions, toArray } from './threeHelpers';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

function GroundGrid() {
  return (
    <gridHelper
      args={[40, 40, '#5b6470', '#2a2f38']}
      rotation={[Math.PI / 2, 0, 0]}
    />
  );
}

function SketchPreview() {
  const sketchRadius = useHandleRadius();
  const openSketch = useDesignStore((s) => s.openSketch);
  const addSketchPoint = useDesignStore((s) => s.addSketchPoint);
  const mode = useDesignStore((s) => s.mode);

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

  const onPlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'sketch') return;
    e.stopPropagation();
    const point = new THREE.Vector3();
    e.ray.intersectPlane(plane, point);
    if (!point) return;
    const snapped = { x: Math.round(point.x * 8) / 8, y: Math.round(point.y * 8) / 8, z: 0 };
    addSketchPoint(snapped);
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

/** Snap a work-plane coordinate to the 1/8in grid. */
function snapToGrid(value: number): number {
  return Math.round(value * 8) / 8;
}

/**
 * Handle radius scaled to the model, so grab targets stay a consistent apparent size
 * whether the volume is 3in or 30in across — a fixed radius is an unclickable speck on
 * a large base and a blob on a small one.
 */
function useHandleRadius(): number {
  const design = useDesignStore((s) => s.design);
  return useMemo(() => {
    let extent = 0;
    for (const v of design.vertices) {
      extent = Math.max(extent, Math.abs(v.position.x), Math.abs(v.position.y), Math.abs(v.position.z));
    }
    return Math.min(0.5, Math.max(0.05, extent * 0.02));
  }, [design.vertices]);
}

/**
 * Size of the drawing work plane: big enough to cover the model with room to grow, but
 * deliberately *finite*. An infinite plane meant a click aimed near the horizon hit it
 * at an enormous distance, dropping points far out in space — the plane has to end
 * somewhere the user can see.
 */
function useWorkPlaneSize(): number {
  const design = useDesignStore((s) => s.design);
  return useMemo(() => {
    let extent = 12;
    for (const v of design.vertices) {
      extent = Math.max(extent, Math.abs(v.position.x), Math.abs(v.position.y));
    }
    return Math.ceil((extent + 12) * 2);
  }, [design.vertices]);
}

/**
 * Build mode's "draw into empty space" surface: a bounded horizontal plane at
 * `workPlaneZ` that clicks are projected onto to create new draft vertices, with a grid
 * and a live ghost marker showing exactly where the next point will land.
 */
function BuildWorkPlane() {
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const workPlaneZ = useDesignStore((s) => s.workPlaneZ);
  const addDraftNewVertex = useDesignStore((s) => s.addDraftNewVertex);
  const size = useWorkPlaneSize();
  const handleRadius = useHandleRadius();
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  if (draftVertexIds.length === 0) return null;

  // A click that also hit a vertex or face handle anywhere along the ray belongs to that
  // handle, not to the plane: don't drop a stray point, and don't stop propagation, so
  // the handle's own onClick still fires even though it may be farther from the camera.
  const clickBelongsToHandle = (e: ThreeEvent<MouseEvent>) =>
    e.intersections.some((i) => i.object.userData?.isVertexHandle || i.object.userData?.isFaceHandle);

  const onPlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (clickBelongsToHandle(e)) return;
    e.stopPropagation();
    addDraftNewVertex({ x: snapToGrid(e.point.x), y: snapToGrid(e.point.y), z: workPlaneZ });
  };

  return (
    <group position={[0, 0, workPlaneZ]}>
      <mesh
        onClick={onPlaneClick}
        onPointerMove={(e) => setPreview({ x: snapToGrid(e.point.x), y: snapToGrid(e.point.y) })}
        onPointerOut={() => setPreview(null)}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#7dd3fc" transparent opacity={0.07} side={THREE.DoubleSide} />
      </mesh>
      <gridHelper args={[size, size, '#7dd3fc', '#334155']} rotation={[Math.PI / 2, 0, 0]} />
      {preview && (
        <mesh position={[preview.x, preview.y, 0]}>
          <sphereGeometry args={[handleRadius, 12, 12]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
        </mesh>
      )}
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
  const startDraftAtVertex = useDesignStore((s) => s.startDraftAtVertex);
  const addDraftVertexById = useDesignStore((s) => s.addDraftVertexById);
  const closeDraftFace = useDesignStore((s) => s.closeDraftFace);
  const setDraggingVertexId = useDesignStore((s) => s.setDraggingVertexId);

  const baseRadius = useHandleRadius();
  const [hovered, setHovered] = useState(false);
  const isSelected = selectedVertexId === id;
  const isInDraft = draftVertexIds.includes(id);
  const isDragging = draggingVertexId === id;
  const movable = mode === 'build' && buildTool === 'move' && !locked;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode === 'build' && buildTool === 'draw') {
      if (draftVertexIds.length === 0) {
        startDraftAtVertex(id);
      } else if (id === draftVertexIds[0] && draftVertexIds.length >= 3) {
        closeDraftFace();
      } else if (!isInDraft) {
        addDraftVertexById(id);
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
  const selectedEdge = useDesignStore((s) => s.selectedEdge);
  const positions = facePositions(design, face);
  const points = [...positions, positions[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z));

  const n = face.vertexIds.length;
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => {
        const a = face.vertexIds[i];
        const b = face.vertexIds[(i + 1) % n];
        const isSelected =
          selectedEdge &&
          ((selectedEdge.a === a && selectedEdge.b === b) || (selectedEdge.a === b && selectedEdge.b === a));
        return (
          <Line
            key={i}
            points={[points[i], points[i + 1]]}
            color={isSelected ? '#facc15' : '#1e293b'}
            lineWidth={isSelected ? 3 : 1}
          />
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
      {drawing && <BuildWorkPlane />}
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

export function Viewport() {
  const selectVertex = useDesignStore((s) => s.selectVertex);
  const selectFace = useDesignStore((s) => s.selectFace);
  const mode = useDesignStore((s) => s.mode);
  const buildTool = useDesignStore((s) => s.buildTool);
  const cancelDraft = useDesignStore((s) => s.cancelDraft);
  const draggingVertexId = useDesignStore((s) => s.draggingVertexId);

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
