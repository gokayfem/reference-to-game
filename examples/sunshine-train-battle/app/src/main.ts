import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './ui/style.css';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { load as loadSave, store, SaveData, Settings } from './core/save';
import { DT, EYE, Game, robotCenter } from './game/game';
import { ROOF_Y } from './game/level';
import { isReloading } from './game/rules';
import { loadTexture, makeMaterials, Textures } from './world/materials';
import { buildTrain } from './world/train';
import { buildScenery } from './world/scenery';
import { RobotViews, Debris, setRobotModel } from './world/robots';
import { ROBOT_MODELS } from './data/robotModels';
import { Fx } from './world/fx';
import { WeaponView, VIEW_FOV } from './world/weaponView';
import { MeshHand } from './world/handRig';
import { HAND_ALIGN } from './data/handAlign';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById('app')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.05, 2000);
camera.rotation.order = 'YXZ';

const save: SaveData = loadSave();
const input = new Input(canvas);
const audio = new Audio();
const game = new Game();
const screens = new Screens(app);
const hud = new Hud(app);
hud.visible = false;
const weapon = new WeaponView();

let robots: RobotViews, fx: Fx, debris: Debris, train: ReturnType<typeof buildTrain>, scenery: ReturnType<typeof buildScenery>;
let shake = 0;
let elapsed = 0;

function applySettings(s: Settings) {
  audio.volume = s.volume; audio.musicVolume = s.music; audio.sfxVolume = s.sfx; audio.muted = s.muted; audio.applyVolumes();
  input.sens = 0.0022 * s.sens;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, s.quality === 'high' ? 1.5 : 1));
  scenery?.setQuality(s.quality);
  resize();
}

function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  // HUD scales with the viewport so its footprint matches the reference at any size
  document.documentElement.style.setProperty('--hud', String(Math.max(0.5, Math.min(1.25, Math.min(w / 1920, h / 1080) * 1.05))));
}
window.addEventListener('resize', resize);

screens.onSetting = (k, v) => { (save.settings as any)[k] = v; store(save); applySettings(save.settings); };

async function boot() {
  screens.show('loading');
  resize();
  try {
    let done = 0; const total = 6;
    const step = () => screens.progress(++done / (total + 1));
    const [roof, meadow, flowers, backdrop, trees] = await Promise.all([
      loadTexture(`${BASE}assets/textures/roof-metal.jpg`).then((t) => (step(), t)),
      loadTexture(`${BASE}assets/textures/meadow.jpg`).then((t) => (step(), t)),
      loadTexture(`${BASE}assets/textures/flower-atlas.png`).then((t) => (step(), t)),
      loadTexture(`${BASE}assets/textures/backdrop.jpg`).then((t) => (step(), t)),
      loadTexture(`${BASE}assets/textures/tree-atlas.png`).then((t) => (step(), t)),
    ]);
    const gltf = await new GLTFLoader().loadAsync(`${BASE}assets/models/energy-blaster.glb`); step();
    await audio.preload(BASE, () => {});
    const tex: Textures = { roof, meadow, flowers, trees, backdrop };
    const mats = makeMaterials(tex);
    scenery = buildScenery(tex, scene);
    scene.add(scenery.root);
    train = buildTrain(mats);
    scene.add(train.root);
    // sculpted robot meshes (fal); primitives remain as fallback if a file fails
    await Promise.all(Object.entries(ROBOT_MODELS).map(async ([type, d]) => {
      try {
        const g = await new GLTFLoader().loadAsync(`${BASE}assets/models/robots/${d.file}`);
        const root = new THREE.Group(); const m = g.scene; m.rotation.y = d.yaw; root.add(m);
        const b0 = new THREE.Box3().setFromObject(root); const sc = d.height / (b0.max.y - b0.min.y); m.scale.setScalar(sc);
        const b = new THREE.Box3().setFromObject(root); const c = b.getCenter(new THREE.Vector3());
        m.position.set(-c.x, -b.min.y, -c.z);
        setRobotModel(type as 'base' | 'shield' | 'jumper', { scene: root, height: d.height, hipY: d.hipY, shoulderX: d.shoulderX });
      } catch (e) { console.warn('robot model unavailable', type, e); }
    }));
    robots = new RobotViews(scene);
    fx = new Fx(scene);
    debris = new Debris(scene);
    const env = buildEnvironment(backdrop);
    scene.environment = env; scene.environmentIntensity = 1.0;
    weapon.scene.environment = env; weapon.scene.environmentIntensity = 0.85;
    weapon.setModel(gltf.scene);
    game.muzzleOffset = weapon.muzzleOffset();
    // sculpted per-pose glove meshes (fal); the jointed procedural rig stays as the fallback
    try {
      const loader = new GLTFLoader();
      const loaded = Object.fromEntries(await Promise.all(Object.entries(HAND_ALIGN).map(async ([k, a]) => [k, { scene: (await loader.loadAsync(`${BASE}assets/models/hands/${a.file}`)).scene, align: a }] as const)));
      weapon.useMeshHands(new MeshHand({ grip: loaded.grip }), new MeshHand({ support: loaded.support, open: loaded.open, cell: loaded.cell }));
    } catch (e) { console.warn('hand meshes unavailable, using procedural rig', e); }
    applySettings(save.settings);
    renderer.compile(scene, camera);
    showTitle();
    requestAnimationFrame(frame);
    if (import.meta.env.DEV || params.has('debug')) exposeDebug();
  } catch (e) {
    console.error(e);
    screens.show('error', { msg: String((e as Error).message ?? e) });
  }
}

