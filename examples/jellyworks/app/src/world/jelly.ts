import * as THREE from 'three';

/**
 * Visual-only jelly dynamics. Each candy ID gets damped springs for squash/stretch, inertial lean and a
 * "pop" scale. Inputs are the candy's rendered path (from the simulation), so the wobble follows the
 * rules but never feeds back into them.
 */
interface Body {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  s: number; sv: number;       // squash (+ flatter, - taller)
  lx: number; lz: number;      // lean of the top (world xz)
  lvx: number; lvz: number;
  pop: number; popv: number;   // overall scale spring toward 1
  kind: string;
  seen: number;
  phase: number;
}

export interface JellyOpts { blocked?: boolean; ext?: number; scale?: number; noLean?: boolean }

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3();
const TQ = new THREE.Quaternion();

export class JellyField {
  private bodies = new Map<number, Body>();
  private frame = 0;
  private dt = 1 / 60;
  private tmpV = new THREE.Vector3();

  begin(dt: number) { this.frame++; this.dt = Math.min(Math.max(dt, 1 / 240), 1 / 20); }

  /** Kick a body (e.g. landing, press release). */
  impulse(id: number, squash: number, pop = 0) {
    const b = this.bodies.get(id);
    if (b) { b.sv += squash; b.popv += pop; }
  }

  /** Advance the body for `id` at `pos` and write its scale/rotation into the outputs. */
  step(id: number, kind: string, pos: THREE.Vector3, yaw: number, t: number, outQ: THREE.Quaternion, outS: THREE.Vector3, o: JellyOpts = {}) {
    const dt = this.dt;
    let b = this.bodies.get(id);
    if (!b) {
      b = { pos: pos.clone(), vel: new THREE.Vector3(), s: 0, sv: 0, lx: 0, lz: 0, lvx: 0, lvz: 0, pop: 0.25, popv: 3, kind, seen: this.frame, phase: (id * 2.399) % 6.28 };
      this.bodies.set(id, b);
    }
    if (b.seen < this.frame - 3) { b.pos.copy(pos); b.vel.set(0, 0, 0); } // reappeared elsewhere: no fake velocity
    if (b.kind !== kind) { b.kind = kind; b.pop = 0.55; b.popv = 5.5; b.sv -= 2.5; } // transformed product: squeeze + pop
    b.seen = this.frame;
    // velocity / acceleration from the rendered path
    const nv = this.tmpV.copy(pos).sub(b.pos).divideScalar(dt);
    const ax = (nv.x - b.vel.x) / dt, az = (nv.z - b.vel.z) / dt, ay = (nv.y - b.vel.y) / dt;
    const prevSpeed = Math.hypot(b.vel.x, b.vel.z);
    b.vel.lerp(nv, 0.5);
    b.pos.copy(pos);
    const speed = Math.hypot(b.vel.x, b.vel.z);
    // sudden stop (reached a blocked belt end / machine mouth) -> forward squish
    if (prevSpeed - speed > 0.5) b.sv += Math.min(4, (prevSpeed - speed) * 2.2);
    // landing from a vertical drop -> flatten
    if (ay > 60) b.sv += Math.min(5, ay * 0.02);
    // queued candy gets nudged by the belt pushing underneath
    if (o.blocked && Math.random() < dt * 2.2) b.sv += 0.9 + Math.random() * 0.8;

    // lean: top lags behind acceleration (inertia), springs back
    const tx = THREE.MathUtils.clamp(-ax * 0.0035, -0.45, 0.45), tz = THREE.MathUtils.clamp(-az * 0.0035, -0.45, 0.45);
    const kL = 140, cL = 9;
    b.lvx += (kL * ((o.noLean ? 0 : tx) - b.lx) - cL * b.lvx) * dt;
    b.lvz += (kL * ((o.noLean ? 0 : tz) - b.lz) - cL * b.lvz) * dt;
    b.lx += b.lvx * dt; b.lz += b.lvz * dt;
    // squash: rest slightly stretched while travelling, wobbly spring
    const target = -Math.min(speed * 0.035, 0.06) + (o.ext ?? 0);
    const kS = 170, cS = 6.5;
    b.sv += (kS * (target - b.s) - cS * b.sv) * dt;
    b.s = THREE.MathUtils.clamp(b.s + b.sv * dt, -0.45, 0.6);
    // pop
    b.popv += (220 * (1 - b.pop) - 11 * b.popv) * dt;
    b.pop += b.popv * dt;
    // idle breathing so resting gummies never look like rigid plastic
    const breathe = Math.sin(t * 5.2 + b.phase) * 0.025;
    const sq = b.s + breathe;
    const k = (o.scale ?? 1) * Math.max(0.05, b.pop);
    outS.set(k * (1 + sq * 0.55), k * (1 - sq), k * (1 + sq * 0.55));
    outQ.setFromAxisAngle(UP, yaw);
    const lean = Math.hypot(b.lx, b.lz);
    if (lean > 1e-4) {
      AX.set(b.lz, 0, -b.lx).normalize();
      TQ.setFromAxisAngle(AX, lean);
      outQ.premultiply(TQ);
    }
  }

  /** Drop bodies not rendered for a while (delivered/consumed). */
  end() {
    for (const [id, b] of this.bodies) if (b.seen < this.frame - 120) this.bodies.delete(id);
  }

  clear() { this.bodies.clear(); }
}
