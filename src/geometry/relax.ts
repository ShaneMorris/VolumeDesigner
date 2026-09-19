import type { Design } from './types';
import { findSharedEdge } from './mesh';
import { solveDihedralAngle } from './solver';

/**
 * Re-applies every stored angle lock so the mesh stays consistent after an unrelated edit
 * (e.g. dragging a vertex that indirectly moved a locked edge). Each lock always resolves
 * by rotating its designated child face about the shared edge — never by touching an edge
 * length. Multiple locks are iterated a few times as a simple relaxation, since one lock's
 * fix can perturb another lock's edge.
 */
export function reapplyAngleLocks(design: Design, iterations = 3): Design {
  let d = design;
  for (let iter = 0; iter < iterations; iter++) {
    for (const lock of d.angleLocks) {
      const edge = findSharedEdge(d, lock.faceAId, lock.faceBId);
      if (!edge) continue;
      d = solveDihedralAngle(d, edge, lock.faceBId, lock.targetAngleDeg);
    }
  }
  return d;
}
