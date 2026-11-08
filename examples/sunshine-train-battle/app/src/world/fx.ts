// Visual-only effects. No collision or rule logic here.
import * as THREE from 'three';
import type { Bolt } from '../game/game';
import type { Loot } from '../game/rules';
import { glowSprite } from './materials';

const MAX_BOLTS = 64;

export class Fx {
  private boltBeams: THREE.InstancedMesh;
  private boltCores: THREE.InstancedMesh;
  private enemyOrbs: THREE.InstancedMesh;
  private enemyGlow: THREE.Sprite[] = [];
  private sparks: THREE.Points;
  private sparkData: { v: THREE.Vector3; life: number; max: number }[] = [];
  private sparkPos: Float32Array; private sparkCol: Float32Array;
  private ripples: { m: THREE.Mesh; life: number }[] = [];
  private lootMeshes = new Map<string, THREE.Object3D>();
  private crystalGeo = new THREE.OctahedronGeometry(0.2, 0);
  private mats = {
    blue: new THREE.MeshStandardMaterial({ color: '#2d8cff', emissive: '#0a4fd0', emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, flatShading: true }),
    orange: new THREE.MeshStandardMaterial({ color: '#ff7a1c', emissive: '#d84400', emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, flatShading: true }),
    cellBody: new THREE.MeshStandardMaterial({ color: '#efe6dc', roughness: 0.4 }),
    cellGlow: new THREE.MeshBasicMaterial({ color: '#59fff0' }),
  };
  private glowTexCyan = glowSprite('rgba(80,240,255,0.8)');
  private glowTexOrange = glowSprite('rgba(255,140,40,0.85)');
  private tmp = new THREE.Matrix4(); private q = new THREE.Quaternion(); private up = new THREE.Vector3(0, 1, 0);
  private sparkCursor = 0;

  constructor(private root: THREE.Object3D) {
    const beamMat = new THREE.MeshBasicMaterial({ color: '#4ff6ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.boltBeams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.012, 1, 8, 1, true).translate(0, -0.5, 0), beamMat, MAX_BOLTS);
    this.boltCores = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: '#e8ffff' }), MAX_BOLTS);
    this.enemyOrbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffb066' }), MAX_BOLTS);
    for (const m of [this.boltBeams, this.boltCores, this.enemyOrbs]) { m.count = 0; m.frustumCulled = false; root.add(m); }
    for (let i = 0; i < 24; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexOrange, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ff7a3a' })); s.scale.setScalar(0.7); s.visible = false; this.enemyGlow.push(s); root.add(s); }
    const N = 400;
    this.sparkPos = new Float32Array(N * 3); this.sparkCol = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.sparkData.push({ v: new THREE.Vector3(), life: 0, max: 1 }); this.sparkPos[i * 3 + 1] = -999; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, map: glowSprite('rgba(255,255,255,0.9)'), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false; root.add(this.sparks);
  }

