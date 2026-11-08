// World layout: heights, river, bridges, scenery placement, walkability and navigation.
// Pure math (no Three.js) so navigation/collision can be unit-tested.
import world from '../data/world.json';

export type V2 = [number, number];
export const BOUNDS = { minX: -58, maxX: 58, minZ: -58, maxZ: 58 };
export const RIVER_HALF = world.river.halfWidth;

// ---------- deterministic RNG ----------
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- river centerline (Catmull-Rom through world.json points, extended) ----------
function catmull(p: V2[], samplesPerSeg: number): V2[] {
  const out: V2[] = [];
  const pts = [[2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]] as V2, ...p, [2 * p[p.length - 1][0] - p[p.length - 2][0], 2 * p[p.length - 1][1] - p[p.length - 2][1]] as V2];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}
const rc = world.river.centerlineXZ as V2[];
// extend river beyond the walkable bounds so it continues into the scenery
const riverCtrl: V2[] = [[rc[0][0] - 12, rc[0][1] - 60], ...rc, [rc[rc.length - 1][0] + 8, rc[rc.length - 1][1] + 30]];
export const RIVER: V2[] = catmull(riverCtrl, 40);

/** Distance from point to river centerline and the parametric position along it. */
export function riverInfo(x: number, z: number): { d: number; i: number; t: number } {
  let best = 1e9, bi = 0, bt = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    if (Math.abs(az - z) > 40 && Math.abs(bz - z) > 40) continue;
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / L; t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - x, pz = az + dz * t - z, d = px * px + pz * pz;
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: Math.sqrt(best), i: bi, t: bt };
}
/** Painted wobble on the bank so the river edge isn't a perfect ribbon. */
export function riverHalfAt(x: number, z: number) { return RIVER_HALF + Math.sin(z * 0.21 + x * 0.05) * 0.45 + Math.sin(z * 0.53) * 0.25; }

// ---------- terrain height ----------
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export function baseHeight(x: number, z: number): number {
  let h = 0.55 * Math.sin(x * 0.075 + 0.6) * Math.cos(z * 0.065) + 0.35 * Math.sin((x + z) * 0.045) + 0.18 * Math.sin(x * 0.21 - z * 0.17);
  // the meadow rises gently toward the north so the vista reads like the reference painting
  h += (45 - Math.max(-60, Math.min(45, z))) * 0.028;
  // lookout hill
  const dl = Math.hypot(x - 37, z + 34); h += 5.2 * (1 - smooth(3, 17, dl));
  // gentle orchard rise and sunflower knoll
  h += 0.9 * (1 - smooth(4, 14, Math.hypot(x + 29, z + 31)));
  h += 0.5 * (1 - smooth(2, 10, Math.hypot(x + 31, z - 4)));
  // distant scenery hills (outside walkable bounds)
  const north = Math.max(0, -z - 52); h += Math.min(north, 80) * 0.11 + Math.min(north, 40) * 0.05 * Math.sin(x * 0.045 + z * 0.02) * 2;
  const west = Math.max(0, -x - 56); h += west * 0.35 + Math.sin(z * 0.08) * Math.min(west, 10) * 0.2;
  const east = Math.max(0, x - 56); h += east * 0.3 + Math.sin(z * 0.07 + 1) * Math.min(east, 10) * 0.25;
  const south = Math.max(0, z - 60); h += south * 0.15;
  return h;
}
export function groundHeight(x: number, z: number): number {
  const b = baseHeight(x, z);
  const r = riverInfo(x, z);
  const half = riverHalfAt(x, z);
  const carve = 1.5 * (1 - smooth(half - 1.2, half + 2.2, r.d));
  return b - carve;
}
export function waterLevel(x: number, z: number): number { return baseHeight(x, z) - 0.55; }

// ---------- bridges ----------
export interface Bridge { id: string; a: V2; b: V2; width: number; len: number; dir: V2; deckA: number; deckB: number }
export const BRIDGES: Bridge[] = world.bridges.map(b => {
  const a = b.endpointsXZ[0] as V2, c = b.endpointsXZ[1] as V2;
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
  return { id: b.id, a, b: c, width: b.width, len, dir: [dx / len, dz / len] as V2, deckA: baseHeight(a[0], a[1]) + 0.05, deckB: baseHeight(c[0], c[1]) + 0.05 };
});
/** If (x,z) is on a bridge deck, returns the deck height, else null. */
export function bridgeAt(x: number, z: number): { bridge: Bridge; y: number; t: number } | null {
  for (const br of BRIDGES) {
    const px = x - br.a[0], pz = z - br.a[1];
    const along = px * br.dir[0] + pz * br.dir[1];
    const across = -px * br.dir[1] + pz * br.dir[0];
    if (along >= -0.6 && along <= br.len + 0.6 && Math.abs(across) <= br.width / 2) {
      const t = Math.max(0, Math.min(1, along / br.len));
      const y = br.deckA + (br.deckB - br.deckA) * t + Math.sin(t * Math.PI) * 0.85 + 0.12;
      return { bridge: br, y, t };
    }
  }
  return null;
}
export function surfaceHeight(x: number, z: number): number {
  const b = bridgeAt(x, z);
  const g = groundHeight(x, z);
  return b ? Math.max(b.y, g) : g;
}

