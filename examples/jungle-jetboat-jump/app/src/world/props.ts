import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Session } from '../game/session';
import { frameAt } from './river';
import { boulderGeometry, boulderMaterial, chamferBlock, sandstoneMaterial, CliffModule } from './canyon';
import type { MeshKit } from './vegetation';
import { PAL } from './palette';
import { FoliageCardBuilder } from './foliageCards';
import { rng } from '../core/rng';

const tint = (g: THREE.BufferGeometry, c: string | THREE.Color) => {
  const cc = new THREE.Color(c); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
};
const strip = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return g; };

function stripeTexture(a: string, b: string, n = 6, diagonal = true) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 256, 128);
  g.fillStyle = b;
  for (let i = -n; i < n * 2; i++) {
    g.beginPath();
    const w = 256 / n;
    g.moveTo(i * w, 0); g.lineTo(i * w + w / 2, 0); g.lineTo(i * w + w / 2 + (diagonal ? 64 : 0), 128); g.lineTo(i * w + (diagonal ? 64 : 0), 128);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function chevronTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, 'rgba(120,240,255,0.0)'); gr.addColorStop(0.25, 'rgba(120,240,255,0.35)'); gr.addColorStop(1, 'rgba(60,200,255,0.55)');
  g.fillStyle = gr; g.fillRect(8, 0, 240, 512);
  g.strokeStyle = 'rgba(220,255,255,0.95)'; g.lineWidth = 6; g.strokeRect(10, 4, 236, 504);
  g.lineWidth = 26; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(240,255,255,1)';
  for (const y of [190, 290]) { g.beginPath(); g.moveTo(60, y + 60); g.lineTo(128, y); g.lineTo(196, y + 60); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function textTexture(text: string, bg: string, fg: string, w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#7a3b16'; g.lineWidth = 18; g.strokeRect(9, 9, w - 18, h - 18);
  g.font = `900 ${Math.round(h * 0.62)}px Nunito, "Arial Rounded MT Bold", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 16; g.strokeStyle = '#8a2f12'; g.strokeText(text, w / 2, h / 2 + 8);
  g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export interface Props {
  group: THREE.Group;
  update(t: number, s: Session, dt: number): void;
  reset(s: Session): void;
  popToken(id: string): void;
}

export function buildProps(session: Session, foliageTex: THREE.Texture, cliffKit: CliffModule[] = [], rockKit: MeshKit[] = [], seed = 1): Props {
  const course = session.course;
  const group = new THREE.Group();
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true });
  const r = rng(seed * 31 + 99);

  // ---------- buoy gates ----------
  const bannerTex = stripeTexture('#2fae4a', '#f2d23a', 5);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide, roughness: 0.7 });
  const chevMat = new THREE.MeshBasicMaterial({ map: chevronTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending, fog: false });
  const buoyParts = [
    tint(strip(new THREE.CylinderGeometry(0.85, 1.0, 0.7, 14).translate(0, 0.05, 0)), '#21a3a6'),
    tint(strip(new THREE.TorusGeometry(0.9, 0.12, 6, 18).rotateX(Math.PI / 2).translate(0, 0.38, 0)), '#f4efe2'),
    tint(strip(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6).translate(-0.45, 1.6, 0)), '#e9e3d4'),
    tint(strip(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6).translate(0.45, 1.6, 0)), '#e9e3d4'),
  ];
  const buoyGeo = mergeGeometries(buoyParts)!; buoyGeo.computeVertexNormals();
  const bannerGeo = new THREE.PlaneGeometry(1.05, 0.75).translate(0, 2.45, 0);
  const gateObjs: { chev: THREE.Mesh; banners: THREE.Mesh[]; bobs: THREE.Object3D[] }[] = [];
  const passedBanner = new THREE.MeshStandardMaterial({ map: stripeTexture('#7fd6ff', '#ffffff', 5), side: THREE.DoubleSide, roughness: 0.7 });
  for (const g of session.gates) {
    const fr = frameAt(course, g.s);
    const yaw = Math.atan2(fr.tx, fr.tz);
    const bobs: THREE.Object3D[] = []; const banners: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const b = new THREE.Group();
      const lat = side * (g.halfWidth + 0.6);
      b.position.set(fr.x + fr.rx * lat, fr.y, fr.z + fr.rz * lat);
      b.rotation.y = yaw + Math.PI / 2;
      const mesh = new THREE.Mesh(buoyGeo, vmat); mesh.castShadow = true; b.add(mesh);
      const ban = new THREE.Mesh(bannerGeo, bannerMat); b.add(ban); banners.push(ban);
      group.add(b); bobs.push(b);
    }
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 6.4), chevMat);
    chev.position.set(fr.x, fr.y + 4.2, fr.z); chev.rotation.y = yaw;
    chev.renderOrder = 5;
    group.add(chev);
    gateObjs.push({ chev, banners, bobs });
  }

  // ---------- sun tokens (instanced) ----------
  const disc = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 20).rotateX(Math.PI / 2);
  const rays: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const c = new THREE.ConeGeometry(0.13, 0.32, 4).translate(0, 0.66, 0).rotateZ((i / 10) * Math.PI * 2);
    rays.push(c.scale(1, 1, 0.5));
  }
  const rayGeo = mergeGeometries(rays)!;
  const sunMat = new THREE.MeshStandardMaterial({ color: PAL.sun, emissive: new THREE.Color('#ff9d00'), emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 });
  const discMat = new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.15 });
  const N = session.tokens.length;
  const discI = new THREE.InstancedMesh(disc, discMat, N);
  const rayI = new THREE.InstancedMesh(rayGeo, sunMat, N);
  discI.frustumCulled = false; rayI.frustumCulled = false;
  group.add(discI, rayI);
  // glow sprites
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,230,140,0.55)'); gr.addColorStop(0.4, 'rgba(255,200,60,0.18)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glows = session.tokens.map(t => { const s = new THREE.Sprite(glowMat); s.scale.setScalar(1.9); s.position.set(t.x, t.y, t.z); group.add(s); return s; });
  const popAnim = new Map<string, number>();
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tv = new THREE.Vector3(), ts = new THREE.Vector3();

  // ---------- slalom rocks (match session collision circles) ----------
  const rockMat = boulderMaterial(); rockMat.color.set('#9a98a2'); rockMat.emissive.set('#3a3a46');
  const rockGeo = boulderGeometry(21);
  const rockCards = new FoliageCardBuilder();
  for (const rk of session.rocks) {
    const fr = frameAt(course, rk.s);
    // fal boulder (footprint normalised to 1 m) scaled so its footprint matches the collision circle
    const kit = rockKit.length ? rockKit[Math.floor(r() * Math.min(2, rockKit.length))] : null;
    const m = kit ? new THREE.Mesh(kit.geometry, kit.material) : new THREE.Mesh(rockGeo, rockMat);
    if (kit) { m.position.set(rk.x, fr.y - 0.5, rk.z); m.scale.set(rk.radius * 2.15, rk.radius * 2.3, rk.radius * 2.15); }
    else { m.position.set(rk.x, fr.y - 0.4, rk.z); m.scale.set(rk.radius, rk.radius * 1.15, rk.radius); }
    m.rotation.y = r() * 6; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    // fern / flower tuft on top like the reference islands (painted foliage cards)
    rockCards.add((['fern', 'flowerbush', 'hibiscus', 'bougainvillea', 'fernflower'] as const)[Math.floor(r() * 5)], rk.x, fr.y + rk.radius * 0.95, rk.z, 0.8 + rk.radius * 0.25, null, 0.95);
    rockCards.add(r() < 0.5 ? 'broadleaf' : 'elephantear', rk.x + (r() - 0.5) * rk.radius, fr.y + rk.radius * 0.7, rk.z + (r() - 0.5) * rk.radius, 0.7 + rk.radius * 0.2, null, 0.9);
  }
  group.add(rockCards.build(foliageTex));

  // ---------- canyon leap: ramp, funnel walls, cascade boulders, landing ring ----------
  const j = course.jump;
  const rampGroup = new THREE.Group();
  const woodTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d')!;
    const cols = ['#b07a46', '#9c6a3c', '#a87444', '#946238'];
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[i % 4]; g.fillRect(0, i * 32, 256, 32);
      g.fillStyle = 'rgba(60,35,15,0.55)'; g.fillRect(0, i * 32, 256, 3);
      g.strokeStyle = 'rgba(70,40,18,0.25)'; g.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { g.beginPath(); const y = i * 32 + 8 + k * 6 + r() * 3; g.moveTo(0, y); g.bezierCurveTo(80, y + r() * 4 - 2, 170, y + r() * 4 - 2, 256, y); g.stroke(); }
      g.fillStyle = 'rgba(40,25,10,0.7)'; for (const x of [24, 232]) { g.beginPath(); g.arc(x, i * 32 + 16, 3, 0, 7); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const plankMat = new THREE.MeshStandardMaterial({ map: woodTex, color: '#ffffff', roughness: 0.85 });
  const darkWood = new THREE.MeshStandardMaterial({ map: woodTex, color: '#c9a88a', roughness: 0.9 });
  const sideMat = new THREE.MeshStandardMaterial({ map: stripeTexture('#e8572a', '#f6efe0', 8, false), roughness: 0.7 });
  const nPl = 10;
  for (let i = 0; i < nPl; i++) {
    const s = j.rampEndS - j.rampLength + (i + 0.5) * (j.rampLength / nPl);
    const fr = frameAt(course, s);
    const h = session.rampHeightAt(s, 0);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(j.rampHalfWidth * 2, 0.18, j.rampLength / nPl * 0.94), i % 2 ? plankMat : darkWood);
    pl.position.set(fr.x, fr.y + h - 0.05, fr.z);
    pl.rotation.set(0, Math.atan2(fr.tx, fr.tz), 0);
    pl.rotateX(-Math.atan2(j.rampHeight, j.rampLength));
    pl.castShadow = true; pl.receiveShadow = true;
    rampGroup.add(pl);
    for (const side of [-1, 1]) {
      const lat = side * (j.rampHalfWidth + 0.15);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, h + 0.9, j.rampLength / nPl), sideMat);
      rail.position.set(fr.x + fr.rx * lat, fr.y + (h + 0.9) / 2 - 0.4, fr.z + fr.rz * lat);
      rail.rotation.y = Math.atan2(fr.tx, fr.tz);
      rampGroup.add(rail);
    }
  }
  {
    const a = j.rampEndS - j.rampLength, fr = frameAt(course, j.rampEndS - j.rampLength / 2);
    const len = Math.hypot(j.rampLength, j.rampHeight);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(j.rampHalfWidth * 2 - 0.1, 0.3, len), darkWood);
    deck.position.set(fr.x, fr.y + j.rampHeight / 2 - 0.25, fr.z);
    deck.rotation.set(0, Math.atan2(fr.tx, fr.tz), 0); deck.rotateX(-Math.atan2(j.rampHeight, j.rampLength));
    deck.receiveShadow = true; rampGroup.add(deck); void a;
    // support pontoons under the lip
    for (const side of [-1, 1]) {
      const lf = frameAt(course, j.rampEndS - 0.6); const lat = side * (j.rampHalfWidth - 0.6);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, j.rampHeight + 0.9, 8), darkWood);
      post.position.set(lf.x + lf.rx * lat, lf.y + (j.rampHeight - 0.9) / 2 - 0.35, lf.z + lf.rz * lat); rampGroup.add(post);
    }
  }
  group.add(rampGroup);
  // funnel + gap boulder walls
  const wallGeo = boulderGeometry(31);
  const wallList: THREE.Matrix4[] = [];
  const mm = new THREE.Matrix4();
  for (let s = j.rampEndS - j.rampLength - 8; s < j.gapEndS + 1; s += 1.6) {
    const fr = frameAt(course, s);
    const hw = session.channelHalfWidth(s);
    for (const side of [-1, 1]) {
      const lat = side * (hw + 1.4 + r() * 0.6);
      const sc = 1.5 + r() * 0.8;
      mm.compose(new THREE.Vector3(fr.x + fr.rx * lat, fr.y - 0.2, fr.z + fr.rz * lat), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(sc, sc * 1.1, sc));
      wallList.push(mm.clone());
      if (hw < frameAt(course, s).hw - 2) {
        // fill between funnel and real bank
        const lat2 = side * (hw + 3.5 + r() * 3);
        mm.compose(new THREE.Vector3(fr.x + fr.rx * lat2, fr.y - 0.3, fr.z + fr.rz * lat2), new THREE.Quaternion(), new THREE.Vector3(sc * 1.3, sc, sc * 1.3));
        wallList.push(mm.clone());
      }
    }
  }
  // cascade boulders in the gap (visible hazard below the flight path)
  for (let s = j.rampEndS + 1.5; s < j.gapEndS - 0.5; s += 1.8) {
    const fr = frameAt(course, s);
    for (let k = -2; k <= 2; k++) {
      const lat = k * 2 + (r() - 0.5);
      const sc = 0.7 + r() * 0.6;
      mm.compose(new THREE.Vector3(fr.x + fr.rx * lat, fr.y - 0.3, fr.z + fr.rz * lat), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(sc, sc, sc));
      wallList.push(mm.clone());
    }
  }
  // edge boulders marking each rapid step (outside the navigable line, inside the bank collider)
  for (const st of course.rapidSteps) {
    const fr = frameAt(course, st);
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      const lat = side * (fr.hw - 0.4 + r() * 2.2), sc = 0.6 + r() * 0.7, ds = (r() - 0.5) * 4;
      mm.compose(new THREE.Vector3(fr.x + fr.rx * lat + fr.tx * ds, fr.y - 0.5, fr.z + fr.rz * lat + fr.tz * ds), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(sc, sc, sc));
      wallList.push(mm.clone());
    }
  }
  if (rockKit.length) {
    // spread the wall boulders over all fal rock pieces (boulder footprint is 1 m, procedural one was radius 1)
    const per: THREE.Matrix4[][] = rockKit.map(() => []);
    const sc2 = new THREE.Matrix4().makeScale(2.1, 2.1, 2.1);
    wallList.forEach(w => per[Math.floor(r() * per.length)].push(w.clone().multiply(sc2)));
    per.forEach((list, i) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(rockKit[i].geometry, rockKit[i].material, list.length);
      list.forEach((w, k) => im.setMatrixAt(k, w)); im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im);
    });
  } else {
    const walls = new THREE.InstancedMesh(wallGeo, rockMat, wallList.length);
    wallList.forEach((w, i) => walls.setMatrixAt(i, w));
    walls.castShadow = true; walls.receiveShadow = true; walls.computeBoundingSphere();
    group.add(walls);
  }
  // tall sandstone pillars flanking the leap (canyon gateway framing)
  const pillarGeo = chamferBlock(); const pillarMat = sandstoneMaterial();
  for (const side of [-1, 1]) {
    const fr = frameAt(course, j.rampEndS + 4);
    const lat = side * (fr.hw + 5);
    const tall = cliffKit.find(k => k.name === 'tall') ?? cliffKit[0];
    const p = tall ? new THREE.Mesh(tall.geometry, tall.material) : new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(fr.x + fr.rx * lat, fr.y - 3, fr.z + fr.rz * lat);
    // front (+X) toward the river: (cos y, -sin y) = -(outward)
    if (tall) { p.scale.set(8, 26, 10); p.rotation.y = Math.atan2(fr.rz * side, -fr.rx * side); }
    else { p.scale.set(8, 26, 7); p.rotation.y = Math.atan2(fr.tx, fr.tz); }
    p.castShadow = true; group.add(p);
  }
  // landing zone ring
  const lpr = course.project(j.landX, j.landZ, j.rampEndS + 17, 40);
  const lfr = { x: j.landX, z: j.landZ, y: frameAt(course, lpr.s).y, tx: j.landTx, tz: j.landTz };
  const ringMat = new THREE.MeshBasicMaterial({ color: '#6dff6a', transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const discL = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48), new THREE.MeshBasicMaterial({ color: '#7dff5a', transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
  discL.rotation.x = -Math.PI / 2;
  const landing = new THREE.Group(); landing.add(ring, discL);
  landing.position.set(lfr.x, lfr.y + 0.12, lfr.z);
  landing.rotation.y = Math.atan2(lfr.tx, lfr.tz);
  landing.scale.set(j.landHalfWidth, 1, j.landHalfLength);
  group.add(landing);

  // ---------- finish arch + docks ----------
  const fs = session.finishS;
  const ffr = frameAt(course, fs);
  const finish = new THREE.Group();
  finish.position.set(ffr.x, ffr.y, ffr.z); finish.rotation.y = Math.atan2(ffr.tx, ffr.tz);
  const postMat = new THREE.MeshStandardMaterial({ color: PAL.wood, roughness: 0.9, flatShading: true });
  const span = ffr.hw + 1.5;
  for (const side of [-1, 1]) {
    for (const off of [-0.6, 0.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 11, 0.5), postMat);
      p.position.set(side * span + off, 5, 0); p.castShadow = true; finish.add(p);
    }
    for (let k = 0; k < 4; k++) {
      const x = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 0.2), postMat);
      x.position.set(side * span, 1.5 + k * 2.6, 0); x.rotation.z = k % 2 ? 0.8 : -0.8; finish.add(x);
    }
    // docks
    const dock = new THREE.Mesh(new THREE.BoxGeometry(6, 0.35, 14), new THREE.MeshStandardMaterial({ color: PAL.woodLight, roughness: 0.9 }));
    dock.position.set(side * (span + 4), 0.55, 0); dock.receiveShadow = true; dock.castShadow = true; finish.add(dock);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2, 0.7, 0.7), postMat); beam.position.y = 10.4; finish.add(beam);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.2, span * 0.3), new THREE.MeshStandardMaterial({ map: textTexture('FINISH', '#e8642a', '#fff3dc'), roughness: 0.7, side: THREE.DoubleSide }));
  sign.position.set(0, 9.6, -0.4); sign.rotation.y = Math.PI; finish.add(sign);
  // bunting
  const flagCols = ['#e8572a', '#2a7fd0', '#f4c43c', '#3bb08a'];
  for (let k = 0; k < 22; k++) {
    const x = -span + (k + 0.5) * (span * 2 / 22);
    const sag = 7.6 - Math.sin(((k + 0.5) / 22) * Math.PI) * 1.2;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 3), new THREE.MeshStandardMaterial({ color: flagCols[k % 4], flatShading: true }));
    f.position.set(x, sag, 0); f.rotation.z = Math.PI; finish.add(f);
  }
  group.add(finish);

  // start dock with route marker flag
  const sfr = frameAt(course, 4);
  const sdock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 22), new THREE.MeshStandardMaterial({ color: PAL.woodLight, roughness: 0.9 }));
  const sl = -(sfr.hw + 1);
  sdock.position.set(sfr.x + sfr.rx * sl, 0.5, sfr.z + sfr.rz * sl + 0); sdock.rotation.y = Math.atan2(sfr.tx, sfr.tz);
  sdock.castShadow = true; sdock.receiveShadow = true; group.add(sdock);
  for (let k = -5; k <= 5; k++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.4, 6), postMat);
    p.position.set(sdock.position.x + sfr.tx * k * 2 + sfr.rx * 1.9, 0.2, sdock.position.z + sfr.tz * k * 2 + sfr.rz * 1.9); group.add(p);
  }

  const resetVisuals = (s: Session) => {
    gateObjs.forEach((g, i) => { g.chev.visible = i === s.nextGate; g.banners.forEach(b => (b.material = s.gates[i].passed ? passedBanner : bannerMat)); });
    popAnim.clear();
  };
  resetVisuals(session);

  return {
    group,
    reset: resetVisuals,
    popToken(id) { popAnim.set(id, 0); },
    update(t, s, dt) {
      gateObjs.forEach((g, i) => {
        g.chev.visible = i === s.nextGate && s.phase !== 'finished';
        (g.chev.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(t * 4) * 0.2;
        g.chev.position.y = frameAt(course, s.gates[i].s).y + 4.2 + Math.sin(t * 2) * 0.15;
        g.banners.forEach(b => (b.material = s.gates[i].passed ? passedBanner : bannerMat));
        g.bobs.forEach((b, k) => { b.position.y = frameAt(course, s.gates[i].s).y + Math.sin(t * 1.8 + i + k) * 0.08; b.rotation.z = Math.sin(t * 1.3 + k) * 0.04; });
      });
      s.tokens.forEach((tk, i) => {
        let sc = 1; let lift = 0;
        if (tk.collected) {
          const a = popAnim.get(tk.id);
          if (a === undefined) sc = 0;
          else { const na = a + dt; popAnim.set(tk.id, na); sc = Math.max(0, 1.4 - na * 4) ; lift = na * 3; if (na > 0.35) { popAnim.delete(tk.id); sc = 0; } }
        }
        tq.setFromEuler(new THREE.Euler(0, t * 2.2 + i, 0));
        tv.set(tk.x, tk.y + Math.sin(t * 2 + i) * 0.15 + lift, tk.z); ts.setScalar(sc * 1.25);
        tm.compose(tv, tq, ts);
        discI.setMatrixAt(i, tm); rayI.setMatrixAt(i, tm);
        glows[i].visible = sc > 0; glows[i].position.copy(tv);
      });
      discI.instanceMatrix.needsUpdate = true; rayI.instanceMatrix.needsUpdate = true;
      ring.scale.setScalar(1 + Math.sin(t * 3) * 0.02);
      ringMat.opacity = s.landingAwarded ? 0.25 : 0.8;
    },
  };
}
