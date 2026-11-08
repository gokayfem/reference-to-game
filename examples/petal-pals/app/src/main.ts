import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import './ui/style.css';
import * as THREE from 'three';
import { loadAll } from './core/assets';
import { Audio } from './core/audio';
import { Input } from './core/input';
import { Game } from './game/game';
import { loadFrom, newGame, saveTo, SAVE_KEY } from './game/state';
import { UI } from './ui/ui';
import { makeComposer } from './core/post';

const STEP = 1 / 60;
const canvas = document.getElementById('world') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const QUALITY = { high: { dpr: 1.5, flowers: 1 }, medium: { dpr: 1.2, flowers: 0.75 }, low: { dpr: 0.9, flowers: 0.45 } } as const;
type Q = keyof typeof QUALITY;
let quality: Q = (localStorage.getItem('petalpals.quality') as Q) || 'high';
if (!QUALITY[quality]) quality = 'high';

const input = new Input();
const audio = new Audio();
let game: Game;
let post: ReturnType<typeof makeComposer> | null = null;
let started = false;
let pausedByUser = false;

const ui = new UI({
  onAction: k => { if (!started) return; unlockAudio(); if (k === 'photo' && game.mode === 'photo') { game.exitPhoto(); return; } game.doAction(k); },
  onFlute: () => started && game.playFlute(),
  onToggleJournal: () => { if (!started || game.mode === 'photo') return; ui.toggleJournal(); syncBlocking(); },
  onToggleMap: () => { if (!started || game.mode === 'photo') return; ui.toggleMap(); syncBlocking(); },
  onPhotoToggle: () => { if (!started) return; if (game.mode === 'photo') game.exitPhoto(); else game.enterPhoto(); },
  onResume: () => { ui.close(); pausedByUser = false; syncBlocking(); },
  onNewDay: () => newDay(),
  onMute: m => { audio.setMuted(m); localStorage.setItem('petalpals.muted', m ? '1' : '0'); },
  onVolume: (m, s) => { audio.musicVol = m; audio.sfxVol = s; audio.applyVolumes(); },
  onQuality: q => setQuality(q),
  onShutter: () => game.shutter(renderer),
  onSetWaypoint: (x, z) => { game.setWaypoint(x, z); persist(); },
  onClearWaypoint: () => { game.clearWaypoint(); persist(); },
});

function syncBlocking() {
  const blocking = ui.overlay !== 'none';
  input.uiBlocking = blocking;
  if (game) game.paused = blocking && ui.overlay !== 'journal' && ui.overlay !== 'map' ? true : pausedByUser;
  if (game && (ui.overlay === 'pause' || ui.overlay === 'confirm' || ui.overlay === 'complete' || ui.overlay === 'title')) game.paused = true;
  if (game && (ui.overlay === 'journal' || ui.overlay === 'map')) game.paused = false; // world keeps idling but input is blocked
  if (blocking) input.clear();
}

function setQuality(q: Q) {
  quality = q; localStorage.setItem('petalpals.quality', q);
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].dpr));
  game?.worldView.setQuality(QUALITY[q].flowers);
  resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  if (post) { post.composer.setPixelRatio(renderer.getPixelRatio()); post.composer.setSize(innerWidth, innerHeight); post.grade.uniforms.uAspect.value = innerWidth / innerHeight; }
  if (game) { game.camera.aspect = innerWidth / innerHeight; game.camera.updateProjectionMatrix(); }
}
addEventListener('resize', resize);

function persist() {
  if (!game) return;
  game.state.player = [game.explorer.pos.x, game.explorer.pos.z];
  const r = saveTo(localStorage, game.state);
  if (r === 'trimmed') ui.message('Storage is nearly full — photo thumbnails were not saved.', 'warn');
  if (r === 'failed') ui.message('Could not save progress (browser storage unavailable).', 'warn');
}

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return; audioUnlocked = true;
  audio.setMuted(localStorage.getItem('petalpals.muted') === '1');
  audio.unlock();
}