/** Small sky/meadow/sun scene prefiltered into a PMREM so clearcoats and metals pick up real sky reflections. */
function buildEnvironment(panorama: THREE.Texture) {
  // reflection scene: sky gradient + the painted hill panorama + a hot sun, prefiltered into a PMREM so painted
  // metal and clearcoats reflect the actual world (horizon line, hills, bright sky) rather than a flat colour
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 skyc = mix(vec3(0.75,0.88,1.0), vec3(0.22,0.52,0.95), smoothstep(0.0,0.7,h)); vec3 ground = mix(vec3(0.2,0.32,0.1), vec3(0.45,0.58,0.28), smoothstep(-0.6,0.0,h)); gl_FragColor = vec4(h > 0.0 ? skyc : ground, 1.0); }',
  }));
  env.add(sky);
  const pano = panorama.clone(); pano.wrapS = THREE.MirroredRepeatWrapping; pano.repeat.set(4, 1); pano.needsUpdate = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 6.8, 64, 1, true), new THREE.MeshBasicMaterial({ map: pano, side: THREE.BackSide }));
  band.position.y = 0.6; env.add(band);
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12.5, 10) }));
  sunDisc.position.set(-5, 7, -5); env.add(sunDisc);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.015);
  pm.dispose();
  return rt.texture;
}

function showTitle() {
  game.s.phase = 'title';
  hud.visible = false;
  screens.show('title', { settings: save.settings, best: save.best });
}

async function startPlay() {
  await audio.unlock();
  audio.startLoop('trainloop'); audio.startLoop('music');
  screens.hide();
  hud.visible = true;
  input.enabled = true;
  input.clear();
  game.start();
  input.requestLock();
}

function newRun() {
  game.reset();
  robots.reset(); fx.reset(); debris.clear(); hud.clearPops(); hud.toggleRoute(false);
  input.yaw = 0; input.pitch = -0.08; input.clear();
  audio.stopLoops();
  startPlay();
}

function pause(note = '') {
  if (game.s.phase !== 'playing') return;
  game.s.phase = 'paused';
  input.clear();
  audio.duck(true);
  screens.show('pause', { settings: save.settings, muted: save.settings.muted, note });
}

function resume() {
  if (game.s.phase !== 'paused') return;
  screens.hide(); audio.resume(); audio.duck(false);
  input.clear();
  game.s.phase = 'playing';
  input.requestLock();
}

screens.onAction = (a) => {
  if (a === 'play') startPlay();
  if (a === 'resume') resume();
  if (a === 'restart') newRun();
  if (a === 'retry') { game.retry(); fx.reset(); screens.hide(); input.clear(); input.requestLock(); }
  if (a === 'mute') { save.settings.muted = !save.settings.muted; store(save); applySettings(save.settings); screens.show('pause', { settings: save.settings, muted: save.settings.muted }); }
  if (a === 'reload') location.reload();
};