// ---------- landmarks / paths ----------
export const START: V2 = [-9, 38];
export const LM: Record<string, V2> = Object.fromEntries(world.landmarks.map(l => [l.id, l.positionXZ as V2]));
LM.start = START;
for (const [k, v] of Object.entries(world.pathNodesXZ)) LM[k] = v as V2;
export const PATH_SEGMENTS: [V2, V2][] = world.paths.map(([a, b]) => [LM[a], LM[b]]);
function segDist(x: number, z: number, a: V2, b: V2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L; t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}
/** Dirt-path strength 0..1 (curvy painted path, not on bridges). */
export function pathStrength(x: number, z: number): number {
  let d = 1e9;
  const wob = Math.sin(x * 0.17 + z * 0.11) * 0.9 + Math.sin(z * 0.31) * 0.4;
  for (const [a, b] of PATH_SEGMENTS) d = Math.min(d, segDist(x + wob, z - wob * 0.5, a, b));
  // camp yard
  d = Math.min(d, Math.max(0, Math.hypot(x - 22, z - 9) - 4.5));
  return 1 - smooth(0.6, 1.6, d);
}

// ---------- habitats ----------
export const HABITAT_ZONES: { id: 'sunflowers' | 'riverbank' | 'orchard' | 'lookout'; c: V2; r: number }[] = [
  { id: 'sunflowers', c: LM.sunflowers, r: 7 },
  { id: 'riverbank', c: LM.riverbank, r: 6.5 },
  { id: 'orchard', c: LM.orchard, r: 8 },
  { id: 'lookout', c: [36, -32], r: 6 },
];

// ---------- scenery placements (sprites + colliders) ----------
export interface Placement { kind: string; x: number; z: number; h: number; collider?: number; flip?: boolean }
export const PLACEMENTS: Placement[] = [];
const P = (kind: string, x: number, z: number, h: number, collider?: number, flip?: boolean) => PLACEMENTS.push({ kind, x, z, h, collider, flip });

