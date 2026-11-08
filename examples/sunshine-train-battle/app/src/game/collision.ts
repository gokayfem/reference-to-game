// Train-local collision: axis-aligned solids, swept segment tests and a box-capsule player sweep.
// Y-up, meters, forward = +Z (toward the engine).

export interface V3 { x: number; y: number; z: number }
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export type SolidKind = 'roof' | 'cover' | 'gate' | 'guard' | 'walk' | 'cab' | 'bridge' | 'step';
export interface Solid {
  id: string;
  kind: SolidKind;
  min: V3;
  max: V3;
  active: boolean;
  /** guards stop the player but not projectiles */
  blocksShots: boolean;
}

export function solid(id: string, kind: SolidKind, min: V3, max: V3, blocksShots = true): Solid {
  return { id, kind, min, max, active: true, blocksShots };
}

/** Slab test. Returns entry fraction t in [0,1] of segment p0->p1 hitting box, or null. */
export function segmentAABB(p0: V3, p1: V3, min: V3, max: V3): number | null {
  let tmin = 0, tmax = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Segment vs sphere; returns entry fraction or null. Starting inside counts as t=0. */
export function segmentSphere(p0: V3, p1: V3, c: V3, r: number): number | null {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return 0;
  if (a < 1e-12) return null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export interface SegmentHit { t: number; solid: Solid }
/** Nearest blocking solid along a segment (projectiles / line of sight). */
export function raySolids(p0: V3, p1: V3, solids: Solid[]): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (const s of solids) {
    if (!s.active || !s.blocksShots) continue;
    const t = segmentAABB(p0, p1, s.min, s.max);
    if (t !== null && (!best || t < best.t)) best = { t, solid: s };
  }
  return best;
}

export const PLAYER_HALF = 0.3;
export const PLAYER_HEIGHT = 1.75;
export const STEP_UP = 0.36;

function overlaps(px: number, py: number, pz: number, s: Solid): boolean {
  return px + PLAYER_HALF > s.min.x && px - PLAYER_HALF < s.max.x &&
    pz + PLAYER_HALF > s.min.z && pz - PLAYER_HALF < s.max.z &&
    py + PLAYER_HEIGHT > s.min.y && py < s.max.y;
}

export interface MoveResult { grounded: boolean; hitCeiling: boolean }

/**
 * Moves the player box (feet position) by delta in sub-steps, resolving axis by axis.
 * Sub-stepping keeps the sweep below the thinnest solid (0.12 m) so fast falls cannot tunnel.
 */
export function movePlayer(pos: V3, delta: V3, solids: Solid[], canStep = true): MoveResult {
  const maxStep = 0.1;
  const len = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
  const n = Math.max(1, Math.ceil(len / maxStep));
  let grounded = false, hitCeiling = false;
  for (let i = 0; i < n; i++) {
    // horizontal X
    const dx = delta.x / n, dz = delta.z / n, dy = delta.y / n;
    pos.x += dx;
    for (const s of solids) {
      if (!s.active || !overlaps(pos.x, pos.y, pos.z, s)) continue;
      if (canStep && s.max.y - pos.y <= STEP_UP && s.kind !== 'guard' && s.kind !== 'gate' && fitsAbove(pos, s.max.y, solids)) { pos.y = s.max.y; continue; }
      pos.x = dx > 0 ? s.min.x - PLAYER_HALF - 1e-4 : s.max.x + PLAYER_HALF + 1e-4;
    }
    pos.z += dz;
    for (const s of solids) {
      if (!s.active || !overlaps(pos.x, pos.y, pos.z, s)) continue;
      if (canStep && s.max.y - pos.y <= STEP_UP && s.kind !== 'guard' && s.kind !== 'gate' && fitsAbove(pos, s.max.y, solids)) { pos.y = s.max.y; continue; }
      pos.z = dz > 0 ? s.min.z - PLAYER_HALF - 1e-4 : s.max.z + PLAYER_HALF + 1e-4;
    }
    pos.y += dy;
    for (const s of solids) {
      if (!s.active || !overlaps(pos.x, pos.y, pos.z, s)) continue;
      if (dy <= 0) { pos.y = s.max.y; grounded = true; }
      else { pos.y = s.min.y - PLAYER_HEIGHT - 1e-4; hitCeiling = true; }
    }
  }
  return { grounded, hitCeiling };
}

function fitsAbove(pos: V3, y: number, solids: Solid[]): boolean {
  for (const s of solids) if (s.active && overlaps(pos.x, y + 0.001, pos.z, s)) return false;
  return true;
}

/** Ground probe: is there support within eps below the feet? */
export function supported(pos: V3, solids: Solid[], eps = 0.05): boolean {
  for (const s of solids) {
    if (!s.active) continue;
    if (pos.x + PLAYER_HALF > s.min.x && pos.x - PLAYER_HALF < s.max.x && pos.z + PLAYER_HALF > s.min.z && pos.z - PLAYER_HALF < s.max.z &&
      pos.y >= s.max.y - 0.001 && pos.y - s.max.y <= eps) return true;
  }
  return false;
}
