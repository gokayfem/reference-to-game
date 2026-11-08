import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './ui/style.css';
import * as THREE from 'three';
import { Stage } from './world/stage';
import { BoardView } from './world/boardView';
import { LEVELS, LEVEL_SUBTITLES, type LevelDef, type NodeDef } from './game/levels';
import { LayoutEditor, DEFAULT_ORIENT, PLACE_KIND, rotateOrient, flipOrient, starsFor, type Tool, type Orientation } from './game/editor';
import { Simulation, STEP } from './game/sim';
import { loadSave, writeSave, recordCompletion, type SaveData } from './game/progress';
import { AudioManager } from './core/audio';
import { Hud } from './ui/hud';

type Mode = 'title' | 'build' | 'run' | 'complete';

class Game {
  stage: Stage;
  hud: Hud;
  audio = new AudioManager();
  save: SaveData = loadSave();
  levelIndex = 0;
  level!: LevelDef;
  editor!: LayoutEditor;
  sim: Simulation | null = null;
  board: BoardView | null = null;
  mode: Mode = 'title';
  paused = false;
  tool: Tool = 'belt';
  orient: Orientation = DEFAULT_ORIENT.straight;
  hover: [number, number] | null = null;
  private acc = 0;
  private last = performance.now();
  private t = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerInside = false;
  private flash: { text: string; bad: boolean; until: number } | null = null;
  fps = 60;
  private avgDt = 1 / 60;
  adaptTier = 0;
  private slowTime = 0;
  get adapted() { return this.adaptTier > 0; }
  set adapted(v: boolean) { if (v) this.adaptTier = 3; } // dev hook: freeze adaptation for measurements
  applyAdaptTier(t: number) {
    this.adaptTier = t;
    if (t >= 1) this.stage.ao.enabled = false;
    if (t >= 2) {
      this.stage.bloom.enabled = false;
      this.board?.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
        if (m && m.transmission > 0) { m.transmission = 0; m.emissiveIntensity = 1.6; m.needsUpdate = true; }
      });
    }
    if (t >= 3) this.stage.setResolutionScale(0.8);
  }

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.stage = new Stage(canvas);
    this.stage.setQuality(this.save.settings.quality);
    this.hud = new Hud(this);
    this.audio.muted = this.save.settings.muted;
    this.audio.musicVol = this.save.settings.music;
    this.audio.sfxVol = this.save.settings.sfx;
    window.addEventListener('resize', () => this.stage.resize());
    this.bindInput(canvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.audio.suspend(); } else { this.audio.resume(); this.last = performance.now(); this.acc = 0; }
    });
    window.addEventListener('blur', () => { this.keys.clear(); });
    this.loadLevel(0, false);
    requestAnimationFrame(this.frame);
  }

  keys = new Set<string>();

  async boot() {
    const loader = new THREE.TextureLoader();
    let texDone = 0, audDone = 0;
    const progress = () => this.hud.setLoading(Math.round(((texDone + audDone) / 2) * 100));
    try {
      const [tex] = await Promise.all([
        loader.loadAsync('assets/textures/room-backdrop.jpg').then((t) => { texDone = 1; progress(); return t; }),
        this.audio.preload((p) => { audDone = p; progress(); }),
        document.fonts?.ready,
      ]);
      this.stage.setBackdrop(tex);
      if (this.board) this.board.setLayout(this.editor.nodes()); // re-render canvas labels after font load
      this.hud.ready();
    } catch (e) {
      this.hud.error(`Could not load essential assets (${(e as Error).message}). Check that the assets/ folder is served next to index.html.`);
    }
  }

  // ---------- level lifecycle ----------
  loadLevel(i: number, enter = true) {
    this.levelIndex = i;
    this.level = LEVELS[i];
    this.editor = new LayoutEditor(this.level);
    this.repairHint = null;
    this.sim = null;
    this.paused = false;
    if (this.board) {
      this.stage.scene.remove(this.board.root);
      disposeTree(this.board.root);
    }
    this.board = new BoardView(this.level, this.save.settings.quality);
    this.board.setLayout(this.editor.nodes());
    this.stage.scene.add(this.board.root);
    this.stage.setBoardExtent(this.board.extent());
    this.setTool('belt');
    if (enter) this.mode = 'build';
    this.hud.refresh();
  }

  restartLevel() { this.loadLevel(this.levelIndex); this.audio.setBelt(false); }

  startRun() {
    if (this.mode !== 'build') return;
    this.sim = new Simulation(this.level, this.editor.nodes());
    this.board!.resetBins();
    this.mode = 'run';
    this.paused = false;
    this.acc = 0;
    this.board!.setGhost(null, true);
    this.board!.showHover(null, true);
    this.audio.setBelt(true);
    this.audio.play('ui-click');
    this.hud.refresh();
  }

  stopRun() {
    if (this.mode !== 'run' && this.mode !== 'complete') return;
    this.repairHint = this.sim && this.mode === 'run' ? this.findRepairHint() : null;
    this.sim = null; // in-flight candy and counts for this attempt are discarded
    this.board!.resetBins();
    this.mode = 'build';
    this.paused = false;
    this.audio.setBelt(false);
    this.audio.play('ui-click');
    this.hud.hideComplete();
    this.hud.refresh();
  }

  /** Where the last attempt jammed, translated into a concrete build hint (like the reference's ROTATE TO CONNECT pill). */
  repairHint: { cell: [number, number]; text: string } | null = null;
  private findRepairHint(): { cell: [number, number]; text: string } | null {
    const n = this.board!.blockedNodes(this.sim!)[0];
    if (!n) return null;
    const d = n.def.outputs[0];
    const [dc, dr] = ({ N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as Record<string, [number, number]>)[d];
    const next: [number, number] = [n.def.cell[0] + dc, n.def.cell[1] + dr];
    const target = this.editor.at(...next);
    if (!target) return { cell: next, text: 'Place a belt to connect' };
    if (!target.fixed && n.blockedReason?.startsWith('No input port')) return { cell: next, text: 'Rotate to connect' };
    return { cell: n.def.cell, text: n.blockedReason ?? 'Jammed here' };
  }

  togglePause() {
    if (this.mode !== 'run') return;
    this.paused = !this.paused;
    this.audio.setBelt(!this.paused);
    this.hud.refresh();
  }

  setTool(t: Tool) {
    this.tool = t;
    const kind = PLACE_KIND[t];
    if (kind) this.orient = { ...DEFAULT_ORIENT[kind] };
    this.hud.refresh();
    this.updateHover();
  }

  // ---------- editing ----------
  private ghostDef(): NodeDef | null {
    if (!this.hover) return null;
    const kind = PLACE_KIND[this.tool];
    if (!kind) return null;
    return { id: 'ghost', kind, cell: [...this.hover] as [number, number], inputs: this.orient.inputs, outputs: this.orient.outputs, fixed: false };
  }

  updateHover() {
    const b = this.board;
    if (!b) return;
    if (this.mode !== 'build' || !this.hover) {
      b.showHover(null, true); b.setGhost(null, true); this.hud.setTip(null); return;
    }
    const [c, r] = this.hover;
    const cur = this.editor.at(c, r);
    if (this.tool === 'mix' || this.tool === 'mold') {
      b.setGhost(null, true);
      const isTarget = cur && (this.tool === 'mix' ? cur.kind === 'mixer' : cur.kind === 'star_press' || cur.kind === 'cube_press');
      b.showHover([c, r], !!isTarget);
      this.hud.setTip(isTarget ? { text: 'Click to inspect recipe', bad: false, cell: [c, r] } : null);
      return;
    }
    const res = this.editor.check(this.tool, c, r, this.orient);
    b.showHover([c, r], res.ok);
    const ghost = this.ghostDef();
    const showGhost = ghost && !(cur && cur.fixed);
    b.setGhost(showGhost ? ghost : null, res.ok);
    let text: string;
    if (!res.ok) text = res.reason!;
    else if (this.tool === 'erase') text = 'Erase — costs 1 move';
    else if (res.cost === 0) text = 'Rotate to connect — R (1 move)';
    else if (cur && !cur.fixed) text = `Replace with ${this.tool} · R rotates it`;
    else text = `Place ${this.tool} · R turns ghost${this.tool === 'turn' ? ' · F mirrors' : ''}`;
    this.hud.setTip({ text, bad: !res.ok, cell: [c, r] });
  }

  click() {
    if (this.mode !== 'build' || !this.hover) return;
    const [c, r] = this.hover;
    if (this.tool === 'mix' || this.tool === 'mold') {
      const n = this.editor.at(c, r);
      if (n && !['straight', 'turn', 'split', 'merge'].includes(n.kind)) this.hud.inspect(n);
      else this.hud.inspect(null);
      this.audio.play('ui-click');
      return;
    }
    const res = this.editor.apply(this.tool, c, r, this.orient);
    this.afterEdit(res.ok, res.cost, res.reason);
  }

  rotateAction(cw: boolean) {
    if (this.mode !== 'build') return;
    const cur = this.hover ? this.editor.at(...this.hover) : null;
    if (cur && !cur.fixed && this.hover) {
      const res = this.editor.rotate(this.hover[0], this.hover[1], cw);
      this.afterEdit(res.ok, res.cost, res.reason);
    } else if (cur?.fixed) {
      this.afterEdit(false, 0, 'Fixed machine — it cannot be rotated');
    } else {
      this.orient = rotateOrient(this.orient, cw); // rotating the placement ghost is free
      this.audio.play('ui-click', { rate: 1.3 });
      this.updateHover();
    }
  }

  flipAction() {
    if (this.mode !== 'build') return;
    const cur = this.hover ? this.editor.at(...this.hover) : null;
    if (cur && !cur.fixed && this.hover) {
      const res = this.editor.flip(this.hover[0], this.hover[1]);
      this.afterEdit(res.ok, res.cost, res.reason);
    } else if (this.tool === 'turn') { this.orient = flipOrient(this.orient); this.updateHover(); }
  }

  undo() { if (this.mode === 'build' && this.editor.undo()) this.afterEdit(true, 1); }
  redo() { if (this.mode === 'build' && this.editor.redo()) this.afterEdit(true, 1); }

  private afterEdit(ok: boolean, cost: number, reason?: string) {
    if (ok && cost > 0) {
      this.repairHint = null;
      this.board!.setLayout(this.editor.nodes());
      this.audio.play('place-module', { rate: 0.95 + Math.random() * 0.1 });
    } else if (!ok) {
      this.audio.play('error-blocked', { vol: 0.7 });
      this.showFlash(reason ?? 'Not allowed', true);
    }
    this.updateHover();
    this.hud.refresh();
  }

  showFlash(text: string, bad: boolean) { this.flash = { text, bad, until: performance.now() + 1800 }; }

  // ---------- input ----------
  private bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointermove', (e) => { this.pointerInside = true; this.pick(e.clientX, e.clientY); });
    canvas.addEventListener('pointerleave', () => { this.pointerInside = false; this.hover = null; this.updateHover(); });
    canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'title') return;
      this.pick(e.clientX, e.clientY);
      if (e.button === 0) this.click();
      else if (e.button === 2) this.rotateAction(true);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'title') return;
      this.keys.add(e.code);
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (k === 'r') this.rotateAction(!e.shiftKey);
      else if (k === 'q') this.rotateAction(false);
      else if (k === 'f') this.flipAction();
      else if (k === ' ') { e.preventDefault(); if (this.mode === 'build') this.startRun(); else this.stopRun(); }
      else if (k === 'p') this.togglePause();
      else if (k === 'h') document.body.classList.toggle('hide-hud');
      else if (k === 'escape') { if (this.hud.settingsOpen()) this.hud.closeSettings(); else this.hud.openSettings(); }
      else if (/^[1-7]$/.test(k)) this.setTool((['belt', 'turn', 'split', 'merge', 'mix', 'mold', 'erase'] as Tool[])[+k - 1]);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  private pick(x: number, y: number) {
    if (!this.board) return;
    this.ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const p = new THREE.Vector3();
    let cell: [number, number] | null = null;
    if (this.raycaster.ray.intersectPlane(this.board.plane, p)) {
      const [c, r] = this.board.cellAt(p);
      const margin = 0.5;
      if (c >= -margin && r >= -margin && c < this.level.size[0] + margin && r < this.level.size[1] + margin) cell = [c, r];
    }
    const changed = cell?.[0] !== this.hover?.[0] || cell?.[1] !== this.hover?.[1];
    this.hover = cell;
    if (changed) this.updateHover();
  }

  cellToScreen(c: number, r: number, y = 0.9) {
    const v = this.board!.cellCenter(c, r).setY(y).project(this.stage.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  // ---------- loop ----------
  frame = (now: number) => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    this.avgDt = this.avgDt * 0.95 + Math.min(dt, 0.25) * 0.05; // average frame time (not average of rates)
    this.fps = 1 / Math.max(this.avgDt, 1e-3);
    // tiered adaptive quality: sustained < 54 fps while running sheds one costly effect at a time
    // (1: AO, 2: bloom + candy transmission, 3: 0.8x resolution + smaller shadow map). Never steps back up.
    if (this.mode === 'run' && !document.hidden && !this.paused && this.adaptTier < 3) {
      this.slowTime = this.fps < 54 ? this.slowTime + Math.min(dt, 0.1) : Math.max(0, this.slowTime - Math.min(dt, 0.1) * 0.5);
      if (this.slowTime > 3) { this.slowTime = 0; this.applyAdaptTier(this.adaptTier + 1); }
    }
    dt = Math.min(dt, 0.25); // bounded accumulator after focus loss
    this.t += dt;
    if (this.mode === 'run' && this.sim && !this.paused && !document.hidden) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 20) {
        this.sim.step();
        this.handleEvents();
        this.acc -= STEP; steps++;
        if (this.sim.complete) break;
      }
    }
    const alpha = this.mode === 'run' && !this.paused ? this.acc / STEP : 0;
    this.board?.update(this.sim, this.editor.nodes(), alpha, this.t, this.mode === 'run' || this.mode === 'complete');
    if (this.flash && now > this.flash.until) this.flash = null;
    this.hud.frame(this.flash);
    this.stage.render();
  };

  private handleEvents() {
    const sim = this.sim!;
    for (const e of sim.events) {
      switch (e.type) {
        case 'deliver': this.audio.play('gummy-drop', { rate: 0.92 + (e.count % 5) * 0.04, vol: 0.9 }); this.hud.refresh(); this.hud.bump(e.node); break;
        case 'consume': {
          const k = sim.byId.get(e.node)?.def.kind;
          if (k === 'mixer') this.audio.play('mixer-whir', { vol: 0.6 });
          else if (k === 'cooler') this.audio.play('cooler-hiss', { vol: 0.55 });
          else this.audio.play('press-clunk', { vol: 0.75, minGap: 0.15 });
          break;
        }
        case 'jam': this.audio.play('error-blocked', { vol: 0.45, minGap: 1.5 }); break;
        case 'complete': this.onComplete(); break;
      }
    }
  }

  private onComplete() {
    this.mode = 'complete';
    this.audio.setBelt(false);
    this.audio.play('factory-complete');
    this.board!.celebrate();
    const stars = starsFor(this.level, this.editor.movesUsed);
    recordCompletion(this.save, this.level.id, stars, this.editor.movesUsed);
    writeSave(this.save);
    this.hud.refresh();
    setTimeout(() => this.hud.showComplete(stars), 1700);
  }

  persistSettings() { writeSave(this.save); }

  // dev-only inspection hooks (stripped from normal player UI)
  debugState() {
    return {
      mode: this.mode, level: this.level.id, moves: this.editor.movesUsed, paused: this.paused, tool: this.tool,
      goals: Object.fromEntries(Object.keys(this.level.goals).map((g) => [g, this.sim?.goalCount(g) ?? 0])),
      adaptTier: this.adaptTier, simTime: this.sim?.time ?? 0, complete: this.sim?.complete ?? false, fps: Math.round(this.fps),
      blocked: this.sim ? this.board!.blockedNodes(this.sim).map((n) => `${n.def.id}: ${n.blockedReason}`) : [],
      save: this.save,
    };
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose();
    if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
  });
}

const game = new Game();
game.boot();
(window as unknown as { __jelly: unknown }).__jelly = {
  state: () => game.debugState(),
  cellToScreen: (c: number, r: number) => game.cellToScreen(c, r, 0.2),
  ...(import.meta.env.DEV ? {
    game,
    swapGlb: async (kind: string, file: string, scale = 1.1) => { // dev-only A/B of fal models vs procedural housings
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(file);
      const node = game.level.initialLayout.find((n) => n.kind === kind)!;
      const grp = game.board!.machineGroup(node.id)!;
      grp.clear();
      gltf.scene.scale.setScalar(scale);
      gltf.scene.traverse((o) => { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; });
      grp.add(gltf.scene);
    },
    loadSolved: () => { // dev-only fixture for automated checks; never exposed in the player UI
      game.editor = new LayoutEditor(game.level, game.level.solvedLayout);
      game.board!.setLayout(game.editor.nodes());
      game.hud.refresh();
    },
  } : {}),
};
export type { Game };