input.onLockChange = (locked) => { if (!locked && game.s.phase === 'playing' && !input.dragLook) pause(); };
input.onLockError = () => { screens.note('Pointer lock unavailable — hold left mouse and drag to look.'); };
canvas.addEventListener('click', () => { if (game.s.phase === 'playing' && !input.locked && !input.dragLook) input.requestLock(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); audio.suspend(); } else if (game.s.phase !== 'paused') audio.resume();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && input.dragLook) { if (game.s.phase === 'playing') pause(); else if (game.s.phase === 'paused') resume(); }
  if (e.code === 'Enter' && game.s.phase === 'dead') screens.onAction('retry');
});

function handleEvents() {
  const s = game.s;
  const eye = new THREE.Vector3(s.player.x, s.player.y + EYE, s.player.z);
  for (const e of game.events) {
    const at = e.x !== undefined ? new THREE.Vector3(e.x, e.y, e.z) : eye;
    const dist = at.distanceTo(eye);
    const near = Math.max(0.25, 1 - dist / 30);
    switch (e.type) {
      case 'fire': audio.play('shot', 0.55); weapon.fire(); shake = Math.max(shake, 0.12); break;
      case 'dry': audio.play('reload', 0.15, 2.2); weapon.dryFire(); break;
      case 'hit': audio.play('hit', 0.8); hud.hit(); fx.burst(at.x, at.y, at.z, '#ffb15c', 12, 3.5); fx.burst(at.x, at.y, at.z, '#7ff6ff', 6, 2); break;
      case 'robotShieldBlock': audio.play('shieldhit', 0.6, 1.25); robots.shieldHit(e.id!); fx.ripple(at.x, at.y, at.z, eye); fx.burst(at.x, at.y, at.z, '#7ff6ff', 10, 3); hud.popup('BLOCKED', at.x, at.y + 0.3, at.z, 'cyan'); break;
      case 'impact': fx.burst(at.x, at.y, at.z, e.kind === 'player' ? '#9ff8ff' : '#ff9a4a', 8, 2.5); break;
      case 'defeat': audio.play('defeat', 0.9); debris.burst(at.x, at.y, at.z); fx.burst(at.x, at.y, at.z, '#c58bff', 22, 5); fx.burst(at.x, at.y, at.z, '#ffd27a', 14, 4); hud.popup(`+${e.value}`, at.x, at.y + 0.6, at.z); break;
      case 'shieldBlock': audio.play('shieldhit', 0.9); weapon.shieldHit(); fx.ripple(at.x, at.y, at.z, eye); break;
      case 'robotFire': audio.play('robotshot', 0.6 * near); break;
      case 'hurt': {
        audio.play('hurt', 0.9); weapon.hurt(); shake = Math.max(shake, 0.35);
        const r = s.robots.find((x) => x.id === e.id);
        if (r) { const a = Math.atan2(r.x - s.player.x, r.z - s.player.z); hud.damage(-(a - s.player.yaw)); }
        break;
      }
      case 'pickup': audio.play('pickup', 0.8, e.kind === 'orange' ? 0.9 : 1.1); hud.popup(e.kind === 'cell' ? `+${e.value} CELLS` : `+${e.value}`, at.x, at.y + 0.3, at.z, e.kind === 'cell' ? 'cyan' : ''); break;
      case 'reload': audio.play('reload', 0.8); break;
      case 'land': audio.play('land', 0.5); weapon.land(); break;
      case 'robotLand': audio.play('land', 0.4 * near, 0.7); fx.burst(at.x, at.y + 0.05, at.z, '#cfe3ff', 8, 2); break;
      case 'carClear': audio.play('unlock', 0.9); hud.toast(e.value === 5 ? 'ENGINE APPROACH CLEAR' : 'CAR CLEAR', e.value === 5 ? 'Step onto the engine checkpoint!' : 'Checkpoint saved · +25 health · +12 cells · gate open'); break;
      case 'fall': hud.toast('FELL FROM THE TRAIN', '−50 points · returned to checkpoint'); shake = 0.4; break;
      case 'dead': input.exitLock(); input.clear(); hud.visible = true; screens.show('dead'); break;
      case 'retry': hud.toast('CHECKPOINT RESTORED', 'Robots and loot reset to the checkpoint'); break;
      case 'win': {
        audio.play('victory', 1); input.exitLock(); input.clear();
        const final = game.finalScore;
        const newBest = final > save.best;
        if (newBest) { save.best = final; save.bestTime = s.time; store(save); }
        const t = Math.floor(s.time);
        screens.show('won', { time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, crystals: s.crystals, accuracy: `${Math.round(game.accuracy * 100)}% (${s.hits}/${s.shots})`, recoveries: s.recoveries, score: s.score, final, best: save.best, newBest });
        break;
      }
    }
  }
  game.events.length = 0;
}

