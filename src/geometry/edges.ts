import type { Design, Edge, EdgeKey, Face } from './types';
import { edgeKey } from './types';

/**
 * Operations on the stored edge set (requirements §3).
 *
 * Edges carry connectivity; faces are an ordered overlay that must be backed by them.
 * Everything here keeps those two in step, so no caller has to remember to.
 */

/** The consecutive vertex pairs around a face's closed loop. */
export function faceEdgePairs(face: Face): Array<{ a: string; b: string }> {
  const n = face.vertexIds.length;
  const pairs: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ a: face.vertexIds[i], b: face.vertexIds[(i + 1) % n] });
  }
  return pairs;
}

export function hasEdge(design: Design, a: string, b: string): boolean {
  const key = edgeKey(a, b);
  return design.edges.some((e) => edgeKey(e.a, e.b) === key);
}

export function edgeKeySet(edges: Edge[]): Set<EdgeKey> {
  return new Set(edges.map((e) => edgeKey(e.a, e.b)));
}

/** Faces whose loop contains this pair as a consecutive pair. */
export function facesOnEdge(design: Design, a: string, b: string): Face[] {
  const key = edgeKey(a, b);
  return design.faces.filter((f) => faceEdgePairs(f).some((p) => edgeKey(p.a, p.b) === key));
}

export function edgesTouchingVertex(design: Design, vertexId: string): Edge[] {
  return design.edges.filter((e) => e.a === vertexId || e.b === vertexId);
}

/**
 * A vertex with no incident edge (requirements §3, constraint 2).
 *
 * Orphans are legal and are never swept automatically: they are the scaffold deletion
 * deliberately leaves behind so faces can be redrawn on the same points. This exists so
 * the concept can be queried and shown, not so it can be cleaned up.
 */
export function orphanVertexIds(design: Design): string[] {
  const connected = new Set<string>();
  for (const e of design.edges) {
    connected.add(e.a);
    connected.add(e.b);
  }
  return design.vertices.filter((v) => !connected.has(v.id)).map((v) => v.id);
}

/** Adds any edge a face loop implies but the edge set is missing. Idempotent. */
export function withFaceEdges(design: Design): Design {
  const present = edgeKeySet(design.edges);
  const added: Edge[] = [];
  for (const face of design.faces) {
    for (const { a, b } of faceEdgePairs(face)) {
      if (a === b) continue; // constraint 1: never store a self-edge
      const key = edgeKey(a, b);
      if (present.has(key)) continue;
      present.add(key);
      added.push({ a, b });
    }
  }
  return added.length === 0 ? design : { ...design, edges: [...design.edges, ...added] };
}

/** The edge set a face-only design implies — the v1 → edge-primary migration. */
export function edgesFromFaces(faces: Face[]): Edge[] {
  const seen = new Set<EdgeKey>();
  const edges: Edge[] = [];
  for (const face of faces) {
    for (const { a, b } of faceEdgePairs(face)) {
      if (a === b) continue;
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }
  return edges;
}

export function addEdge(design: Design, a: string, b: string): Design {
  if (a === b || hasEdge(design, a, b)) return design;
  return { ...design, edges: [...design.edges, { a, b }] };
}

export function removeEdgeKeys(design: Design, keys: Set<EdgeKey>): Design {
  if (keys.size === 0) return design;
  return { ...design, edges: design.edges.filter((e) => !keys.has(edgeKey(e.a, e.b))) };
}