// ---------------------------------------------------------------- title + boot
function titleScreen() {
  const el = document.createElement('div'); el.id = 'title'; el.className = 'overlay';
  el.innerHTML = `<div class="panel"><h1 class="logo">Petal Pals</h1><div class="tag">MEADOW DISCOVERY DAY</div>
    <div class="load"><b></b></div><div class="status">Gathering the meadow…</div>
    <div class="row hidden"><button class="btn cont">Begin Day</button><button class="btn alt nd hidden">New Day</button></div>
    <div class="controls">WASD walk · Shift stroll faster · E interact · Tab target · 1–4 actions<br>F flute · J journal · M map · Esc pause</div></div>`;
  document.getElementById('ui')!.appendChild(el);
  return el;
}

async function boot() {
  const title = titleScreen();
  const bar = title.querySelector('.load b') as HTMLElement;
  let tex;
  try {
    tex = await loadAll(f => { bar.style.width = `${Math.round(f * 100)}%`; });
  } catch (e) {
    title.querySelector('.status')!.innerHTML = `<div class="err">Could not load game assets: ${(e as Error).message}. Please reload the page.</div>`;
    return;
  }
  const loaded = loadFrom(localStorage);
  game = new Game(tex, loaded.state, input, audio, {
    message: (t, tone) => ui.message(t, tone),
    rule: e => ui.ruleEvent(e),
    photo: (ok, info, thumb) => ui.photoResult(ok, info, thumb),
    changed: () => { ui.refresh(); persist(); },
  });
  title.querySelector('.status')!.textContent = 'Planting flowers…';
  await new Promise(r => setTimeout(r, 20));
  game.build();
  post = makeComposer(renderer, game.scene, game.camera);
  game.renderFrame = () => post!.composer.render();
  ui.game = game;
  ui.buildHUD();
  setQuality(quality);
  resize();
  ui.refresh();
  title.querySelector('.status')!.textContent = loaded.status === 'loaded' ? 'Your journal is waiting where you left it.' : loaded.status === 'corrupt' ? 'Your old save could not be read, so a fresh day begins.' : 'A sunny day for discovery!';
  const row = title.querySelector('.row')!; row.classList.remove('hidden');
  const cont = title.querySelector('.cont') as HTMLButtonElement, nd = title.querySelector('.nd') as HTMLButtonElement;
  if (loaded.status === 'loaded') { cont.textContent = 'Continue Day'; nd.classList.remove('hidden'); }
  const begin = () => { unlockAudio(); title.remove(); ui.overlay = 'none'; started = true; game.paused = false; syncBlocking(); ui.message('Looks like a sunny day for discovery!'); };
  cont.addEventListener('click', begin);
  nd.addEventListener('click', () => { newDay(); begin(); });
  game.paused = true;
  requestAnimationFrame(loop);
  // dev-only inspection hooks (stripped from normal progression)
  // read-only inspection snapshot (no mutation) for automated validation of production builds
  if (new URLSearchParams(location.search).has('inspect') || import.meta.env.DEV) {
    (window as any).__ppState = () => JSON.parse(JSON.stringify({
      player: [game.explorer.pos.x, game.explorer.pos.z], facing: game.explorer.facing, mode: game.mode, overlay: ui.overlay, action: game.action?.kind ?? null,
      selected: game.selected?.eid ?? null, comps: game.comps.map(c => ({ id: c.id, pos: [c.actor.pos.x, c.actor.pos.z], state: c.state })),
      creatures: game.creatures.map(c => ({ eid: c.eid, species: c.species, pos: [c.actor.pos.x, c.actor.pos.z] })),
      fruitsVisible: [...game.fruits].filter(([, m]) => m.visible).map(([id, m]) => ({ id, pos: [m.position.x, m.position.z] })),
      state: { ...game.state, photos: Object.keys(game.state.photos) }, fps: (window as any).__fps, started,
      sceneObjects: game.scene.children.length,
    }));
  }
  if (import.meta.env.DEV) {
    (window as any).__pp = { game, ui, renderer, THREE, persist, begin, newDay, input, post };
    const qp = new URLSearchParams(location.search);
    if (qp.has('nopause')) (window as any).__noAutoPause = true;
    if (qp.has('fresh')) newDay();
    if (qp.has('autostart')) begin();
  }
}

