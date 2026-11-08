import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './ui/style.css';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { Session, DT, GameEvent } from './game/session';
import { NO_INPUT } from './game/boat';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { loadSave, writeSave, SaveData } from './core/save';
import { buildSky } from './world/sky';
import { buildWater, buildBanks } from './world/river';
import { buildCanyon, CliffModule } from './world/canyon';
import type { MeshKit } from './world/vegetation';
import { buildVegetation } from './world/vegetation';
import { buildProps, Props } from './world/props';
import { PAL } from './world/palette';
import { BoatView } from './view/boatView';
import { Wake, Spray } from './view/effects';
import { ChaseCamera } from './view/chaseCamera';
import { Hud, renderResults } from './ui/hud';

const BASE = import.meta.env.BASE_URL;
const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);

const save: SaveData = loadSave();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(new THREE.Color('#ecd2bf').lerp(new THREE.Color(PAL.skyHorizon), 0.35), 70, 620);
const session = new Session();
const input = new Input();
const audio = new Audio();
const hud = new Hud();
const chase = new ChaseCamera(innerWidth / innerHeight);
const camera = chase.cam;

// ---------- lighting (sun from upper left, warm bounce from sandstone) ----------
const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.42).normalize();
const sun = new THREE.DirectionalLight('#fff0d6', 3.4);
sun.castShadow = true;
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#cfe9ff', '#d9805a', 0.95);
scene.add(hemi);
const fill = new THREE.DirectionalLight('#ffd2b0', 0.55); fill.position.set(-0.5, 0.3, -0.6);
scene.add(fill);

buildSky(scene);

let quality: 'high' | 'low' = save.quality;
let world: { group: THREE.Group; waterU: Record<string, THREE.IUniform>; cardU: Record<string, THREE.IUniform>; props: Props; updateLod: (c: THREE.Vector3) => void } | null = null;
let foliageTex: THREE.Texture;
let treeTex: THREE.Texture;
const cliffKit: CliffModule[] = [];
const rockKit: MeshKit[] = [];
/** Scenery seed: random every page load for variety; ?seed=N reproduces a world. Gameplay layout never changes. */
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
let sceneSeed = Number.isFinite(urlSeed) && urlSeed > 0 ? urlSeed : 1 + Math.floor(Math.random() * 1e6);
const isShared = (m: THREE.Mesh) => cliffKit.some(k => k.geometry === m.geometry || k.lod === m.geometry || k.material === m.material) || rockKit.some(k => k.geometry === m.geometry || k.material === m.material);

function disposeGroup(g: THREE.Object3D) {
  g.traverse(o => {
    const m = o as THREE.Mesh;
    // shared loaded resources (cliff module) survive a quality rebuild
    if (isShared(m)) return;
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) { for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose(); mt.dispose(); }
  });
}

function buildWorld() {
  if (world) { scene.remove(world.group); disposeGroup(world.group); }
  const group = new THREE.Group();
  const water = buildWater(session.course, quality, session.rocks);
  water.uniforms.uSunDir.value.copy(SUN_DIR);
  group.add(water.mesh);
  group.add(buildBanks(session.course));
  const canyon = buildCanyon(session.course, quality, cliffKit, sceneSeed);
  group.add(canyon.group);
  const j = session.course.jump;
  const veg = buildVegetation(session.course, canyon.ledges, quality, s => s > j.rampEndS - j.rampLength - 10 && s < j.gapEndS + 2, foliageTex, treeTex, sceneSeed, rockKit);
  group.add(veg.group);
  const props = buildProps(session, foliageTex, cliffKit, rockKit, sceneSeed);
  group.add(props.group);
  scene.add(group);
  world = { group, waterU: water.uniforms, cardU: veg.cardUniforms, props, updateLod: canyon.updateLod };
  const pr = Math.min(devicePixelRatio, quality === 'high' ? 1.5 : 1);
  renderer.setPixelRatio(pr);
  sun.shadow.mapSize.setScalar(quality === 'high' ? 2048 : 1024);
  sun.shadow.map?.dispose(); (sun.shadow as any).map = null;
  resize();
}