let acc = 0, last = performance.now();
const prevCam = new THREE.Vector3();
function frame(now: number) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000); // bounded after focus loss
  last = now;
  elapsed += rdt;
  const s = game.s;
  if (s.phase === 'playing') {
    if (input.take('KeyM')) hud.toggleRoute();
    acc = Math.min(acc + rdt, 0.25);
    while (acc >= DT) {
      game.step({
        moveX: input.axis('KeyA', 'KeyD'), moveZ: input.axis('KeyS', 'KeyW'), jump: input.take('Space'),
        sprint: input.held.has('ShiftLeft') || input.held.has('ShiftRight'), fire: input.mouseDown && (input.locked || input.dragLook),
        reload: input.take('KeyR'), shield: input.held.has('KeyQ'), yaw: input.yaw, pitch: input.pitch,
      });
      acc -= DT;
      if (game.s.phase !== 'playing') break;
    }
  } else { acc = 0; input.clearPressed(); }
  handleEvents();
  render(rdt, s.phase === 'playing' ? acc / DT : 1);
}

function render(dt: number, alpha: number) {
  const s = game.s, p = s.player;
  const px = p.px + (p.x - p.px) * alpha, py = p.py + (p.y - p.py) * alpha, pz = p.pz + (p.z - p.pz) * alpha;
  shake = Math.max(0, shake - dt * 1.8);
  const sh = shake * save.settings.shake;
  camera.position.set(px + (Math.random() - 0.5) * sh * 0.06, py + EYE + (Math.random() - 0.5) * sh * 0.06, pz);
  camera.rotation.set(input.pitch + weaponKick(), input.yaw + Math.PI, 0);
  const playing = s.phase === 'playing';
  scenery.update(playing || s.phase === 'title' ? dt : 0, camera.position);
  train.update(dt, elapsed, s.cleared);
  robots.sync(s.robots, alpha, elapsed);
  fx.syncBolts(s.bolts, alpha);
  fx.syncLoot(s.loot, elapsed);
  fx.update(dt);
  debris.update(dt, ROOF_Y);
  // telegraph charge points at the player; keep the robot readable
  weapon.update(dt, {
    reloadP: isReloading(s.weapon) ? 1 - s.weapon.reloadTimer / 1.3 : -1, shielding: s.shield.active, speed: Math.hypot(p.vx, p.vz), grounded: p.grounded, sprinting: p.sprinting,
    lookDX: input.lookDX, lookDY: input.lookDY, aspect: camera.aspect, t: elapsed,
  });
  input.lookDX = 0; input.lookDY = 0;
  hud.update(dt, game, project);
  renderer.clear();
  renderer.render(scene, camera);
  if (s.phase !== 'title' || params.has('shot')) { renderer.clearDepth(); renderer.render(weapon.scene, weapon.camera); }
  prevCam.copy(camera.position);
}

let kick = 0;
function weaponKick() { kick *= 0.85; return kick; }

const tmpV = new THREE.Vector3();
function project(x: number, y: number, z: number) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * app.clientWidth, y: (-tmpV.y * 0.5 + 0.5) * app.clientHeight, visible: tmpV.z < 1 && tmpV.z > -1 };
}

function exposeDebug() {
  (window as any).__stb = {
    game, input, hud, audio, THREE, renderer, weapon, scene, camera,
    robotCenter,
    /** deterministic capture pose */
    pose(x: number, y: number, z: number, yaw: number, pitch: number) { const p = game.s.player; p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z; input.yaw = yaw; input.pitch = pitch; },
    stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; },
  };
}

boot();
