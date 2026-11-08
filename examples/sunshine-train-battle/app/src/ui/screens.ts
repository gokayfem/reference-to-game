import type { Settings } from '../core/save';

export type ScreenId = 'loading' | 'title' | 'pause' | 'dead' | 'won' | 'error';

const CONTROLS = `<div class="controls">
  <b>WASD</b><span>Move</span><b>Mouse</b><span>Look</span><b>Left click</b><span>Fire (hold)</span><b>R</b><span>Reload</span>
  <b>Space</b><span>Jump</span><b>Shift</b><span>Brief sprint</span><b>Q (hold)</b><span>Defensive shield</span><b>M</b><span>Route map</span><b>Esc</b><span>Pause</span></div>`;

function settingsHtml(s: Settings) {
  return `<div class="settings">
    <label>Volume</label><input type="range" data-k="volume" min="0" max="1" step="0.05" value="${s.volume}">
    <label>Music</label><input type="range" data-k="music" min="0" max="1" step="0.05" value="${s.music}">
    <label>Effects</label><input type="range" data-k="sfx" min="0" max="1" step="0.05" value="${s.sfx}">
    <label>Camera shake</label><input type="range" data-k="shake" min="0" max="1" step="0.05" value="${s.shake}">
    <label>Mouse sensitivity</label><input type="range" data-k="sens" min="0.3" max="2.5" step="0.05" value="${s.sens}">
    <label>Quality</label><select data-k="quality"><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High</option><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low (faster)</option></select>
  </div>`;
}

export class Screens {
  root: HTMLElement;
  current: ScreenId | null = null;
  onAction: (a: string) => void = () => {};
  onSetting: (k: keyof Settings, v: number | string) => void = () => {};

  constructor(parent: HTMLElement) { this.root = document.createElement('div'); parent.appendChild(this.root); }

  hide() { this.root.innerHTML = ''; this.current = null; }

  show(id: ScreenId, data: Record<string, any> = {}) {
    this.current = id;
    let html = '';
    if (id === 'loading') html = `<div class="panel loading"><h1>SUNSHINE <em>TRAIN</em> BATTLE</h1><div class="tag">Loading the train…</div><div class="bar"><i id="loadbar"></i></div></div>`;
    if (id === 'error') html = `<div class="panel"><h2>COULD NOT LOAD</h2><div class="tag">${data.msg ?? 'An asset failed to load.'}</div><button class="btn" data-a="reload">TRY AGAIN</button></div>`;
    if (id === 'title') html = `<div class="panel"><h1>SUNSHINE <em>TRAIN</em> BATTLE</h1><div class="tag">Fight across six cars of a speeding train and reach the engine.</div>
      <button class="btn" data-a="play">PLAY</button>${CONTROLS}${settingsHtml(data.settings)}
      <div class="best">${data.best ? `Best completed score: ${data.best}` : 'No completed run yet'}</div><div class="note" id="note"></div></div>`;
    if (id === 'pause') html = `<div class="panel"><h2>PAUSED</h2><button class="btn" data-a="resume">RESUME</button><button class="btn alt" data-a="restart">RESTART RUN</button><button class="btn alt" data-a="mute">${data.muted ? 'UNMUTE' : 'MUTE'}</button>
      ${CONTROLS}${settingsHtml(data.settings)}<div class="note" id="note">${data.note ?? ''}</div></div>`;
    if (id === 'dead') html = `<div class="panel"><h2>KNOCKED DOWN!</h2><div class="tag">The robots got the better of you this time.<br>Retry restores the last cleared car — enemies, loot and ammo included.</div>
      <button class="btn" data-a="retry">RETRY FROM CHECKPOINT</button><button class="btn alt" data-a="restart">NEW RUN</button><div class="note">Enter = retry</div></div>`;
    if (id === 'won') html = `<div class="panel"><h2>MISSION COMPLETE</h2><div class="crystals"><i class="cb"></i><i class="cc"></i><i class="co"></i></div>
      <div class="stats"><span>Time <b>${data.time}</b></span><span>Crystals <b>${data.crystals}</b></span><span>Accuracy <b>${data.accuracy}</b></span><span>Recoveries <b>${data.recoveries}</b></span>
      <span>Crystal + defeat points <b>${data.score}</b></span><span>Final score <b>${data.final}</b></span></div>
      <button class="btn" data-a="restart">NEXT RUN</button><div class="best">${data.newBest ? 'New best score!' : `Best: ${data.best}`}</div></div>`;
    this.root.innerHTML = `<div class="screen">${html}</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.onAction(b.dataset.a!); }));
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.k as keyof Settings;
      this.onSetting(k, k === 'quality' ? inp.value : Number(inp.value));
    }));
  }

  note(text: string) { const n = this.root.querySelector('#note'); if (n) n.textContent = text; }
  progress(k: number) { const b = this.root.querySelector('#loadbar') as HTMLElement | null; if (b) b.style.width = `${Math.round(k * 100)}%`; }
}