  burst(x: number, y: number, z: number, color: string, n = 14, speed = 4) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.sparkCursor = (this.sparkCursor + 1) % this.sparkData.length;
      const d = this.sparkData[i];
      d.v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      d.life = d.max = 0.25 + Math.random() * 0.3;
      this.sparkPos.set([x, y, z], i * 3); this.sparkCol.set([c.r, c.g, c.b], i * 3);
    }
  }

  ripple(x: number, y: number, z: number, faceTo: THREE.Vector3) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 32), new THREE.MeshBasicMaterial({ color: '#7ff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z); m.lookAt(faceTo); this.root.add(m); this.ripples.push({ m, life: 0.35 });
  }

  syncBolts(bolts: Bolt[], alpha: number) {
    let nb = 0, ne = 0;
    const pos = new THREE.Vector3(), dir = new THREE.Vector3(), scl = new THREE.Vector3();
    this.enemyGlow.forEach((s) => (s.visible = false));
    for (const b of bolts) {
      pos.set(b.px + (b.x - b.px) * alpha, b.py + (b.y - b.py) * alpha, b.pz + (b.z - b.pz) * alpha);
      if (b.owner === 'player' && nb < MAX_BOLTS) {
        dir.set(b.vx, b.vy, b.vz).normalize();
        const travelled = (2 - b.life) * 45;
        const len = Math.min(2.4, Math.max(0.3, travelled));
        // geometry spans local y in [-1,0]; mapping +y to dir puts the beam behind the head
        this.q.setFromUnitVectors(this.up, dir);
        scl.set(1, len, 1);
        this.tmp.compose(pos, this.q, scl); this.boltBeams.setMatrixAt(nb, this.tmp);
        this.tmp.compose(pos, this.q.identity(), scl.set(1, 1, 1)); this.boltCores.setMatrixAt(nb, this.tmp);
        nb++;
      } else if (b.owner === 'robot' && ne < MAX_BOLTS) {
        this.tmp.makeTranslation(pos.x, pos.y, pos.z); this.enemyOrbs.setMatrixAt(ne, this.tmp);
        if (ne < this.enemyGlow.length) { const s = this.enemyGlow[ne]; s.visible = true; s.position.copy(pos); }
        ne++;
      }
    }
    this.boltBeams.count = nb; this.boltCores.count = nb; this.enemyOrbs.count = ne;
    this.boltBeams.instanceMatrix.needsUpdate = this.boltCores.instanceMatrix.needsUpdate = this.enemyOrbs.instanceMatrix.needsUpdate = true;
  }

  syncLoot(loot: Loot[], t: number) {
    const seen = new Set<string>();
    for (const l of loot) {
      seen.add(l.id);
      let o = this.lootMeshes.get(l.id);
      if (!o) {
        o = new THREE.Group();
        if (l.kind === 'cell') {
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 14), this.mats.cellBody); body.rotation.z = Math.PI / 2; o.add(body);
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 14), this.mats.cellGlow); cap.rotation.z = Math.PI / 2; cap.scale.set(1, 0.4, 1); o.add(cap);
        } else {
          const c = new THREE.Mesh(this.crystalGeo, l.kind === 'blue' ? this.mats.blue : this.mats.orange); c.scale.set(1, 1.6, 1); c.castShadow = true; o.add(c);
          const c2 = new THREE.Mesh(this.crystalGeo, l.kind === 'blue' ? this.mats.blue : this.mats.orange); c2.scale.set(0.45, 0.8, 0.45); c2.position.set(0.15, -0.1, 0.05); c2.rotation.z = -0.5; o.add(c2);
        }
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: l.kind === 'orange' ? this.glowTexOrange : this.glowTexCyan, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }));
        glow.scale.setScalar(0.9); o.add(glow);
        this.root.add(o); this.lootMeshes.set(l.id, o);
      }
      const pop = Math.min(1, l.age * 3);
      o.position.set(l.x, l.y + Math.sin(t * 3 + l.x * 5) * 0.08 + (1 - pop) * 0.6, l.z);
      o.rotation.y = t * 2;
      o.scale.setScalar(0.4 + pop * 0.6);
    }
    for (const [id, o] of this.lootMeshes) if (!seen.has(id)) { this.root.remove(o); this.lootMeshes.delete(id); }
  }

  update(dt: number) {
    const n = this.sparkData.length;
    for (let i = 0; i < n; i++) {
      const d = this.sparkData[i];
      if (d.life <= 0) continue;
      d.life -= dt; d.v.y -= 9 * dt;
      this.sparkPos[i * 3] += d.v.x * dt; this.sparkPos[i * 3 + 1] += d.v.y * dt; this.sparkPos[i * 3 + 2] += d.v.z * dt;
      if (d.life <= 0) this.sparkPos[i * 3 + 1] = -999;
    }
    (this.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    for (const r of this.ripples) { r.life -= dt; const k = 1 - r.life / 0.35; r.m.scale.setScalar(1 + k * 5); (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life / 0.35); }
    for (const r of this.ripples) if (r.life <= 0) { this.root.remove(r.m); r.m.geometry.dispose(); (r.m.material as THREE.Material).dispose(); }
    this.ripples = this.ripples.filter((r) => r.life > 0);
  }

  reset() {
    for (const o of this.lootMeshes.values()) this.root.remove(o);
    this.lootMeshes.clear();
    for (const d of this.sparkData) d.life = 0;
    this.sparkPos.fill(-999);
  }
}
