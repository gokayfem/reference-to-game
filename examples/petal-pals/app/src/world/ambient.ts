// Ambient life: drifting pollen motes and painted butterflies. Visual only — no collisions or rules.
import * as THREE from 'three';
import { groundHeight, inWater } from './layout';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const WING_COLORS = [['#f6f0dc', '#e9c46a'], ['#f4b6c2', '#e8879d'], ['#fbe08a', '#f2a93b'], ['#bcd8f2', '#6fa8d8']];

export class Ambient {
  private pollen: THREE.Points;
  private pPos: Float32Array; private pVel: Float32Array;
  private flies: { m: THREE.Mesh; home: THREE.Vector3; ph: number; r: number; sp: number }[] = [];
  private center = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const N = 260;
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.pPos.set([(Math.random() - 0.5) * 36, Math.random() * 5, (Math.random() - 0.5) * 36], i * 3); this.pVel.set([0.2 + Math.random() * 0.25, (Math.random() - 0.5) * 0.08, -0.1 + Math.random() * 0.2], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const dot = canvasTex(32, 32, c => { const gr = c.createRadialGradient(16, 16, 0, 16, 16, 15); gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.4, 'rgba(255,240,190,0.6)'); gr.addColorStop(1, 'rgba(255,240,190,0)'); c.fillStyle = gr; c.fillRect(0, 0, 32, 32); });
    this.pollen = new THREE.Points(g, new THREE.PointsMaterial({ map: dot, size: 0.11, transparent: true, opacity: 0.75, depthWrite: false, sizeAttenuation: true, fog: true }));
    this.pollen.frustumCulled = false; this.pollen.renderOrder = 7;
    scene.add(this.pollen);
    // butterflies: one painted wing-pair texture per colour, flap by scaling X
    const geo = new THREE.PlaneGeometry(0.34, 0.26);
    for (let i = 0; i < 9; i++) {
      const [a, b] = WING_COLORS[i % WING_COLORS.length];
      const tex = canvasTex(64, 48, c => {
        c.fillStyle = a; c.strokeStyle = 'rgba(110,80,50,0.7)'; c.lineWidth = 1.5;
        for (const s of [-1, 1]) {
          c.beginPath(); c.ellipse(32 + s * 13, 17, 13, 11, s * 0.5, 0, 7); c.fill(); c.stroke();
          c.fillStyle = b; c.beginPath(); c.ellipse(32 + s * 10, 34, 8, 8, s * -0.4, 0, 7); c.fill(); c.stroke(); c.fillStyle = a;
        }
        c.fillStyle = '#6b4a2e'; c.fillRect(30.5, 10, 3, 28);
      });
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: false, fog: true }));
      m.renderOrder = 7; scene.add(m);
      this.flies.push({ m, home: new THREE.Vector3(), ph: Math.random() * 10, r: 1.2 + Math.random() * 1.8, sp: 0.5 + Math.random() * 0.5 });
    }
  }

  update(time: number, dt: number, focus: THREE.Vector3, camYaw: number, visible: boolean) {
    this.pollen.visible = visible;
    this.center.lerp(focus, 0.05);
    const p = this.pPos;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += (this.pVel[i] + Math.sin(time * 0.7 + i) * 0.1) * dt; p[i + 1] += (this.pVel[i + 1] + Math.sin(time * 1.1 + i * 0.3) * 0.05) * dt; p[i + 2] += this.pVel[i + 2] * dt;
      // wrap around the player so motes are always nearby
      for (const k of [0, 2]) { const c = k === 0 ? focus.x : focus.z; if (p[i + k] - c > 18) p[i + k] -= 36; if (p[i + k] - c < -18) p[i + k] += 36; }
      const gy = groundHeight(p[i], p[i + 2]);
      if (p[i + 1] < gy + 0.2 || p[i + 1] > gy + 5) p[i + 1] = gy + 0.4 + Math.random() * 3;
    }
    (this.pollen.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    for (const f of this.flies) {
      if (f.home.distanceToSquared(focus) > 22 * 22 || f.home.lengthSq() === 0) {
        // respawn ahead of the player over meadow, never over water
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 12;
          const x = focus.x + Math.sin(a) * d, z = focus.z + Math.cos(a) * d - 3;
          if (!inWater(x, z)) { f.home.set(x, groundHeight(x, z) + 0.6, z); break; }
        }
      }
      const t = time * f.sp + f.ph;
      const x = f.home.x + Math.sin(t) * f.r + Math.sin(t * 2.3) * 0.4, z = f.home.z + Math.cos(t * 0.8) * f.r;
      const y = groundHeight(x, z) + 0.5 + Math.abs(Math.sin(t * 1.7)) * 0.7;
      f.m.position.set(x, y, z);
      f.m.rotation.set(0, camYaw, Math.sin(t * 3) * 0.3);
      f.m.scale.x = 0.25 + Math.abs(Math.sin(time * 15 + f.ph)) * 0.85; // flap
      f.m.visible = visible;
    }
  }
}
