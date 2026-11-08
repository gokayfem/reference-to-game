import type { Game } from '../main';
import { LEVELS, LEVEL_SUBTITLES, recipeSeconds, type NodeDef } from '../game/levels';
import { starsFor, type Tool } from '../game/editor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STAR = 'assets/ui/icon-star.png';

const GOAL_META = (id: string, def: NodeDef | undefined) => {
  const star = def?.accepts?.shape === 'star';
  const suffix = id.endsWith('-a') ? ' A' : id.endsWith('-b') ? ' B' : '';
  return { label: (star ? 'ORANGE STARS' : 'BLUE CUBES') + suffix, icon: star ? 'assets/ui/icon-orange-star.png' : 'assets/ui/icon-blue-cube.png', cls: star ? 'orange' : 'blue' };
};

const RECIPES: Record<string, { title: string; body: string }> = {
  mixer: { title: 'MIXER', body: `Takes one RED gummy and one YELLOW gummy from its two separate input ports and makes one ORANGE gummy after ${recipeSeconds('mix-orange')} s. It waits if either ingredient is missing.` },
  star_press: { title: 'STAR MOLD', body: `Presses one ORANGE gummy into one ORANGE STAR in ${recipeSeconds('star')} s. Any other candy waits at its input.` },
  cube_press: { title: 'CUBE MOLD', body: `Presses one COOLED blue gummy into one BLUE CUBE in ${recipeSeconds('cube')} s. Warm blue is blocked — route it through the cooler first.` },
  cooler: { title: 'COOLER', body: `Chills one warm BLUE gummy for ${recipeSeconds('cool')} s so the cube mold can shape it.` },
  source: { title: 'HOPPER', body: 'Drops one warm gummy onto its output belt every 1.2 s while there is space.' },
  bin: { title: 'COLLECTION BIN', body: 'Counts each matching finished candy once. A full bin stops accepting candy.' },
};

export class Hud {
  private tip = $('tip');
  private tipText = $('tipText');
  private tipState: { text: string; bad: boolean; cell: [number, number] } | null = null;
  private loaded = false;
  private selectedLevel = 0;

