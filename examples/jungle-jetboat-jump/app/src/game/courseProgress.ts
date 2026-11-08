import { CatmullRomCurve3, Vector3 } from 'three';
import world from '../data/world.json';

/** Sampled river course: centerline arc-length table, tangent frame, width and water height. */
export interface CourseSample {
  x: number; z: number;
  tx: number; tz: number; // unit tangent (downstream)
  rx: number; rz: number; // unit right vector (lateral +)
  halfWidth: number;
  waterY: number;
}

export interface Projection { s: number; lateral: number; index: number }

export const STEP = 1; // metres between samples

export interface JumpLayout {
  rampEndS: number; rampLength: number; rampHeight: number; rampHalfWidth: number;
  gapEndS: number; landStartS: number; landEndS: number; landHalfWidth: number; dropHeight: number;
  /** world-space landing ellipse on the straight launch line */
  landX: number; landZ: number; landTx: number; landTz: number; landHalfLength: number;
}

export class Course {
  readonly samples: CourseSample[] = [];
  readonly length: number;
  readonly jump: JumpLayout;
  readonly rapidSteps: number[] = [];

  constructor() {
    const pts = world.route.map(p => new Vector3(p.position[0], 0, p.position[2]));
    const widths = world.route.map(p => p.halfWidth);
    const curve = new CatmullRomCurve3(pts, false, 'centripetal');
    // dense param samples for arc length
    const N = 4000;
    const dense: { p: Vector3; t: number; acc: number }[] = [];
    let acc = 0; let prev = curve.getPoint(0);
    for (let i = 0; i <= N; i++) {
      const t = i / N; const p = curve.getPoint(t);
      if (i > 0) acc += p.distanceTo(prev);
      dense.push({ p, t, acc }); prev = p;
    }
    this.length = Math.floor(acc);
    // width interpolation by control-point param position (approximate using nearest dense index of each control point)
    const ctrlS: number[] = pts.map(cp => {
      let best = 0, bd = Infinity;
      for (const d of dense) { const dd = d.p.distanceToSquared(cp); if (dd < bd) { bd = dd; best = d.acc; } }
      return best;
    });
    const widthAt = (s: number) => {
      for (let i = 0; i < ctrlS.length - 1; i++) {
        if (s <= ctrlS[i + 1]) {
          const k = (s - ctrlS[i]) / Math.max(1e-6, ctrlS[i + 1] - ctrlS[i]);
          const e = k * k * (3 - 2 * k);
          return widths[i] + (widths[i + 1] - widths[i]) * e;
        }
      }
      return widths[widths.length - 1];
    };
    const L = this.length;
    const j = world.jump;
    const rampEndS = Math.round(j.rampU * L);
    this.jump = {
      rampEndS, rampLength: 9, rampHeight: 1.7, rampHalfWidth: 4.2,
      gapEndS: rampEndS + j.gapMeters + 2,
      landStartS: rampEndS + 11, landEndS: rampEndS + 28, landHalfWidth: j.landingHalfWidth,
      dropHeight: 2.6,
      landX: 0, landZ: 0, landTx: 0, landTz: 1, landHalfLength: 10.5,
    };
    // rapid steps inside the "Rapid steps" zone
    const rz = world.zones.find(z => z.name === 'Rapid steps')!.uRange;
    for (let k = 1; k <= 3; k++) this.rapidSteps.push(Math.round((rz[0] + (rz[1] - rz[0]) * (k / 4)) * L));
    let di = 0;
    for (let s = 0; s <= L; s += STEP) {
      while (di < dense.length - 2 && dense[di + 1].acc < s) di++;
      const a = dense[di], b = dense[di + 1];
      const k = (s - a.acc) / Math.max(1e-6, b.acc - a.acc);
      const t = a.t + (b.t - a.t) * k;
      const p = curve.getPoint(t); const tan = curve.getTangent(t);
      tan.y = 0; tan.normalize();
      // Right-handed, Y-up: right = forward x up = (-tz, 0, tx). For forward +Z, right is -X.
      this.samples.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z, rx: -tan.z, rz: tan.x, halfWidth: widthAt(s), waterY: this.baseWaterY(s) });
    }
    // landing target: ~17 m along the ramp's launch direction (range of a 13-14 m/s launch at 6.5 m/s up, 14 m/s^2)
    const lip = this.sampleAt(this.jump.rampEndS);
    this.jump.landTx = lip.tx; this.jump.landTz = lip.tz;
    this.jump.landX = lip.x + lip.tx * 20.5; this.jump.landZ = lip.z + lip.tz * 20.5;
  }

  /** Water level: flat pool, three small rapid steps, and the canyon-leap drop across the gap. */
  baseWaterY(s: number): number {
    let y = 0;
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    for (const st of this.rapidSteps) y -= 0.4 * smooth((s - (st - 5)) / 10);
    const j = this.jump;
    y -= j.dropHeight * smooth((s - (j.rampEndS + 1)) / (j.gapEndS - j.rampEndS - 2));
    return y;
  }

  sampleAt(s: number): CourseSample {
    const c = Math.max(0, Math.min(this.length, s));
    const i = Math.min(this.samples.length - 2, Math.floor(c / STEP));
    const a = this.samples[i], b = this.samples[i + 1];
    const k = (c - i * STEP) / STEP;
    const tx = a.tx + (b.tx - a.tx) * k, tz = a.tz + (b.tz - a.tz) * k;
    const n = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k,
      tx: tx / n, tz: tz / n, rx: -tz / n, rz: tx / n,
      halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * k,
      waterY: a.waterY + (b.waterY - a.waterY) * k,
    };
  }

  /** World position of (s, lateral). */
  toWorld(s: number, lateral: number, out = new Vector3()): Vector3 {
    const c = this.sampleAt(s);
    return out.set(c.x + c.rx * lateral, c.waterY, c.z + c.rz * lateral);
  }

  /** Nearest centerline projection searched in a local window around a previous index. */
  project(x: number, z: number, hintIndex: number, window = 30): Projection {
    const n = this.samples.length;
    const lo = Math.max(0, hintIndex - window), hi = Math.min(n - 2, hintIndex + window);
    let best = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    // refine on adjacent segments
    let bestS = best * STEP, bestD = Infinity, bestLat = 0;
    for (const i of [best - 1, best]) {
      if (i < 0 || i >= n - 1) continue;
      const a = this.samples[i], b = this.samples[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z; const len2 = ex * ex + ez * ez;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / len2; t = Math.max(0, Math.min(1, t));
      const px = a.x + ex * t, pz = a.z + ez * t; const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) {
        bestD = d; bestS = (i + t) * STEP;
        const rx = a.rx + (b.rx - a.rx) * t, rz = a.rz + (b.rz - a.rz) * t;
        bestLat = (x - px) * rx + (z - pz) * rz;
      }
    }
    return { s: bestS, lateral: bestLat, index: Math.round(bestS / STEP) };
  }

  zoneAt(s: number): string {
    const u = s / this.length;
    for (const z of world.zones) if (u >= z.uRange[0] && u < z.uRange[1]) return z.name;
    return world.zones[world.zones.length - 1].name;
  }
}

let shared: Course | null = null;
export const getCourse = () => (shared ??= new Course());