function newDay() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  game.state = newGame();
  game.clearParticles();
  game.resetPositions();
  pausedByUser = false;
  ui.close(); syncBlocking();
  ui.refresh(); persist();
  ui.message('A brand-new Meadow Discovery Day begins!', 'good');
}

// ---------------------------------------------------------------- keys
addEventListener('keydown', e => {
  if (!started) { if (e.code === 'Enter' || e.code === 'Space') (document.querySelector('#title .cont') as HTMLButtonElement | null)?.click(); return; }
  unlockAudio();
  if (e.code === 'Escape') {
    if (game.mode === 'photo') { game.exitPhoto(); return; }
    if (ui.overlay !== 'none') { ui.close(); pausedByUser = false; syncBlocking(); return; }
    pausedByUser = true; ui.showPause(audio.muted, audio.musicVol, audio.sfxVol, quality); syncBlocking(); return;
  }
  if (ui.overlay === 'journal' && e.code === 'KeyJ') { ui.toggleJournal(); syncBlocking(); return; }
  if (ui.overlay === 'map' && e.code === 'KeyM') { ui.toggleMap(); syncBlocking(); return; }
  if (ui.overlay !== 'none') return;
  if (e.code === 'KeyH') { document.body.classList.toggle('hud-hidden'); return; }
  if (game.mode === 'photo') {
    if (e.code === 'Space' || e.code === 'Enter') game.shutter(renderer);
    if (e.code === 'Digit3') game.exitPhoto();
    return;
  }
  switch (e.code) {
    case 'KeyE': game.interact(); break;
    case 'Tab': game.cycleTarget(); break;
    case 'Digit1': game.doAction('observe'); break;
    case 'Digit2': game.doAction('offer'); break;
    case 'Digit3': game.doAction('photo'); break;
    case 'Digit4': game.doAction('befriend'); break;
    case 'KeyF': game.playFlute(); break;
    case 'KeyJ': ui.toggleJournal(); syncBlocking(); break;
    case 'KeyM': ui.toggleMap(); syncBlocking(); break;
  }
});
// photo mode mouse: drag to aim, click to shoot, wheel to zoom (no pointer lock needed)
let drag: { x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', e => { if (game?.mode === 'photo') drag = { x: e.clientX, y: e.clientY, moved: false }; });
addEventListener('pointermove', e => {
  if (!drag || game.mode !== 'photo') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  game.photoYaw -= dx * 0.004; game.photoPitch = Math.max(-0.6, Math.min(0.5, game.photoPitch - dy * 0.004));
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', () => { if (drag && !drag.moved && game.mode === 'photo') game.shutter(renderer); drag = null; });
canvas.addEventListener('wheel', e => { if (game?.mode === 'photo') { game.photoFov = Math.max(16, Math.min(55, game.photoFov + Math.sign(e.deltaY) * 3)); e.preventDefault(); } }, { passive: false });

// pause on visibility change; bounded accumulator avoids simulating missed minutes
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && ui.overlay === 'none' && !(window as any).__noAutoPause) { pausedByUser = true; ui.showPause(audio.muted, audio.musicVol, audio.sfxVol, quality); syncBlocking(); persist(); }
  if (audio.ctx) { if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume(); }
});
addEventListener('beforeunload', () => persist());

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
(window as any).__fps = 0;
function loop(now: number) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25; // bounded accumulator after focus loss
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 8) { game.step(STEP); acc -= STEP; steps++; }
  if (steps >= 8) acc = 0;
  if (!started) { game.time += dt; } // gentle title idle
  game.render(acc / STEP);
  if (post) { post.grade.uniforms.uTime.value = now / 1000; post.composer.render(); } else renderer.render(game.scene, game.camera);
  ui.frame(dt);
  fpsN++; fpsT += dt; if (fpsT > 1) { (window as any).__fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
}

boot();