  constructor(private g: Game) {
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.addEventListener('click', () => { g.audio.play('ui-click'); g.setTool(b.dataset.tool as Tool); }));
    $('runBtn').addEventListener('click', () => { if (g.mode === 'build') g.startRun(); else g.stopRun(); });
    $('resetBtn').addEventListener('click', () => { if (g.mode === 'run') g.togglePause(); else { g.audio.play('ui-click'); g.restartLevel(); } });
    $('undoBtn').addEventListener('click', () => g.undo());
    $('redoBtn').addEventListener('click', () => g.redo());
    $('gearBtn').addEventListener('click', () => this.openSettings());
    $('titlePlaque').addEventListener('click', () => this.showTitle());
    $('closeSet').addEventListener('click', () => this.closeSettings());
    $('restartBtn').addEventListener('click', () => { this.closeSettings(); g.restartLevel(); });
    $('setLevelsBtn').addEventListener('click', () => { this.closeSettings(); this.showTitle(); });
    $('replayBtn').addEventListener('click', () => { this.hideComplete(); g.restartLevel(); });
    $('levelsBtn').addEventListener('click', () => { this.hideComplete(); this.showTitle(); });
    $('nextBtn').addEventListener('click', () => { this.hideComplete(); g.loadLevel((g.levelIndex + 1) % LEVELS.length); });
    $('playBtn').addEventListener('click', () => this.enterLevel(this.selectedLevel));
    const s = g.save.settings;
    const mv = $<HTMLInputElement>('musicVol'), sv = $<HTMLInputElement>('sfxVol'), mc = $<HTMLInputElement>('muteChk'), qs = $<HTMLSelectElement>('qualitySel');
    mv.value = String(s.music); sv.value = String(s.sfx); mc.checked = s.muted; qs.value = s.quality;
    mv.addEventListener('input', () => { s.music = g.audio.musicVol = +mv.value; g.audio.apply(); g.persistSettings(); });
    sv.addEventListener('input', () => { s.sfx = g.audio.sfxVol = +sv.value; g.audio.apply(); g.persistSettings(); });
    mc.addEventListener('change', () => { s.muted = g.audio.muted = mc.checked; g.audio.apply(); g.persistSettings(); });
    qs.addEventListener('change', () => {
      s.quality = qs.value as 'high' | 'low'; g.persistSettings();
      g.stage.setQuality(s.quality);
      if (g.adaptTier) g.applyAdaptTier(g.adaptTier);
      const wasRun = g.mode;
      g.loadLevel(g.levelIndex, wasRun !== 'title');
    });
    this.renderLevelCards();
  }

  setLoading(pct: number) { $('loadPct').textContent = `${pct}%`; }
  ready() { this.loaded = true; $('loading').classList.add('hidden'); $('playBtn').classList.remove('hidden'); }
  error(msg: string) { $('errorText').textContent = msg; $('error').classList.remove('hidden'); }

  private renderLevelCards() {
    const wrap = $('levelCards');
    wrap.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const rec = this.g.save.levels[L.id];
      const b = document.createElement('button');
      b.className = 'lvl' + (i === this.selectedLevel ? ' sel' : '');
      b.innerHTML = `<div class="n">LEVEL ${i + 1}</div><div class="nm">${L.name}</div><div class="d">${LEVEL_SUBTITLES[L.id] ?? ''}</div>
        <div class="stars">${[0, 1, 2].map((k) => `<img src="${STAR}" class="${(rec?.stars ?? 0) > k ? '' : 'off'}" alt="" />`).join('')}</div>
        <div class="best">${rec ? `Best: ${rec.bestMoves} move${rec.bestMoves === 1 ? '' : 's'}` : 'Not completed'}</div>`;
      b.addEventListener('click', () => { this.selectedLevel = i; this.g.audio.play('ui-click'); if (this.loaded) this.enterLevel(i); else this.renderLevelCards(); });
      b.addEventListener('dblclick', () => this.enterLevel(i));
      wrap.appendChild(b);
    });
  }

  async enterLevel(i: number) {
    await this.g.audio.unlock(); // audio unlocked from the user gesture
    this.g.audio.apply();
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.g.loadLevel(i);
  }

  showTitle() {
    if (this.g.mode === 'run' || this.g.mode === 'complete') this.g.stopRun();
    this.g.mode = 'title';
    this.selectedLevel = this.g.levelIndex;
    this.renderLevelCards();
    $('hud').classList.add('hidden');
    $('title').classList.remove('hidden');
  }

  openSettings() { if (this.g.mode === 'run' && !this.g.paused) this.g.togglePause(); $('settings').classList.remove('hidden'); }
  closeSettings() { $('settings').classList.add('hidden'); }
  settingsOpen() { return !$('settings').classList.contains('hidden'); }

  showComplete(stars: number) {
    const el = $('doneStars');
    el.innerHTML = [0, 1, 2].map((k) => `<img src="${STAR}" class="${stars > k ? '' : 'off'}" alt="" />`).join('');
    const L = this.g.level, used = this.g.editor.movesUsed, sol = L.knownSolution.length;
    $('doneText').textContent = `${L.name} solved in ${used} move${used === 1 ? '' : 's'} (reference solution: ${sol}; not proven optimal).`;
    $('nextBtn').textContent = this.g.levelIndex === LEVELS.length - 1 ? 'BACK TO LEVEL 1' : 'NEXT PUZZLE';
    $('complete').classList.remove('hidden');
  }
  hideComplete() { $('complete').classList.add('hidden'); }

  inspect(n: NodeDef | null) {
    const el = $('inspect');
    if (!n) { el.classList.add('hidden'); return; }
    const r = RECIPES[n.kind];
    el.innerHTML = `<h3>${r.title}</h3><div>${r.body}</div><div class="fixed">FIXED POSITION IN THIS PUZZLE</div>`;
    el.classList.remove('hidden');
  }

  /** Tactile pulse on a goal card when a matching candy is delivered. */
  bump(goalId: string) {
    const el = document.querySelector<HTMLElement>(`[data-goal="${goalId}"]`);
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  setTip(t: { text: string; bad: boolean; cell: [number, number] } | null) { this.tipState = t; }

  /** All values below derive from game state each refresh. */
  refresh() {
    const g = this.g;
    const L = g.level, ed = g.editor;
    $('levelNum').textContent = String(g.levelIndex + 1);
    $('levelName').textContent = L.name;
    const mv = $('movesVal');
    mv.textContent = `${ed.movesUsed} / ${ed.budget}`;
    mv.classList.toggle('warn', ed.movesLeft === 0);
    ($('undoBtn') as HTMLButtonElement).disabled = g.mode !== 'build' || ed.undoStack.length === 0;
    ($('redoBtn') as HTMLButtonElement).disabled = g.mode !== 'build' || ed.redoStack.length === 0;
    const proj = starsFor(L, ed.movesUsed);
    $('projStars').innerHTML = [0, 1, 2].map((k) => `<img src="${STAR}" class="${proj > k ? '' : 'off'}" alt="" />`).join('');
    // goals
    const list = $('goalList');
    const want = Object.keys(L.goals);
    if (list.dataset.level !== L.id) {
      list.dataset.level = L.id;
      list.innerHTML = want.map((id) => {
        const m = GOAL_META(id, L.initialLayout.find((n) => n.id === id));
        return `<div class="goal ${m.cls}" data-goal="${id}"><img src="${m.icon}" alt="" /><div class="gl"><span>${m.label}</span><b></b></div><div class="bar"><i></i></div></div>`;
      }).join('');
    }
    for (const id of want) {
      const el = list.querySelector<HTMLElement>(`[data-goal="${id}"]`)!;
      const n = g.sim?.goalCount(id) ?? 0, goal = L.goals[id];
      el.querySelector('b')!.innerHTML = `<em>${n}</em> / ${goal}`;
      (el.querySelector('.bar i') as HTMLElement).style.width = `${(n / goal) * 100}%`;
      el.classList.toggle('done', n >= goal);
    }
    // toolbar
    const building = g.mode === 'build';
    document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === g.tool);
      b.classList.toggle('inspecty', b.dataset.tool === 'mix' || b.dataset.tool === 'mold');
      b.disabled = !building;
    });
    const run = $('runBtn');
    run.classList.toggle('stop', !building);
    $('runLbl').innerHTML = building ? 'RUN<br/>FACTORY' : 'STOP &amp;<br/>EDIT';
    $('resetLbl').textContent = g.mode === 'run' ? (g.paused ? 'RESUME' : 'PAUSE') : 'RESET';
    if (!building) { this.inspect(null); this.tipState = null; }
  }

  /** Per-frame: tooltip placement and run-status pill. */
  frame(flash: { text: string; bad: boolean } | null) {
    const g = this.g;
    const st = $('statusPill');
    let status: { text: string; bad: boolean } | null = flash;
    let tip = this.tipState;
    if (!tip && g.mode === 'build' && g.repairHint) tip = { text: g.repairHint.text, bad: false, cell: g.repairHint.cell };
    g.board?.showHint(g.mode === 'build' && g.repairHint ? g.repairHint.cell : null, performance.now() / 1000);
    if (g.mode === 'run' && g.sim) {
      const blocked = g.board!.blockedNodes(g.sim);
      if (blocked.length) {
        const n = blocked[0];
        tip = { text: n.blockedReason!, bad: true, cell: n.def.cell };
        status = status ?? { text: `JAM — ${blocked.length} blocked. Press STOP & EDIT to repair.`, bad: true };
      } else if (g.paused) status = status ?? { text: 'PAUSED', bad: false };
      else status = status ?? { text: 'Factory running…', bad: false };
    }
    if (status && g.mode !== 'title') { st.textContent = status.text; st.classList.toggle('bad', status.bad); st.classList.remove('hidden'); }
    else st.classList.add('hidden');
    if (tip && g.mode !== 'title' && g.mode !== 'complete') {
      const p = g.cellToScreen(tip.cell[0], tip.cell[1], 1.35);
      this.tip.style.left = `${p.x}px`; this.tip.style.top = `${p.y}px`;
      this.tipText.textContent = tip.text.toUpperCase();
      this.tip.classList.toggle('bad', tip.bad);
      this.tip.classList.remove('hidden');
    } else this.tip.classList.add('hidden');
  }
}