// ---------- boat + effects ----------
let boatView: BoatView;
const wake = new Wake(); scene.add(wake.mesh);
const spray = new Spray(); scene.add(spray.points);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  spray.setPixelScale(innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', resize);

// ---------- game flow ----------
type UiState = 'loading' | 'title' | 'playing' | 'paused' | 'results';
let ui: UiState = 'loading';
let acc = 0; let last = performance.now(); let simT = 0; let resultsTimer = -1;
let boostWasActive = false;

function resetRun() {
  session.reset();
  world?.props.reset(session);
  wake.clear(); spray.clear(); chase.reset(); hud.clear(); boatView?.resetPose();
  acc = 0; resultsTimer = -1; boostWasActive = false;
}

async function startRun() {
  await audio.unlock(`${BASE}assets/audio/`);
  audio.muted = save.muted; audio.musicVol = save.musicVol; audio.sfxVol = save.sfxVol; audio.applyVolumes();
  resetRun();
  audio.startLoops();
  session.start();
  ui = 'playing';
  show('title', false); show('results', false); show('pause', false); hud.show(true);
  last = performance.now();
}

function pause(v: boolean) {
  if (v && ui === 'playing') {
    ui = 'paused'; show('pause', true); input.clear(); audio.suspend();
    ($('musicVol') as HTMLInputElement).value = String(save.musicVol);
    ($('sfxVol') as HTMLInputElement).value = String(save.sfxVol);
    ($('muteChk') as HTMLInputElement).checked = save.muted;
    ($('qualitySel') as HTMLSelectElement).value = quality;
    ($('camSel') as HTMLSelectElement).value = chase.mode;
  } else if (!v && ui === 'paused') {
    ui = 'playing'; show('pause', false); audio.resume(); last = performance.now(); acc = 0;
  }
}

function toTitle() {
  audio.stopLoops(); resetRun(); ui = 'title';
  show('results', false); show('pause', false); hud.show(false); show('title', true); updateBestLine();
}

function updateBestLine() {
  $('bestLine').textContent = save.bestTime != null ? `Personal best: ${save.bestTime.toFixed(2)} s · ${save.bestScore.toLocaleString('en-US')} pts · ${'★'.repeat(save.bestStars)}` : 'No personal best yet — go set one!';
}

function finishRun() {
  const r = session.results!;
  let newBest = false;
  if (save.bestTime == null || r.time < save.bestTime) { save.bestTime = r.time; newBest = true; }
  if (r.score > save.bestScore) { save.bestScore = r.score; newBest = true; }
  save.bestStars = Math.max(save.bestStars, r.stars);
  writeSave(save);
  renderResults(r, save, newBest);
  ui = 'results'; show('results', true);
}

function handleEvent(e: GameEvent) {
  const b = session.boat;
  const wy = session.course.sampleAt(session.progressS).waterY;
  switch (e.type) {
    case 'pickup': audio.play('pickup', 0.8, 0.05); hud.toast('+100', 'gold'); world?.props.popToken(e.id); spray.burst(e.x, e.y, e.z, 10, 2); break;
    case 'gate': audio.play('gate', 0.9); hud.toast(`GATE ${e.index + 1}/6  +250`, 'green'); hud.flashGate(); break;
    case 'gateIgnored':
      if (e.reason === 'order') hud.hint(`Pass gate ${session.nextGate + 1} first!`);
      else if (e.reason === 'backward') hud.hint('Wrong way — gates count only going downstream');
      break;
    case 'scrape':
      audio.play('scrape', 0.4 + e.strength * 0.6, 0.25);
      spray.burst(e.x, wy + 0.3, e.z, 18, 3); chase.kick(0.15); boatView.triggerBrace();
      if (e.charged) hud.toast('BUMP  −50', 'warn');
      break;
    case 'launch': audio.play('boost', 0.8); hud.toast('CANYON LEAP!', 'gold'); break;
    case 'land':
      audio.play('splash', 1.0); spray.burst(b.x, wy + 0.2, b.z, 70, 6); chase.kick(0.5); boatView.triggerBrace();
      if (e.result === 'clean') { hud.toast('CLEAN LANDING  +500', 'green'); boatView.triggerCelebrate(); } else hud.toast('ROUGH LANDING', 'warn');
      break;
    case 'recover':
      hud.toast('RECOVERED  +3s', 'warn'); wake.clear(); spray.clear(); chase.reset();
      hud.hint(e.reason === 'missed-jump' ? 'Missed the leap — hit the ramp at speed (hold W + Shift)' : e.reason === 'stuck' ? 'Back to the last gate' : 'Stay inside the river!');
      break;
    case 'finishBlocked': hud.hint(`Missed ${e.missing} gate${e.missing > 1 ? 's' : ''} — turn back and pass ${e.missing > 1 ? 'them' : 'it'} downstream`, 4); audio.play('scrape', 0.3); break;
    case 'finish': audio.play('gate', 1); hud.toast('FINISH!', 'gold'); boatView.triggerCelebrate(); resultsTimer = 2.2; break;
    case 'go': hud.hint('Pass the buoy gates in order!', 2.5); break;
    case 'boost': if (!boostWasActive) audio.play('boost', 0.5, 0.5); break;
  }
}

function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 0.25); // bounded accumulator after focus loss
  for (const k of input.takePressed()) onKey(k);
  if (ui === 'playing') {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 8) {
      session.step(ui === 'playing' ? input.state() : NO_INPUT);
      for (const e of session.drainEvents()) handleEvent(e);
      boostWasActive = session.boat.boosting;
      acc -= DT; steps++; simT += DT;
    }
    if (steps >= 8) acc = 0;
    if (resultsTimer > 0 && (resultsTimer -= dt) <= 0) finishRun();
  } else if (ui === 'title' || ui === 'results') {
    // idle simulation keeps the boat bobbing / coasting
    acc += dt;
    while (acc >= DT) { session.step(NO_INPUT); session.drainEvents(); acc -= DT; simT += DT; }
  }
  render(dt, ui === 'playing' ? acc / DT : 1);
}

