import type { Design, Face } from './types';
import { edgeKey } from './types';
import { V, polygonNormal, polygonCentroid } from './vec3';
import { getVertex } from './mesh';
import { faceEdgePairs, facesOnEdge } from './edges';
import { effectiveWidthIn, MIN_FACE_WIDTH_IN } from './validate';
import { splitFace } from './split';

/**
 * Finding the face a newly drawn edge just closed (requirements §3, constraint 3).
 *
 * Faces are not declared; they come into being when edges enclose something. So after every
 * edge is drawn the question is whether it completed a loop, and if so which one.
 *
 * The answer has to be the *smallest* loop through that edge. Drawing a chord across an
 * existing quad closes three loops at once — the two halves and the original outline — and
 * only the halves are faces. Preferring the shortest and rejecting any loop with a chord
 * across it picks them out.
 *
 * An edge can close *two* loops at once, and both of them are real: the last edge of a
 * tetrahedron does exactly that, with a triangle either side of it. Constraint 10 already
 * caps an edge at two faces, so two is the most that can ever be right and is never a
 * guess. Only more than there is room for is genuinely ambiguous — a fin of three faces
 * meeting along one edge — and then nothing is created and the user says what they meant.
 */

/** How far off a shared plane a loop's corners may sit and still count as coplanar. */
const COPLANAR_EPS_IN = 1e-3;
/** Loops longer than this aren't panels of a climbing volume; the search stops there. */
const MAX_LOOP_LENGTH = 12;

function adjacency(design: Design): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of design.edges) {
    if (!map.has(e.a)) map.set(e.a, []);
    if (!map.has(e.b)) map.set(e.b, []);
    map.get(e.a)!.push(e.b);
    map.get(e.b)!.push(e.a);
  }
  return map;
}

export function loopIsCoplanar(design: Design, loop: string[]): boolean {
  if (loop.length <= 3) return true;
  const points = loop.map((id) => getVertex(design, id).position);
  const normal = polygonNormal(points);
  if (V.length(normal) < 1e-9) return false;
  const centroid = polygonCentroid(points);
  return points.every((p) => Math.abs(V.dot(V.sub(p, centroid), normal)) < COPLANAR_EPS_IN);
}

/** Whether two vertices that aren't neighbours in the loop are nonetheless joined by an edge. */
function hasChord(design: Design, loop: string[]): boolean {
  const stored = new Set(design.edges.map((e) => edgeKey(e.a, e.b)));
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // these two are neighbours, round the back
      if (stored.has(edgeKey(loop[i], loop[j]))) return true;
    }
  }
  return false;
}

function sameLoop(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((id) => setA.has(id));
}

/** Every face already in the design, as a set for "have we got this one". */
function existingLoops(faces: Face[]): string[][] {
  return faces.map((f) => f.vertexIds);
}

/**
 * Whether adding this loop as a face would put a third face on any of its edges,
 * which constraint 10 forbids.
 */
