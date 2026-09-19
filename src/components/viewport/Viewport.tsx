import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, TransformControls, Line } from '@react-three/drei';
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
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshBasicMaterial color={i === 0 ? '#4ade80' : '#f5a623'} />
        </mesh>
      ))}
    </group>
  );
}

function VertexHandle({ id, position }: { id: string; position: Vec3 }) {
  const mode = useDesignStore((s) => s.mode);
  const selectedVertexId = useDesignStore((s) => s.selectedVertexId);
  const draftVertexIds = useDesignStore((s) => s.draftVertexIds);
  const selectVertex = useDesignStore((s) => s.selectVertex);
  const startDraftAtVertex = useDesignStore((s) => s.startDraftAtVertex);
  const addDraftVertexById = useDesignStore((s) => s.addDraftVertexById);
  const closeDraftFace = useDesignStore((s) => s.closeDraftFace);
  const moveVertex = useDesignStore((s) => s.moveVertex);

  const meshRef = useRef<THREE.Mesh>(null);
  const [meshObj, setMeshObj] = useState<THREE.Mesh | null>(null);
  const isSelected = selectedVertexId === id;
  const isInDraft = draftVertexIds.includes(id);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode === 'build') {
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

  const color = isSelected ? '#4ade80' : isInDraft ? '#f5a623' : '#7dd3fc';

  return (
    <group>
      <mesh
        ref={(m) => {
          meshRef.current = m;
          if (m !== meshObj) setMeshObj(m);
        }}
        position={toArray(position)}
        onClick={onClick}
      >
        <sphereGeometry args={[0.045, 14, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {mode === 'build' && isSelected && meshObj && (
        <TransformControls
          object={meshObj}
          mode="translate"
          onObjectChange={() => {
            const p = meshRef.current!.position;
            moveVertex(id, { x: p.x, y: p.y, z: p.z }, { commit: false });
          }}
          onMouseUp={() => {
            const p = meshRef.current!.position;
            moveVertex(id, { x: p.x, y: p.y, z: p.z }, { commit: true });
          }}
        />
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

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 5, 8]} intensity={0.8} />
      <GroundGrid />
      {mode === 'sketch' && <SketchPreview />}
      {design.faces.map((f) => (
        <FaceMesh key={f.id} face={f} />
      ))}
      {design.faces.map((f) => (
        <FaceEdges key={`edges-${f.id}`} face={f} />
      ))}
      {design.vertices.map((v) => (
        <VertexHandle key={v.id} id={v.id} position={v.position} />
      ))}
      <HoleMarkers />
    </>
  );
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1);
    camera.position.set(4, -6, 4.5);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

export function Viewport() {
  const selectVertex = useDesignStore((s) => s.selectVertex);
  const selectFace = useDesignStore((s) => s.selectFace);
  const mode = useDesignStore((s) => s.mode);
  const cancelDraft = useDesignStore((s) => s.cancelDraft);

  return (
    <div
      style={{ width: '100%', height: '100%', background: '#0f1115' }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (mode === 'build') cancelDraft();
      }}
    >
      <Canvas
        onPointerMissed={() => {
          selectVertex(null);
          selectFace(null);
        }}
      >
        <CameraRig />
        <OrbitControls makeDefault />
        <SceneContent />
      </Canvas>
    </div>
  );
}
