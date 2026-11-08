import * as THREE from 'three';
import { DV, type Dir } from '../game/ports';
import { CELL } from '../game/levels';

export const HALF = CELL / 2;
export const BELT_Y = 0.2; // belt surface height (m)

export interface PathPiece {
  length: number;
  at(t: number, out: THREE.Vector3): THREE.Vector3; // local cell coords
  tangent(t: number, out: THREE.Vector3): THREE.Vector3;
}

export const edgePoint = (d: Dir, inset = 0) => new THREE.Vector3(DV[d][0] * (HALF - inset), 0, DV[d][1] * (HALF - inset));

export function linePiece(a: THREE.Vector3, b: THREE.Vector3): PathPiece {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  return {
    length: len,
    at: (t, o) => o.copy(a).lerp(b, t),
    tangent: (_t, o) => o.copy(dir),
  };
}

/** Quarter arc from edge(entry) to edge(exit), centred at the shared cell corner. */
export function arcPiece(entry: Dir, exit: Dir): PathPiece {
  const a = edgePoint(entry), b = edgePoint(exit);
  const corner = a.clone().add(b);
  const a0 = Math.atan2(a.z - corner.z, a.x - corner.x);
  let a1 = Math.atan2(b.z - corner.z, b.x - corner.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  a1 = a0 + da;
  const r = HALF;
  return {
    length: Math.abs(da) * r,
    at: (t, o) => { const ang = a0 + da * t; return o.set(corner.x + Math.cos(ang) * r, 0, corner.z + Math.sin(ang) * r); },
    tangent: (t, o) => { const ang = a0 + da * t; const s = Math.sign(da); return o.set(-Math.sin(ang) * s, 0, Math.cos(ang) * s); },
  };
}

/** Candy travel path inside a transport cell for a given entry/exit pair. */
export function travelPieces(entry: Dir, exit: Dir, kind: string): PathPiece[] {
  const a = edgePoint(entry), b = edgePoint(exit);
  const straight = DV[entry][0] === -DV[exit][0] && DV[entry][1] === -DV[exit][1];
  if (straight && kind !== 'split' && kind !== 'merge') return [linePiece(a, b)];
  if (!straight && kind === 'turn') return [arcPiece(entry, exit)];
  const c = new THREE.Vector3();
  return [linePiece(a, c), linePiece(c, b)];
}

export function sampleChain(pieces: PathPiece[], t: number, out: THREE.Vector3, tan?: THREE.Vector3) {
  const total = pieces.reduce((s, p) => s + p.length, 0);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (d <= p.length || i === pieces.length - 1) {
      const lt = p.length > 0 ? Math.min(1, d / p.length) : 0;
      p.at(lt, out);
      if (tan) p.tangent(lt, tan);
      return out;
    }
    d -= p.length;
  }
  return out;
}