const tmpQ = new THREE.Quaternion();
function render(dt: number, alpha: number) {
  if (!boatView || !world) { renderer.render(scene, camera); return; }
  const b = session.boat, p = session.prev;
  const paused = ui === 'paused';
  const x = p.x + (b.x - p.x) * alpha, y = p.y + (b.y - p.y) * alpha, z = p.z + (b.z - p.z) * alpha;
  let dh = b.heading - p.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const h = p.heading + dh * alpha;
  boatView.root.position.set(x, y, z);
  boatView.root.quaternion.copy(tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h));
  const t = simT;
  if (!paused) {
    boatView.update(b, t, dt, session.phase === 'finished');
    const wy = session.course.sampleAt(session.progressS).waterY;
    wake.update(b, wy, t); spray.update(b, wy, dt, quality === 'high' ? 1 : 0.5);
    world.props.update(t, session, dt);
    world.waterU.uTime.value = t; world.cardU.uTime.value = t;
    (world.waterU.uBoat.value as THREE.Vector4).set(x, z, h, b.airborne ? 0 : Math.abs(b.speed));
    audio.engine(b.throttleLevel, b.speed, b.airborne);
  }
  boatView.root.updateMatrixWorld();
  chase.update(x, y, z, h, Math.abs(b.airborne ? Math.hypot(b.airVx, b.airVz) : b.speed), paused ? 0 : dt, boatView.tilt, session.course.sampleAt(session.progressS).waterY,
    (cx, cz) => { const pr = session.course.project(cx, cz, session.progressIndex, 30); return session.surfaceY(pr.s, pr.lateral); });
  // shadow camera follows the boat
  sun.position.set(x + SUN_DIR.x * 100, y + SUN_DIR.y * 100, z + SUN_DIR.z * 100);
  sun.target.position.set(x, y, z);
  world.updateLod(camera.position);
  if (ui === 'playing' || ui === 'paused') hud.update(session, paused ? 0 : dt);
  if (hud.mapOpen) hud.drawMap(session);
  renderer.render(scene, camera);
}

