export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
export const DV: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const CW: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };
const CCW: Record<Dir, Dir> = { N: 'W', W: 'S', S: 'E', E: 'N' };

export const opposite = (d: Dir): Dir => OPP[d];
export const rotateDir = (d: Dir, cw: boolean): Dir => (cw ? CW[d] : CCW[d]);
/** Mirror across the axis of `axis` (used to flip a turn's chirality while keeping its input). */
export const mirrorDir = (d: Dir, axis: Dir): Dir => (d === axis || d === OPP[axis] ? d : OPP[d]);
/** Angle (radians, around world +Y) pointing from cell center toward the given side. +X = E, +Z = S. */
export const dirAngle = (d: Dir): number => ({ E: 0, S: -Math.PI / 2, W: Math.PI, N: Math.PI / 2 })[d];
export const cellKey = (c: number, r: number) => `${c},${r}`;