// start / picnic area (left foreground of the opening view, like the reference)
P('tree-apple', -19, 33, 6.0, 0.8); P('notice-board', -14.5, 30.5, 1.6, 0.45);  P('tree-apple', -40, 27, 6.2, 0.8);
for (const [x, z, s] of [[-17, 25, 2.3], [-14.5, 24, 2.5], [-12, 22.5, 2.2], [-16, 21.5, 2.4], [-19, 23, 2.2]] as const) P('sunflowers', x, z, s);
P('bush', -38, 15, 1.4, 0.9); P('tree-round', -45, 8, 6.5, 0.8); P('tree-round', -47, 30, 5.8, 0.8);
// picnic corner by the notice board (reference: blanket + basket, a little burrow mound)
P('picnic-blanket', -12.2, 27.2, 0.9); P('burrow', -16.6, 29.6, 0.8); P('map-sign', 12.6, 17.4, 1.5, 0.3);
P('berry-cluster', 27.5, 15.5, 1.1, 0.8); P('berry-cluster', 36, 12, 1.0, 0.7);
// sunflower meadow (sunflowers are walk-through)
for (const [x, z, s] of [[-34, 2, 2.6], [-31, 0.5, 2.8], [-28, 1.5, 2.5], [-25.5, 3, 2.3], [-33, 5, 2.4], [-36.5, 4, 2.6], [-29.5, -2, 2.7], [-26.5, -0.5, 2.4], [-37.5, 0, 2.5], [-24, 0.5, 2.2]] as const) P('sunflowers', x, z, s);
P('tree-poplar', -42, -6, 6.5, 0.6); P('tree-poplar', -44, -1, 7, 0.6);
// orchard trees around the fruit grid
for (const x of [-35.5, -31, -27.5, -24.5, -20.5]) { P('tree-apple', x, -37.5, 5.2, 0.7); P('tree-apple', x + 1.2, -24.6, 5.0, 0.7); }
P('tree-apple', -36, -30.5, 5.3, 0.7); P('tree-apple', -18.6, -31, 5.2, 0.7);
P('basket', -22, -27, 0.5); P('arrow-sign', -24, -21, 1.2, 0.25);
// river banks
for (const [x, z, s] of [[-3.5, 15, 1.1], [11.6, 27, 1.3], [12, 31, 0.9], [-6.8, -16, 1.0], [3.4, -12, 1.2], [8.8, 13.5, 1.0], [-12.5, -27, 1.3], [16.5, 36, 1.2], [-1.5, 3.8, 1.0], [6.5, -2, 1.1]] as const) P('boulders', x, z, s, s * 0.9);
P('cairn', 17, 26.5, 1.2, 0.5); P('arrow-sign', 15.5, 18, 1.2, 0.25); P('bench', 15.8, 29.5, 1.0, 0.8); P('tree-round', 20, 31, 6, 0.8);
// lily pads (water decals) – no collider
for (const [x, z] of [[5, 22.5], [8.5, 25], [4, 10.5], [-1.5, 8], [-6, -8], [2.5, 16], [6.8, 30]] as const) P('lilypad', x, z, 0.0);
for (const [x, z] of [[3.5, 24.5], [0.5, 11], [-7.5, -11], [9.5, 32]] as const) P('lily-flower', x, z, 0.0);
// camp
P('tent', 25, 5.5, 3.2, 2.2); P('flag', 19.5, 6.5, 2.8, 0.2); P('crates', 20.5, 3.5, 1.2, 0.8); P('easel', 28.5, 8.5, 1.6, 0.5);
P('picnic-table', 25.5, 13.5, 1.1, 1.2); P('basket', 23.5, 12.3, 0.5); P('crates', 29, 5, 1.0, 0.7);
P('berry-bush', 31, 12, 1.3, 0.9); P('berry-bush', 33.5, 8.5, 1.2, 0.8); P('bush', 30.5, 1, 1.5, 0.9); P('tree-round', 34, 2, 6.5, 0.8); P('tree-round', 31, 20, 5.8, 0.8);
// lookout
P('lookout-tower', 40.5, -37.5, 7.5, 2.3); P('bench', 34.5, -29.5, 1.0, 0.8); P('cairn', 32.5, -33.5, 1.0, 0.45); P('arrow-sign', 30, -24, 1.2, 0.25);
// village edge (scenery beyond fence)
for (let x = 28; x <= 54; x += 2.6) P('fence', x, -45, 1.0, 0.7);
P('cottage-orange', 36, -52, 5.5, 3); P('cottage-blue', 44, -54, 5.5, 3); P('cottage-orange', 52, -51, 5, 3); P('cottage-blue', 32, -57, 5, 3);
// trees along the northern / eastern edges and meadow
for (const [k, x, z, s] of [['tree-round', -18, -47, 6.5], ['tree-poplar', -4, -50, 7], ['tree-round', 8, -44, 6.2], ['tree-round', 20, -40, 6], ['tree-poplar', 14, -52, 7.5], ['tree-round', 50, -20, 6.5], ['tree-poplar', 52, -8, 7], ['tree-round', 48, 18, 6], ['tree-round', 46, 34, 6.5], ['tree-poplar', -50, -24, 7], ['tree-round', -48, -40, 6], ['tree-round', 28, 44, 6], ['tree-round', -18, 46, 6], ['tree-poplar', -8, 50, 7]] as const) P(k, x, z, s, 0.8);
for (const [x, z] of [[-14, 30], [-20, 10], [0, 39], [36, 26], [-1, -31], [14, -26], [26, -10], [-40, -14]] as const) P('bush', x, z, 1.3, 0.8);
P('berry-bush', -16, -10, 1.2, 0.8); P('berry-bush', 40, -18, 1.2, 0.8);
// scenic trees on the lookout hill and the eastern slopes (beyond the walkable edge where x > 58)
for (const [k, x, z, s] of [['tree-round', 44, -28, 6], ['tree-poplar', 46, -40, 7], ['tree-round', 30, -40, 5.5], ['tree-round', 64, -10, 7], ['tree-poplar', 66, 4, 8], ['tree-round', 68, -24, 7], ['tree-round', 70, 18, 7.5], ['tree-poplar', 62, -36, 8]] as const) P(k, x, z, s, 0.8);

export const COLLIDERS = PLACEMENTS.filter(p => p.collider).map(p => ({ x: p.x, z: p.z, r: p.collider!, h: p.h }));

// shallow water marked for Bubble (the stretch between the bridges, lily pads mark it)
export function inShallows(x: number, z: number) { return z > -25 && z < 34; }