function wouldOverfillAnEdge(design: Design, loop: string[]): boolean {
  const counts = new Map<string, number>();
  for (const face of design.faces) {
    for (const { a, b } of faceEdgePairs(face)) {
      const key = edgeKey(a, b);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    if ((counts.get(edgeKey(loop[i], loop[(i + 1) % n])) ?? 0) >= 2) return true;
  }
  return false;
}

/**
 * Every smallest loop the new edge `a`-`b` closed — none, one, or several.
 *
 * All of them at the same depth, since a loop one step longer is a different and larger
 * thing rather than an alternative reading of the same one.
 */
export function loopsClosedByEdge(design: Design, a: string, b: string): string[][] {
  const neighbours = adjacency(design);
  if (!neighbours.has(a) || !neighbours.has(b)) return [];

  const direct = edgeKey(a, b);
  const known = existingLoops(design.faces);

  // Breadth-first from `a` to `b` without using the new edge itself, so the first paths
  // found are the shortest. Paths are kept whole because the loop is what gets tested.
  let frontier: string[][] = [[a]];
  const visitedAtDepth = new Set<string>([a]);

  for (let depth = 1; depth < MAX_LOOP_LENGTH; depth++) {
    const next: string[][] = [];
    const arrivals: string[][] = [];

    for (const path of frontier) {
      const tip = path[path.length - 1];
      for (const neighbour of neighbours.get(tip) ?? []) {
        if (edgeKey(tip, neighbour) === direct) continue; // never walk the new edge
        if (path.includes(neighbour)) continue; // simple paths only
        if (neighbour === b) {
          arrivals.push([...path, b]);
          continue;
        }
        next.push([...path, neighbour]);
      }
    }

    const qualifying = arrivals.filter(
      (loop) =>
        loop.length >= 3 &&
        !known.some((k) => sameLoop(k, loop)) &&
        loopIsCoplanar(design, loop) &&
        effectiveWidthIn(loop.map((id) => getVertex(design, id).position)) >= MIN_FACE_WIDTH_IN &&
        !hasChord(design, loop) &&
        !wouldOverfillAnEdge(design, loop),
    );

    const distinct = qualifying.filter(
      (loop, i) => !qualifying.some((other, j) => j < i && sameLoop(other, loop)),
    );
    if (distinct.length > 0) return distinct;

    frontier = next.filter((path) => {
      const tip = path[path.length - 1];
      if (visitedAtDepth.has(tip) && path.length > 2) return true; // revisits are fine here
      visitedAtDepth.add(tip);
      return true;
    });
    if (frontier.length === 0) break;
  }

  return [];
}

/**
 * What a newly drawn edge brings into being, if anything.
 *
 * Two different things can happen and they are not interchangeable:
 *
 * - The edge runs between two corners of a face that already exists, so it **divides** that
 *   face. Both halves are real, and the parent owned a label, holes and angle locks that
 *   have to be handed on deliberately — so this goes to `splitFace` rather than being
 *   rediscovered as a pair of loops.
 * - Otherwise the edge may have **closed** a loop that was still open, which becomes a face.
 *
 * Anything else — an edge that closes nothing, or closes two equally good loops at once —
 * leaves the design alone. The edge stays either way; that is the point of storing edges.
 */
export function faceFromNewEdge(
  design: Design,
  a: string,
  b: string,
  makeId: () => string,
): { design: Design; created: string[]; refusal?: string } {
  const shared = design.faces.find((f) => f.vertexIds.includes(a) && f.vertexIds.includes(b));
  if (shared) {
    const size = shared.vertexIds.length;
    const i = shared.vertexIds.indexOf(a);
    const j = shared.vertexIds.indexOf(b);
    const apart = Math.min((j - i + size) % size, (i - j + size) % size);
    if (apart >= 2) {
      const split = splitFace(design, shared.id, a, b, makeId);
      return split.ok
        ? { design: split.design, created: split.faceIds }
        : { design, created: [], refusal: split.reason };
    }
    return { design, created: [] }; // already neighbours: the edge was there all along
  }

  // Take one loop at a time and look again, so each search runs against the design as it
  // now stands: the face just made is a known one and won't be re-found, and constraint 10
  // stops a third from ever attaching to this edge.
  let current = design;
  const created: string[] = [];

  while (created.length < 2) {
    const room = 2 - facesOnEdge(current, a, b).length;
    if (room <= 0) break;

    const loops = loopsClosedByEdge(current, a, b);
    if (loops.length === 0) break;
    // More loops than the edge can carry is the one genuinely ambiguous case — a fin of
    // three faces along one edge. Which two would be a guess, so make none of them.
    if (loops.length > room) break;

    const id = makeId();
    current = {
      ...current,
      faces: [...current.faces, { id, vertexIds: loops[0], label: `Side ${current.faces.length + 1}` }],
    };
    created.push(id);
  }

  return { design: current, created };
}
