// Train-local scenery: the train stays near the origin and the world scrolls past it (-Z).
import * as THREE from 'three';
import { Textures, trackTexture } from './materials';

export const TRAIN_SPEED = 15; // m/s apparent travel

interface Wrapped { mat: THREE.Material; uniforms: { uTravel: { value: number } } }

/** Instanced mesh whose instances wrap along Z in the vertex shader (no per-frame matrix uploads). */
function wrappingMaterial(base: THREE.Material, zMin: number, span: number, billboard = false): Wrapped {
  const uniforms = { uTravel: { value: 0 } };
  base.onBeforeCompile = (sh) => {
    sh.uniforms.uTravel = uniforms.uTravel;
    sh.vertexShader = 'uniform float uTravel;\n' + sh.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mat4 wrapM = instanceMatrix;
        wrapM[3].z = mod(wrapM[3].z - uTravel - (${zMin.toFixed(1)}), ${span.toFixed(1)}) + (${zMin.toFixed(1)});
        ${billboard ? `
        vec4 bc = modelViewMatrix * vec4(wrapM[3].xyz, 1.0);
        mvPosition = bc + vec4(transformed.x * length(wrapM[0].xyz), transformed.y * length(wrapM[1].xyz), 0.0, 0.0);` : `
        mvPosition = modelViewMatrix * (wrapM * mvPosition);`}
      #else
        mvPosition = modelViewMatrix * mvPosition;
      #endif
      gl_Position = projectionMatrix * mvPosition;`);
  };
  base.customProgramCacheKey = () => `wrap${zMin}_${span}_${billboard}`;
  return { mat: base, uniforms };
}

function rand(seed: number) { let a = seed; return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; }; }

export interface Scenery { root: THREE.Group; update(dt: number, camPos: THREE.Vector3): void; travel: number; setQuality(q: 'high' | 'low'): void }

export function buildScenery(tex: Textures, scene: THREE.Scene): Scenery {
  const root = new THREE.Group();
  const R = rand(1234567);
  const GROUND_Y = -1.95;

  // sky dome gradient
  const sky = new THREE.Mesh(new THREE.SphereGeometry(950, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#4fa6ee') }, mid: { value: new THREE.Color('#5aaef0') }, bottom: { value: new THREE.Color('#b9e0f8') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.25 ? mix(mid, top, smoothstep(0.25, 0.8, h)) : mix(bottom, mid, smoothstep(-0.02, 0.25, h)); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  }));
  sky.renderOrder = -10; root.add(sky);

  // painted panorama backdrop (fal-generated), mirrored repeat to hide the seam
  tex.backdrop.wrapS = THREE.MirroredRepeatWrapping; tex.backdrop.repeat.set(4, 1); tex.backdrop.anisotropy = 8;
  const BR = 720, BH = 610;
  // alpha fades the panorama's top edge into the sky dome (no visible seam when looking up)
  const fade = document.createElement('canvas'); fade.width = 4; fade.height = 256;
  const fg = fade.getContext('2d')!; const gr = fg.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#000'); gr.addColorStop(0.22, '#fff'); gr.addColorStop(1, '#fff'); fg.fillStyle = gr; fg.fillRect(0, 0, 4, 256);
  const fadeTex = new THREE.CanvasTexture(fade);
  const backdrop = new THREE.Mesh(new THREE.CylinderGeometry(BR, BR, BH, 96, 1, true), new THREE.MeshBasicMaterial({ map: tex.backdrop, alphaMap: fadeTex, side: THREE.BackSide, fog: false, transparent: true, depthWrite: false }));
  backdrop.position.y = BH / 2 - 250; backdrop.renderOrder = -9; root.add(backdrop);

  // meadow ground (scrolling texture)
  tex.meadow.wrapS = tex.meadow.wrapT = THREE.RepeatWrapping; tex.meadow.anisotropy = 8;
  const TILE = 7;
  tex.meadow.repeat.set(1400 / TILE, 1400 / TILE);
  const groundMat = new THREE.MeshStandardMaterial({ map: tex.meadow, color: '#b4d48c', roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true; root.add(ground);

  // track bed + rails
  const tt = trackTexture(); tt.repeat.set(1, 600 / 3.6);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 600), new THREE.MeshStandardMaterial({ map: tt, roughness: 1 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, GROUND_Y + 0.03, 100); bed.receiveShadow = true; root.add(bed);
  const railMat = new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.8, roughness: 0.3 });
  for (const x of [-1.25, 1.25]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 600), railMat); r.position.set(x, GROUND_Y + 0.2, 100); r.receiveShadow = true; root.add(r); }
  const bed3 = bed.clone(); bed3.position.x = -7.4; root.add(bed3);
  for (const x of [-8.65, -6.15]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 600), railMat); r.position.set(x, GROUND_Y + 0.2, 100); root.add(r); }
  // second, parallel track to the left for depth
  const bed2 = bed.clone(); bed2.position.x = 7.5; root.add(bed2);
  for (const x of [6.25, 8.75]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 600), railMat); r.position.set(x, GROUND_Y + 0.2, 100); root.add(r); }

  const wraps: Wrapped[] = [];

  // flowers / grass from the fal flower atlas (2x2: big flower, cluster, grass, pine)
  const quad = (u0: number, v0: number) => {
    const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
    const g2 = g.clone(); g2.rotateY(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    const pos = new Float32Array([...g.attributes.position.array, ...g2.attributes.position.array]);
    const nrm = new Float32Array([...g.attributes.normal.array, ...g2.attributes.normal.array].map((_, i) => (i % 3 === 1 ? 1 : 0)));
    const uvs = new Float32Array([...g.attributes.uv.array, ...g2.attributes.uv.array]);
    const idx = [...g.index!.array, ...[...g2.index!.array].map((i) => i + 4)];
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.setIndex(idx);
    return merged;
  };
  tex.flowers.anisotropy = 4;
  const sprite = (u0: number, v0: number, count: number, place: (i: number, m: THREE.Matrix4) => void, zMin: number, span: number, tint = '#ffffff', map = tex.flowers, billboard = false) => {
    const w = wrappingMaterial(new THREE.MeshBasicMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, color: tint }), zMin, span, billboard);
    const geo = billboard ? (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.42, 0); const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5); return g; })() : quad(u0, v0);
    const mesh = new THREE.InstancedMesh(geo, w.mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) { place(i, m); mesh.setMatrixAt(i, m); }
    mesh.frustumCulled = false;
    wraps.push(w); root.add(mesh);
    return mesh;
  };
  const sideX = (min: number, max: number) => { const s = R() < 0.7 ? 1 : -1; const x = min + Math.pow(R(), 1.6) * (max - min); return s > 0 ? x + 1.2 : -x - 7.6; };
  const place = (scale0: number, scale1: number, xmin: number, xmax: number, zMin: number, span: number) => (_: number, m: THREE.Matrix4) => {
    const s = scale0 + R() * (scale1 - scale0);
    m.compose(new THREE.Vector3(sideX(xmin, xmax), GROUND_Y - 0.05, zMin + R() * span), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R() * Math.PI, 0)), new THREE.Vector3(s, s, s));
  };
  // flowers grow in patches (reference: dense drifts beside the track, calmer grass between)
  const patchy = (scale0: number, scale1: number, xmin: number, xmax: number, zMin: number, span: number) => (_: number, m: THREE.Matrix4) => {
    let x = 0, z = 0;
    for (let k = 0; k < 6; k++) { x = sideX(xmin, xmax); z = zMin + R() * span; if (Math.sin(z * 0.045 + x * 0.09) + Math.sin(z * 0.11 - x * 0.05) > -0.2) break; }
    const s = scale0 + R() * (scale1 - scale0);
    m.compose(new THREE.Vector3(x, GROUND_Y - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R() * Math.PI, 0)), new THREE.Vector3(s, s, s));
  };
  const flowersHi = sprite(0, 0.5, 5200, patchy(0.4, 0.95, 3.0, 60, -120, 360), -120, 360, '#ffe9a0');
  const clusters = sprite(0.5, 0.5, 2600, patchy(0.6, 1.25, 3.2, 80, -120, 360), -120, 360, '#ffe9a0');
  const grass = sprite(0, 0, 2400, place(0.5, 1.0, 2.6, 60, -120, 360), -120, 360, '#cfe0a8');
  tex.trees.anisotropy = 4;
  const pines = sprite(0.5, 0.5, 220, place(9, 17, 26, 280, -300, 900), -300, 900, '#e4ecf2', tex.trees, true);
  const roundTrees = sprite(0, 0.5, 170, place(7, 13, 18, 240, -300, 900), -300, 900, '#ffffff', tex.trees, true);
  const bushes = sprite(0, 0, 260, place(2, 4.2, 6, 120, -300, 900), -300, 900, '#ffffff', tex.trees, true);
  const boulders = sprite(0.5, 0, 50, place(1.6, 4.5, 6, 140, -300, 900), -300, 900, '#ffffff', tex.trees, true);

  const mm = new THREE.Matrix4();
  // rolling mid-distance hills give parallax between ground and the painted backdrop
  const hillW = wrappingMaterial(new THREE.MeshStandardMaterial({ color: '#86ad4e', roughness: 1 }), -500, 1400);
  const hills = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hillW.mat, 26);
  for (let i = 0; i < 26; i++) { const s = 40 + R() * 70; const side = i % 2 ? 1 : -1; mm.compose(new THREE.Vector3(side * (150 + R() * 260), GROUND_Y - 2, -500 + R() * 1400), new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 0.32, s)); hills.setMatrixAt(i, mm); }
  hills.frustumCulled = false; wraps.push(hillW); root.add(hills);

  // daylight
  const hemi = new THREE.HemisphereLight('#cfe6ff', '#7d9642', 0.8);
  const sun = new THREE.DirectionalLight('#fff0d8', 3.4);
  sun.position.set(-16, 30, -14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  // front "glint" light (no shadows): sun bouncing off the lacquer toward the camera, catching bevels, rails and bolts
  const glint = new THREE.DirectionalLight('#fff4e0', 1.6);
  glint.position.set(-6, 9, 30);
  scene.add(hemi, sun, sun.target, glint, glint.target);
  scene.fog = new THREE.Fog('#c4e0f2', 70, 680);

  const api: Scenery = {
    root, travel: 0,
    update(dt, cam) {
      api.travel += dt * TRAIN_SPEED;
      for (const w of wraps) w.uniforms.uTravel.value = api.travel;
      tex.meadow.offset.y = (api.travel / TILE) % 1;
      tt.offset.y = (api.travel / 3.6) % 1;
      sky.position.copy(cam); backdrop.position.x = cam.x; backdrop.position.z = cam.z;
      ground.position.x = cam.x; ground.position.z = cam.z;
      // texture follows ground translation so it stays world-anchored
      tex.meadow.offset.x = (cam.x / TILE) % 1; tex.meadow.offset.y = ((api.travel - cam.z) / TILE) % 1;
      sun.position.set(cam.x - 16, 30, cam.z - 14); sun.target.position.set(cam.x, 0, cam.z);
      glint.position.set(cam.x - 6, 9, cam.z + 30); glint.target.position.set(cam.x, 0, cam.z);
    },
    setQuality(q) {
      flowersHi.count = q === 'high' ? 5200 : 2200; clusters.count = q === 'high' ? 2600 : 1000; grass.count = q === 'high' ? 2400 : 900; pines.count = q === 'high' ? 220 : 140; roundTrees.count = q === 'high' ? 170 : 110; bushes.count = q === 'high' ? 260 : 120; boulders.count = 50;
      sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); (sun.shadow as any).map = null; }
    },
  };
  return api;
}