export type Walker = 'explorer' | 'land' | 'bubble';
/** Core walkability (no agent radius). */
export function walkable(x: number, z: number, who: Walker, radius = 0.3): boolean {
  if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return false;
  if (z < -44 && x > 26) return false; // village fence line
  const onBridge = bridgeAt(x, z) !== null;
  if (!onBridge) {
    const r = riverInfo(x, z);
    const half = riverHalfAt(x, z);
    if (r.d < half - 0.2 + radius) {
      if (!(who === 'bubble' && inShallows(x, z))) return false;
    }
  }
  for (const c of COLLIDERS) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < (c.r + radius) * (c.r + radius)) return false; }
  if (onBridge) {
    // bridge rails: cannot step off the side over water
    return true;
  }
  return true;
}
export function inWater(x: number, z: number) { if (bridgeAt(x, z)) return false; const r = riverInfo(x, z); return r.d < riverHalfAt(x, z) - 0.2; }

// ---------- navigation grid + A* ----------
export const CELL = 0.5;
const GW = Math.round((BOUNDS.maxX - BOUNDS.minX) / CELL), GH = Math.round((BOUNDS.maxZ - BOUNDS.minZ) / CELL);
export class NavGrid {
  readonly w = GW; readonly h = GH; readonly cells: Uint8Array;
  constructor(public who: Walker, radius = 0.25) {
    this.cells = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const [x, z] = this.toWorld(i, j);
      this.cells[j * GW + i] = walkable(x, z, who, radius) ? 1 : 0;
    }
  }
  toWorld(i: number, j: number): V2 { return [BOUNDS.minX + (i + 0.5) * CELL, BOUNDS.minZ + (j + 0.5) * CELL]; }
  toCell(x: number, z: number): V2 { return [Math.floor((x - BOUNDS.minX) / CELL), Math.floor((z - BOUNDS.minZ) / CELL)]; }
  ok(i: number, j: number) { return i >= 0 && j >= 0 && i < GW && j < GH && this.cells[j * GW + i] === 1; }
  okWorld(x: number, z: number) { const [i, j] = this.toCell(x, z); return this.ok(i, j); }
  nearestOpen(x: number, z: number, maxR = 12): V2 | null {
    const [ci, cj] = this.toCell(x, z);
    for (let r = 0; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.ok(ci + di, cj + dj)) return this.toWorld(ci + di, cj + dj);
    }
    return null;
  }
  lineClear(ax: number, az: number, bx: number, bz: number) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.5));
    for (let k = 0; k <= n; k++) { const t = k / Math.max(1, n); if (!this.okWorld(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }
  /** A* with 8-neighbour moves; returns smoothed world waypoints or null. */
  findPath(ax: number, az: number, bx: number, bz: number, maxNodes = 30000): V2[] | null {
    let [si, sj] = this.toCell(ax, az);
    if (!this.ok(si, sj)) { const n = this.nearestOpen(ax, az, 4); if (!n) return null; [si, sj] = this.toCell(n[0], n[1]); }
    let [ti, tj] = this.toCell(bx, bz);
    if (!this.ok(ti, tj)) { const n = this.nearestOpen(bx, bz, 10); if (!n) return null; [ti, tj] = this.toCell(n[0], n[1]); }
    const N = GW * GH, start = sj * GW + si, goal = tj * GW + ti;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap: number[] = [], f: number[] = [];
    const push = (n: number, fv: number) => { heap.push(n); f.push(fv); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (f[p] <= f[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [f[p], f[i]] = [f[i], f[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const lh = heap.pop()!, lf = f.pop()!; if (heap.length) { heap[0] = lh; f[0] = lf; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && f[l] < f[m]) m = l; if (r < heap.length && f[r] < f[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [f[m], f[i]] = [f[i], f[m]]; i = m; } } return top; };
    const hfn = (n: number) => { const i = n % GW, j = (n / GW) | 0; const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    g[start] = 0; push(start, hfn(start));
    let expanded = 0;
    while (heap.length) {
      const cur = pop();
      if (cur === goal) break;
      if (closed[cur]) continue; closed[cur] = 1;
      if (++expanded > maxNodes) return null;
      const ci = cur % GW, cj = (cur / GW) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(ci + di, cj) || !this.ok(ci, cj + dj))) continue;
        const n = nj * GW + ni, ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[n]) { g[n] = ng; came[n] = cur; push(n, ng + hfn(n)); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const cells: V2[] = []; for (let n = goal; n !== -1; n = came[n]) { cells.push(this.toWorld(n % GW, (n / GW) | 0)); if (n === start) break; }
    cells.reverse();
    // string-pull smoothing
    const out: V2[] = [];
    let anchor: V2 = [ax, az];
    for (let k = 1; k < cells.length; k++) {
      if (!this.lineClear(anchor[0], anchor[1], cells[k][0], cells[k][1])) { out.push(cells[k - 1]); anchor = cells[k - 1]; }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}