function onKey(code: string) {
  if (code === 'Escape') { if (ui === 'playing') pause(true); else if (ui === 'paused') pause(false); return; }
  if (code === 'KeyR' && (ui === 'paused' || ui === 'results')) { void startRun(); return; }
  if (code === 'KeyC' && (ui === 'playing' || ui === 'paused')) { chase.mode = chase.mode === 'chase' ? 'cockpit' : 'chase'; chase.reset(); return; }
  if (code === 'KeyM' && ui === 'playing') { hud.toggleMap(); return; }
  if (code === 'KeyN') { setMuted(!save.muted); return; }
  if ((code === 'Enter' || code === 'Space') && ui === 'title') { void startRun(); }
}

function setMuted(m: boolean) {
  save.muted = m; audio.muted = m; audio.applyVolumes(); writeSave(save);
  $('muteBtn').classList.toggle('muted', m);
}

// ---------- UI wiring ----------
$('startBtn').addEventListener('click', () => void startRun());
$('resumeBtn').addEventListener('click', () => pause(false));
$('retryBtn').addEventListener('click', () => void startRun());
$('againBtn').addEventListener('click', () => void startRun());
$('menuBtn').addEventListener('click', toTitle);
$('muteBtn').addEventListener('click', () => setMuted(!save.muted));
$('musicVol').addEventListener('input', e => { save.musicVol = Number((e.target as HTMLInputElement).value); audio.musicVol = save.musicVol; audio.applyVolumes(); writeSave(save); });
$('sfxVol').addEventListener('input', e => { save.sfxVol = Number((e.target as HTMLInputElement).value); audio.sfxVol = save.sfxVol; audio.applyVolumes(); writeSave(save); });
$('muteChk').addEventListener('change', e => setMuted((e.target as HTMLInputElement).checked));
$('qualitySel').addEventListener('change', e => { quality = (e.target as HTMLSelectElement).value as 'high' | 'low'; save.quality = quality; writeSave(save); buildWorld(); world!.props.reset(session); });
$('camSel').addEventListener('change', e => { chase.mode = (e.target as HTMLSelectElement).value as 'chase' | 'cockpit'; chase.reset(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
addEventListener('blur', () => pause(true));
$('muteBtn').classList.toggle('muted', save.muted);

// ---------- loading ----------
async function load() {
  const loader = new GLTFLoader();
  const CLIFFS: [string, string, [number, number, number], number][] = [
    ['module', 'sandstone-module.glb', [1, 0.95, 0.89], 1.2], ['tall', 'sandstone-tall.glb', [0.398, 0.98, 0.582], 1],
    ['wide', 'sandstone-wide.glb', [0.587, 0.398, 0.98], 1.2], ['overhang', 'sandstone-overhang.glb', [0.981, 0.911, 0.932], 0.6],
    ['rounded', 'sandstone-rounded.glb', [0.972, 0.906, 0.981], 0.8]];
  const ROCKS = ['boulder-a.glb', 'boulder-b.glb', 'boulder-c.glb'];
  const files = ['hero-boat.glb', 'driver.glb', 'passenger.glb', ...CLIFFS.map(c => c[1]), ...ROCKS, ...CLIFFS.map(c => c[1].replace('.glb', '-lod.glb'))];
  const progress = new Array(files.length).fill(0);
  const upd = () => { ($('loadFill') as HTMLElement).style.width = `${(progress.reduce((a, b) => a + b, 0) / files.length) * 100}%`; };
  try {
    foliageTex = await new THREE.TextureLoader().loadAsync(`${BASE}assets/textures/plants.webp`);
    foliageTex.colorSpace = THREE.SRGBColorSpace; foliageTex.anisotropy = 4;
    treeTex = await new THREE.TextureLoader().loadAsync(`${BASE}assets/textures/trees.webp`);
    treeTex.colorSpace = THREE.SRGBColorSpace; treeTex.anisotropy = 4;
    const gl = await Promise.all(files.map((f, i) => new Promise<GLTF>((res, rej) => loader.load(`${BASE}assets/models/${f}`, res, ev => { if (ev.total) { progress[i] = ev.loaded / ev.total; upd(); } }, rej))));
    boatView = new BoatView(gl[0], gl[1], gl[2]);
    const firstMesh = (g: GLTF) => {
      g.scene.updateMatrixWorld(true);
      let found: THREE.Mesh | null = null;
      g.scene.traverse(o => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
      const mm = found as unknown as THREE.Mesh;
      mm.geometry.applyMatrix4(mm.matrixWorld);
      // some reconstructions come back with inward normals: test against the centroid and flip if needed
      const geo = mm.geometry; const P = geo.attributes.position, N = geo.attributes.normal;
      geo.computeBoundingBox(); const c = geo.boundingBox!.getCenter(new THREE.Vector3());
      let dot = 0; for (let i = 0; i < P.count; i += 7) dot += (P.getX(i) - c.x) * N.getX(i) + (P.getY(i) - c.y) * N.getY(i) + (P.getZ(i) - c.z) * N.getZ(i);
      if (dot < 0) { for (let i = 0; i < N.count; i++) N.setXYZ(i, -N.getX(i), -N.getY(i), -N.getZ(i)); N.needsUpdate = true; console.info('flipped normals', geo.uuid); }
      const mt = mm.material as THREE.MeshStandardMaterial; mt.metalness = 0; mt.roughness = 0.9;
      return { geometry: mm.geometry, material: mt };
    };
    CLIFFS.forEach(([name, , native, weight], i) => {
      const k = firstMesh(gl[3 + i]);
      (k.material as THREE.MeshStandardMaterial).color.set('#f2c6b4'); // pull the baked salmon toward the reference's deeper red-orange
      const lod = firstMesh(gl[3 + CLIFFS.length + ROCKS.length + i]).geometry;
      cliffKit.push({ name, ...k, lod, native, weight });
    });
    ROCKS.forEach((_, i) => {
      const k = firstMesh(gl[3 + CLIFFS.length + i]);
      const rm = k.material as THREE.MeshStandardMaterial;
      // Tripo baked a dark slate-blue albedo (avg sRGB 106/122/127); lift and warm it toward the reference's mid grey
      rm.color.setRGB(2.1, 1.7, 1.55); rm.emissive.set('#26232a'); rm.roughness = 0.8;
      rockKit.push(k);
    });
    scene.add(boatView.root);
    buildWorld();
    // compile shaders before showing the title
    renderer.compile(scene, camera);
    show('loading', false); show('title', true); ui = 'title'; updateBestLine();
  } catch (err) {
    console.error(err);
    $('loadText').textContent = 'Could not load game assets. Check that the build was served with its assets/ folder, then reload.';
    $('loadText').style.color = '#ffd2b8';
  }
}
resize();
requestAnimationFrame(frame);
void load();

// ---------- development-only inspection hook ----------
if (import.meta.env.DEV || import.meta.env.MODE === 'playtest') {
  (window as any).__jjj = {
    session, input, audio, chase, renderer, scene, wake, spray, get boatView() { return boatView; }, get ui() { return ui; },
    start: startRun, pause, toTitle,
    teleport(s: number, lat = 0, speed = 10) {
      const c = session.course.sampleAt(s);
      const b = session.boat;
      b.x = c.x + c.rx * lat; b.z = c.z + c.rz * lat; b.y = c.waterY; b.heading = Math.atan2(c.tx, c.tz); b.speed = speed;
      b.airborne = false; b.slip = 0; session.onRamp = false;
      const pr = session.course.project(b.x, b.z, Math.round(s), 60);
      session.progressS = pr.s; session.lateral = pr.lateral; session.progressIndex = pr.index;
      wake.clear(); chase.reset();
    },
    get seed() { return sceneSeed; },
    reseed(n: number) { sceneSeed = n; buildWorld(); world!.props.reset(session); },
    hud(v: boolean) { $('ui').style.display = v ? '' : 'none'; },
    stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, loops: audio.activeLoops, crew: boatView?.crewCount }; },
  };
}
