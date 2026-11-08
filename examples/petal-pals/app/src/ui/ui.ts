import * as THREE from 'three';
import type { Game, ActionKind } from '../game/game';
import { COMPANIONS, HABITATS, HABITAT_ORDER, SPECIES, SPECIES_ORDER, counts, type GameState, type RuleEvent, type SpeciesId } from '../game/state';
import { mapBase, MAP_RANGE, LABELS } from './map';
import world from '../data/world.json';

const ICON = (n: string) => `assets/ui/icon-${n}.webp`;
const PORTRAIT = (s: SpeciesId) => `assets/ui/portrait-${s}.webp`;
const h = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };

export interface UIHooks {
  onAction(k: ActionKind): void;
  onFlute(): void;
  onToggleJournal(): void;
  onToggleMap(): void;
  onPhotoToggle(): void;
  onResume(): void;
  onNewDay(): void;
  onMute(m: boolean): void;
  onVolume(music: number, sfx: number): void;
  onQuality(q: 'low' | 'medium' | 'high'): void;
  onShutter(): void;
  onSetWaypoint(x: number, z: number): void;
  onClearWaypoint(): void;
}

export class UI {
  root = document.getElementById('ui')!;
  game!: Game;
  overlay: 'none' | 'journal' | 'map' | 'pause' | 'complete' | 'title' | 'confirm' = 'title';
  private el: Record<string, HTMLElement> = {};
  private noteTimer = 0;
  private bannerTimer = 0;
  private journalSel: SpeciesId = 'leaflet';
  private mini!: HTMLCanvasElement;
  private lastPhotoTimer = 0;
  goalTarget: [number, number] | null = null;

  constructor(private hooks: UIHooks) {}

  buildHUD() {
    const r = this.root;
    // party cards
    const party = h(`<div id="party"></div>`);
    for (const c of COMPANIONS) {
      party.appendChild(h(`<div class="pal card hit" data-id="${c.id}"><img src="${PORTRAIT(c.species)}" alt="${c.name}"><img class="heart" src="${ICON('heart')}" alt=""><div class="nm"><i>♥</i>${c.name.toUpperCase()}<i>♥</i></div><div class="bar"><b></b></div></div>`));
    }
    r.appendChild(party);
    r.appendChild(h(`<div id="quest" class="card"><h2><img src="${ICON('flower')}" alt="">MEADOW DISCOVERY DAY</h2>
      <div class="q" data-q="species"><span class="box"></span><span class="t"></span></div>
      <div class="q" data-q="habitats"><span class="box"></span><span class="t"></span></div>
      <div class="q" data-q="friends"><span class="box"></span><span class="t"></span></div></div>`));
    r.querySelector('#quest')!.appendChild(h(`<div id="goal"><span class="arrow">➤</span><span class="txt"></span><span class="dist"></span></div>`));
    const mm = h(`<div id="minimap" class="hit" title="Open map (M)"><canvas width="256" height="256"></canvas><div class="n">N</div></div>`);
    mm.addEventListener('click', () => this.hooks.onToggleMap());
    r.appendChild(mm); this.mini = mm.querySelector('canvas')!;
    // interaction panel
    r.appendChild(h(`<div id="interact" class="hidden">
      <div id="species" class="card"><div class="band"></div><div class="sub"></div><div class="portrait"><img alt=""></div><div class="mood"></div><div class="trust"></div></div>
      <div id="actions" class="card hit">
        <button class="act observe" data-a="observe"><div class="top"><img src="${ICON('binoculars')}" alt="">OBSERVE</div><div class="k"><span>1</span></div><div class="prog"><b></b></div></button>
        <button class="act offer" data-a="offer"><div class="top"><img src="${ICON('orange')}" alt="">OFFER FRUIT</div><div class="k"><span>2</span></div></button>
        <button class="act photo" data-a="photo"><div class="top"><img src="${ICON('camera')}" alt="">PHOTOGRAPH</div><div class="k"><span>3</span></div></button>
        <button class="act befriend" data-a="befriend"><div class="top"><img src="${ICON('heart')}" alt="">BEFRIEND</div><div class="k"><span>4</span></div></button>
      </div></div>`));
    r.querySelectorAll<HTMLButtonElement>('.act').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); (b as HTMLElement).blur(); this.hooks.onAction(b.dataset.a as ActionKind); }));
    // hotbar
    const hb = h(`<div id="hotbar" class="card hit">
      <div class="slot hit" data-s="fruit" title="Fruit"><img src="${ICON('orange')}" alt="fruit"><span class="cnt">0</span></div>
      <div class="slot hit" data-s="camera" title="Camera (3)"><span class="key">3</span><img src="${ICON('camera')}" alt="camera"></div>
      <div class="slot hit" data-s="journal" title="Journal (J)"><span class="key">J</span><img src="${ICON('journal')}" alt="journal"></div>
      <div class="slot hit" data-s="flute" title="Flute (F)"><span class="key">F</span><img src="${ICON('flute')}" alt="flute"></div>
      <div class="slot hit" data-s="map" title="Map (M)"><span class="key">M</span><img src="${ICON('map')}" alt="map"></div>
      <div class="slot empty"></div></div>`);
    hb.querySelector('[data-s=camera]')!.addEventListener('click', () => this.hooks.onPhotoToggle());
    hb.querySelector('[data-s=journal]')!.addEventListener('click', () => this.hooks.onToggleJournal());
    hb.querySelector('[data-s=flute]')!.addEventListener('click', () => this.hooks.onFlute());
    hb.querySelector('[data-s=map]')!.addEventListener('click', () => this.hooks.onToggleMap());
    r.appendChild(hb);
    r.appendChild(h(`<div id="note" class="card"><span class="txt">Looks like a sunny day for discovery!</span><span class="heart">♥</span></div>`));
    r.appendChild(h(`<div id="hints"><div><kbd>E</kbd>Interact</div><div><kbd>Tab</kbd>Target Lock</div><div><kbd>1-4</kbd>Interaction Menu</div><div><kbd>Esc</kbd>Pause</div></div>`));
    r.appendChild(h(`<div id="reticle" class="hidden"><span class="lbl"></span></div>`));
    r.appendChild(h(`<div id="prompt" class="hidden"><kbd>E</kbd><span></span></div>`));
    r.appendChild(h(`<div id="banner" class="card off"><small></small><strong></strong></div>`));
    // photo mode
    r.appendChild(h(`<div id="photo" class="hidden"><div class="frame"><i></i><i></i><i></i><i></i></div><div class="center"></div>
      <div class="cam card"><img src="${ICON('camera')}" alt=""></div>
      <div class="subj card"><small>IN FRAME</small><b>—</b><span class="why"></span></div>
      <div class="info card">A/D turn · W/S tilt · Q/E zoom · Space/Click shutter · Esc exit</div></div>`));
    r.appendChild(h(`<div id="lastphoto" class="card" style="opacity:0"><img alt=""><div></div></div>`));
    r.appendChild(h(`<div id="flash"></div>`));
    for (const id of ['goal', 'party', 'quest', 'interact', 'species', 'note', 'reticle', 'prompt', 'banner', 'photo', 'hotbar', 'lastphoto', 'flash', 'hints']) this.el[id] = document.getElementById(id)!;
  }

  // ---------------------------------------------------------------- per-frame
  frame(dt: number) {
    const g = this.game, s = g.state;
    this.noteTimer -= dt; this.bannerTimer -= dt; this.lastPhotoTimer -= dt;
    if (this.bannerTimer <= 0) this.el.banner.classList.add('off');
    if (this.lastPhotoTimer <= 0) this.el.lastphoto.style.opacity = '0';
    if (this.noteTimer <= 0 && this.noteTimer > -dt * 1.5) this.idleHint();
    const photo = g.mode === 'photo';
    const hideWorldHud = photo || this.overlay !== 'none';
    this.el.photo.classList.toggle('hidden', !photo);
    for (const k of ['party', 'quest', 'hotbar', 'note', 'hints']) this.el[k].style.visibility = photo ? 'hidden' : 'visible';
    // next-goal tracker: text + arrow pointing in screen space + distance
    const goal = g.nextObjective();
    (this.el.goal.querySelector('.txt') as HTMLElement).textContent = goal.text;
    const arrow = this.el.goal.querySelector('.arrow') as HTMLElement, dist = this.el.goal.querySelector('.dist') as HTMLElement;
    if (goal.target) {
      const dx = goal.target[0] - g.explorer.pos.x, dz = goal.target[1] - g.explorer.pos.z, d = Math.hypot(dx, dz);
      const yaw = g.camYaw, rx = dx * Math.cos(yaw) - dz * Math.sin(yaw), fz = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
      arrow.style.transform = `rotate(${Math.atan2(rx, fz) - Math.PI / 2}rad)`; arrow.style.visibility = d > 2 ? 'visible' : 'hidden';
      dist.textContent = d > 2 ? `${Math.round(d)} m` : 'here';
    } else { arrow.style.visibility = 'hidden'; dist.textContent = ''; }
    this.goalTarget = goal.target;
    document.getElementById('minimap')!.style.visibility = photo ? 'hidden' : 'visible';
    // target reticle + interaction panel
    const sel = g.selected;
    const showPanel = !!sel && !hideWorldHud;
    this.el.interact.classList.toggle('hidden', !showPanel);
    if (sel && !hideWorldHud) {
      const p = sel.actor.center(new THREE.Vector3()).project(g.camera);
      const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      this.el.reticle.classList.toggle('hidden', !vis);
      if (vis) { this.el.reticle.style.left = `${(p.x + 1) / 2 * innerWidth}px`; this.el.reticle.style.top = `${(1 - p.y) / 2 * innerHeight}px`; }
      const op = g.action?.kind === 'observe' && g.action.target === sel ? g.observeProgress : 0;
      this.el.reticle.style.background = op > 0 ? `conic-gradient(rgba(143,191,85,.75) ${op * 360}deg, rgba(255,255,255,.12) 0deg)` : '';
      (this.el.reticle.querySelector('.lbl') as HTMLElement).textContent = `${sel.name} · ${g.distTo(sel).toFixed(1)} m`;
      this.updatePanel();
    } else this.el.reticle.classList.add('hidden');
    // fruit pickup prompt
    const fid = !hideWorldHud ? g.nearestFruit() : null;
    this.el.prompt.classList.toggle('hidden', !fid);
    if (fid) {
      const m = g.fruits.get(fid)!; const p = m.position.clone().add(new THREE.Vector3(0, 0.6, 0)).project(g.camera);
      this.el.prompt.style.left = `${(p.x + 1) / 2 * innerWidth}px`; this.el.prompt.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
      (this.el.prompt.querySelector('span') as HTMLElement).textContent = 'Pick fruit';
    }
    // observe progress
    const prog = this.root.querySelector('.act.observe .prog b') as HTMLElement;
    prog.style.width = `${Math.round((g.action?.kind === 'observe' ? g.observeProgress : 0) * 100)}%`;
    if (photo) this.updatePhotoHud();
    this.drawMinimap();
    void s;
  }

  /** Refresh state-derived HUD values (called whenever state changes). */
  refresh() {
    const s = this.game.state, c = counts(s);
    for (const card of Array.from(this.root.querySelectorAll<HTMLElement>('.pal'))) {
      const cs = s.companions[card.dataset.id as keyof GameState['companions']];
      (card.querySelector('.bar b') as HTMLElement).style.width = `${cs.trust}%`;
      card.classList.toggle('friend', cs.befriended);
      card.classList.toggle('sel', this.game.selected?.eid === card.dataset.id);
      card.title = `Trust ${cs.trust}/100${cs.befriended ? ' · Friend' : ''}`;
    }
    const q = (k: string, text: string, done: boolean) => { const e = this.root.querySelector(`[data-q=${k}]`)!; e.classList.toggle('done', done); e.querySelector('.t')!.textContent = text; };
    q('species', `Species photographed ${c.species}/${world.completion.species}`, c.species >= world.completion.species);
    q('habitats', `Habitats recorded ${c.habitats}/${world.completion.habitats}`, c.habitats >= world.completion.habitats);
    q('friends', `Friends made ${c.friends}/${world.completion.friendships}`, c.friends >= world.completion.friendships);
    (this.el.hotbar.querySelector('[data-s=fruit] .cnt') as HTMLElement).textContent = String(s.fruit);
    this.el.hotbar.querySelector('[data-s=camera]')!.classList.toggle('active', this.game.mode === 'photo');
    if (this.overlay === 'journal') this.renderJournal();
  }

  private updatePanel() {
    const g = this.game, sel = g.selected!, s = g.state;
    const sp = SPECIES[sel.species];
    const known = s.observedSpecies.includes(sel.species) || s.photographedSpecies.includes(sel.species) || !!sel.companion;
    (this.el.species.querySelector('.band') as HTMLElement).textContent = (sel.companion ? sel.name : sp.name).toUpperCase();
    (this.el.species.querySelector('.sub') as HTMLElement).textContent = sel.companion ? `${sp.name} · ${sp.type}`.toUpperCase() : sp.type.toUpperCase();
    const img = this.el.species.querySelector('.portrait img') as HTMLImageElement;
    const src = PORTRAIT(sel.species); if (!img.src.endsWith(src)) img.src = src;
    img.classList.toggle('sil', !known);
    let mood = sp.mood;
    if (sel.companion) {
      const cs = s.companions[sel.companion];
      const st = g.comps.find(c => c.id === sel.companion)!.state;
      mood = cs.befriended ? 'Friend' : st === 'curious' ? 'Curious' : st === 'interact' ? 'Happy' : cs.trust >= 60 ? 'Trusting' : cs.trust >= 40 ? 'Warming up' : 'Shy';
      (this.el.species.querySelector('.trust') as HTMLElement).textContent = '♥'.repeat(Math.round(cs.trust / 20)) + '♡'.repeat(5 - Math.round(cs.trust / 20));
    } else (this.el.species.querySelector('.trust') as HTMLElement).textContent = '';
    (this.el.species.querySelector('.mood') as HTMLElement).textContent = `${mood}.`;
    for (const k of ['observe', 'offer', 'photo', 'befriend'] as ActionKind[]) {
      const b = this.root.querySelector(`.act.${k}`) as HTMLElement;
      const why = g.actionAvailability(k);
      b.classList.toggle('locked', !!why); b.title = why ?? '';
    }
  }

  private updatePhotoHud() {
    const g = this.game;
    const cands = g.photoCandidates().filter(c => c.inFrustum).sort((a, b) => a.centerOffset - b.centerOffset);
    const best = cands[0];
    const subj = this.el.photo.querySelector('.subj') as HTMLElement;
    if (!best) { subj.querySelector('b')!.textContent = 'No creature'; (subj.querySelector('.why') as HTMLElement).textContent = 'Turn to find a subject'; return; }
    subj.querySelector('b')!.textContent = best.c.companion ? `${best.c.name} (${SPECIES[best.species].name})` : SPECIES[best.species].name;
    const why = best.distance > 12 ? 'Too far' : best.occluded ? 'Blocked' : best.screenFraction < 0.06 ? 'Too small — zoom (E)' : 'Ready ✓';
    (subj.querySelector('.why') as HTMLElement).textContent = `${best.distance.toFixed(1)} m · ${why}${g.state.photographedSpecies.includes(best.species) ? ' · in journal' : ''}`;
  }

  private minimapT = 0;
  private drawMinimap() {
    if (++this.minimapT % 3) return;
    const g = this.game, ctx = this.mini.getContext('2d')!, base = mapBase();
    const R = 30, S = 256, px = g.explorer.pos.x, pz = g.explorer.pos.z;
    const toB = (v: number) => (v + MAP_RANGE) / (MAP_RANGE * 2) * 1024;
    const span = R / (MAP_RANGE * 2) * 1024 * 2;
    ctx.clearRect(0, 0, S, S); ctx.fillStyle = '#9dbf62'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(base, toB(px) - span / 2, toB(pz) - span / 2, span, span, 0, 0, S, S);
    const W = (x: number, z: number): [number, number] => [(x - px) / (R * 2) * S + S / 2, (z - pz) / (R * 2) * S + S / 2];
    // landmarks
    for (const l of LABELS) { const [x, y] = W(l.x, l.z); if (x < -10 || y < -10 || x > S + 10 || y > S + 10) continue; ctx.fillStyle = '#fbf3e2'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#e07a4f'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); }
    if (this.goalTarget && !g.state.waypoint) { const [gx, gy] = W(this.goalTarget[0], this.goalTarget[1]); const cx = Math.max(12, Math.min(S - 12, gx)), cy = Math.max(12, Math.min(S - 12, gy)); ctx.fillStyle = '#f2c14e'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? 4 : 9; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (g.state.waypoint) { const [x, y] = W(g.state.waypoint[0], g.state.waypoint[1]); pin(ctx, Math.max(10, Math.min(S - 10, x)), Math.max(16, Math.min(S - 4, y)), '#5f9ad6'); }
    for (const c of g.comps) { const [x, y] = W(c.actor.pos.x, c.actor.pos.z); ctx.fillStyle = c.id === 'leaflet-01' ? '#9ccf5f' : c.id === 'peach-01' ? '#f2a27c' : '#6fb7e3'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.stroke(); }
    // single player marker (arrow pointing along facing)
    playerArrow(ctx, S / 2, S / 2, g.explorer.facing, 1);
  }

  // ---------------------------------------------------------------- messages
  message(text: string, tone: 'info' | 'good' | 'warn' = 'info') {
    const n = this.el.note; if (!n) return;
    n.querySelector('.txt')!.textContent = text;
    n.classList.toggle('good', tone === 'good'); n.classList.toggle('warn', tone === 'warn');
    this.noteTimer = tone === 'info' ? 4 : 6;
  }
  banner(small: string, big: string) {
    const b = this.el.banner; b.querySelector('small')!.textContent = small; b.querySelector('strong')!.textContent = big;
    b.classList.remove('off'); this.bannerTimer = 3.2;
  }
  private idleHint() {
    const s = this.game.state, c = counts(s);
    let t = 'Looks like a sunny day for discovery!';
    if (c.friends < 3) {
      const pend = COMPANIONS.find(k => !s.companions[k.id].befriended)!; const cs = s.companions[pend.id];
      t = !cs.observed ? `Get close to ${pend.name} and Observe (1) to learn about them.` : !cs.fed ? (s.fruit > 0 ? `Offer ${pend.name} some fruit (2).` : 'Out of fruit — the orchard to the north has plenty.') : cs.trust < 60 ? `Play the flute (F) or share more fruit to build ${pend.name}'s trust.` : `${pend.name} trusts you — try Befriend (4)!`;
    } else if (c.species < 5) t = 'Photograph every species: Flower Grazers graze by the paths, finches love the sunflowers.';
    else if (c.habitats < 4) t = `Visit every habitat: ${HABITAT_ORDER.filter(h => !s.habitats.includes(h)).map(h => HABITATS[h]).join(', ')}.`;
    else t = 'What a wonderful day in the meadow!';
    this.message(t, 'info'); this.noteTimer = -99;
  }

  ruleEvent(e: RuleEvent) {
    const s = this.game.state;
    if (e.kind === 'speciesObserved') this.banner('Journal entry unlocked', SPECIES[e.species].name);
    if (e.kind === 'habitat') { this.banner('New habitat recorded', HABITATS[e.habitat]); this.message(`Habitat recorded: ${HABITATS[e.habitat]} (${s.habitats.length}/4).`, 'good'); }
    if (e.kind === 'photo' && e.firstTime) this.banner('New species photographed', SPECIES[e.species].name);
    if (e.kind === 'trust') { const n = COMPANIONS.find(c => c.id === e.companion)!.name; if (e.amount > 0) this.message(`${n}'s trust +${e.amount} (${s.companions[e.companion].trust}/100).`, 'good'); }
    if (e.kind === 'fruitCollected') this.message(`Picked a ripe orange! You have ${s.fruit}.`, 'good');
    if (e.kind === 'befriended') { const n = COMPANIONS.find(c => c.id === e.companion)!.name; this.banner('Friendship!', `${n} is now your friend`); this.message(`${n} snuggles up happily. ♥`, 'good'); }
    if (e.kind === 'complete') setTimeout(() => this.showComplete(), 1600);
  }

  photoResult(ok: boolean, info: string, thumb?: string) {
    const f = this.el.flash; f.style.transition = 'none'; f.style.opacity = '0.85'; requestAnimationFrame(() => { f.style.transition = 'opacity .45s'; f.style.opacity = '0'; });
    if (thumb) { (this.el.lastphoto.querySelector('img') as HTMLImageElement).src = thumb; this.el.lastphoto.style.opacity = '1'; this.lastPhotoTimer = 2.6; }
    this.el.lastphoto.querySelector('div')!.textContent = info;
    this.message(info, ok ? 'good' : 'warn');
  }

  // ---------------------------------------------------------------- overlays
  private open(id: string, el: HTMLElement) { this.close(); el.id = id; el.classList.add('overlay'); this.root.appendChild(el); }
  close() { for (const id of ['journal', 'map', 'pause', 'complete', 'confirm']) document.getElementById(id)?.remove(); if (this.overlay !== 'title') this.overlay = 'none'; }

  toggleJournal() { if (this.overlay === 'journal') { this.close(); return; } this.overlay = 'journal'; this.renderJournal(); }
  renderJournal() {
    const s = this.game.state;
    const el = h(`<div><div class="book"><button class="x hit" title="Close (Esc)">✕</button><div class="page left"><h3>Creature Guide</h3><div class="list"></div>
      <h4>Habitats ${s.habitats.length}/4</h4><div class="hab">${HABITAT_ORDER.map(k => `<span class="${s.habitats.includes(k) ? 'on' : ''}">${s.habitats.includes(k) ? '✓ ' : ''}${HABITATS[k]}</span>`).join('')}</div>
      <h4>Field notes</h4><p style="font-weight:600;margin:0">Photos taken: ${s.photoCount} · Fruit in bag: ${s.fruit} · Orchard fruit left: ${world.fruit.length - s.collectedFruit.length}</p></div>
      <div class="page detail"></div></div></div>`);
    const list = el.querySelector('.list')!;
    for (const sp of SPECIES_ORDER) {
      const known = s.observedSpecies.includes(sp) || s.photographedSpecies.includes(sp);
      const comp = COMPANIONS.find(c => c.species === sp);
      const cs = comp ? s.companions[comp.id] : null;
      const e = h(`<div class="entry ${sp === this.journalSel ? 'sel' : ''}"><img class="${known ? '' : 'sil'}" src="${PORTRAIT(sp)}" alt=""><div class="meta"><div class="nm">${known ? SPECIES[sp].name : '???'}${comp && known ? ` <span style="font-weight:500;font-size:.8em">(${comp.name})</span>` : ''}</div>
        <div class="tp">${known ? SPECIES[sp].type : 'Undiscovered'}${cs ? ` · <span class="hearts">${'♥'.repeat(Math.round(cs.trust / 20))}${'♡'.repeat(5 - Math.round(cs.trust / 20))}</span>` : ''}</div>
        <div class="tags"><span class="tag ${s.observedSpecies.includes(sp) ? 'on' : ''}">Observed</span><span class="tag ${s.photographedSpecies.includes(sp) ? 'on' : ''}">Photographed</span>${cs ? `<span class="tag ${cs.fed ? 'on' : ''}">Fed</span><span class="tag ${cs.befriended ? 'on' : ''}">Friend</span>` : ''}</div></div></div>`);
      e.addEventListener('click', () => { this.journalSel = sp; this.renderJournal(); });
      list.appendChild(e);
    }
    const sp = this.journalSel, known = s.observedSpecies.includes(sp) || s.photographedSpecies.includes(sp), photo = s.photos[sp];
    el.querySelector('.detail')!.innerHTML = `<h3>${known ? SPECIES[sp].name : 'Undiscovered'}</h3>
      <div class="big">${photo?.thumb ? `<img src="${photo.thumb}" alt="favourite photo">` : `<img class="${known ? '' : 'sil'}" src="${PORTRAIT(sp)}" alt="" style="${known ? 'width:50%;height:auto;object-fit:contain' : ''}">`}</div>
      <p style="font-size:.9em;color:#8a6a4c;margin:.4em 0 0">${photo?.thumb ? 'Favourite photo (your own shot)' : s.photographedSpecies.includes(sp) ? 'Photo kept small to save space.' : 'No photo yet — use the camera (3).'}</p>
      <p>${s.observedSpecies.includes(sp) ? SPECIES[sp].note : 'Observe this creature up close (within 3 m) to fill in its notes.'}</p>
      <p><b>Habitat:</b> ${known ? SPECIES[sp].habitat : '???'} · <b>Type:</b> ${known ? SPECIES[sp].type : '???'}</p>`;
    el.querySelector('.x')!.addEventListener('click', () => this.hooks.onToggleJournal());
    this.open('journal', el); this.overlay = 'journal';
  }

  toggleMap() { if (this.overlay === 'map') { this.close(); return; } this.overlay = 'map'; this.renderMap(); }
  renderMap() {
    const el = h(`<div><div class="panel"><button class="x hit" title="Close (Esc)">✕</button><canvas width="900" height="900"></canvas>
      <div class="legend"><span>Click to set a waypoint · Right-click to clear</span><span><button class="btn alt clear" style="font-size:.9em;padding:.3em .9em">Clear waypoint</button></span></div></div></div>`);
    const cv = el.querySelector('canvas')!;
    const draw = () => {
      const g = cv.getContext('2d')!, S = 900; g.drawImage(mapBase(), 0, 0, S, S);
      const W = (v: number) => (v + MAP_RANGE) / (MAP_RANGE * 2) * S;
      g.font = '600 20px Fredoka, sans-serif'; g.textAlign = 'center';
      for (const l of LABELS) { const x = W(l.x), y = W(l.z); const tw = g.measureText(l.text).width + 22; g.fillStyle = 'rgba(251,243,226,0.95)'; roundRect(g, x - tw / 2, y - 40, tw, 28, 14); g.fill(); g.fillStyle = '#6b4a2e'; g.fillText(l.text, x, y - 19); g.fillStyle = '#e07a4f'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
      const s = this.game.state;
      g.fillStyle = '#f39a3c';
      for (const f of world.fruit) if (!s.collectedFruit.includes(f.id)) { g.beginPath(); g.arc(W(f.positionXZ[0]), W(f.positionXZ[1]), 4, 0, 7); g.fill(); }
      if (s.waypoint) pin(g, W(s.waypoint[0]), W(s.waypoint[1]), '#5f9ad6', 1.6);
      for (const c of this.game.comps) { g.fillStyle = c.id === 'leaflet-01' ? '#9ccf5f' : c.id === 'peach-01' ? '#f2a27c' : '#6fb7e3'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(W(c.actor.pos.x), W(c.actor.pos.z), 8, 0, 7); g.fill(); g.stroke(); }
      playerArrow(g, W(this.game.explorer.pos.x), W(this.game.explorer.pos.z), this.game.explorer.facing, 1.5);
      // compass
      g.fillStyle = 'rgba(251,243,226,.95)'; g.beginPath(); g.arc(S - 50, S - 50, 30, 0, 7); g.fill(); g.fillStyle = '#6b4a2e'; g.font = '700 24px Fredoka'; g.fillText('N', S - 50, S - 41);
    };
    draw();
    // canvas text needs the web font loaded; redraw once it is
    Promise.all([document.fonts.load('600 20px Fredoka'), document.fonts.load('700 24px Fredoka')]).then(() => { if (cv.isConnected) draw(); });
    const toWorld = (e: MouseEvent): [number, number] => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * MAP_RANGE * 2 - MAP_RANGE, ((e.clientY - r.top) / r.height) * MAP_RANGE * 2 - MAP_RANGE]; };
    cv.addEventListener('click', e => { const [x, z] = toWorld(e); this.hooks.onSetWaypoint(x, z); draw(); });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); this.hooks.onClearWaypoint(); draw(); });
    el.querySelector('.clear')!.addEventListener('click', () => { this.hooks.onClearWaypoint(); draw(); });
    el.querySelector('.x')!.addEventListener('click', () => this.hooks.onToggleMap());
    this.open('map', el); this.overlay = 'map';
  }

  showPause(muted: boolean, music: number, sfx: number, quality: string) {
    const el = h(`<div><div class="panel"><h2>Paused</h2>
      <div class="rowc"><span>Sound</span><button class="btn alt mute" style="font-size:.95em;padding:.3em 1em">${muted ? 'Unmute' : 'Mute'}</button></div>
      <div class="rowc"><span>Music volume</span><input type="range" class="mv" min="0" max="1" step="0.05" value="${music}"></div>
      <div class="rowc"><span>Effects volume</span><input type="range" class="sv" min="0" max="1" step="0.05" value="${sfx}"></div>
      <div class="rowc"><span>Quality</span><select class="q"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low (30 fps floor)</option></select></div>
      <div class="btns"><button class="btn resume">Resume</button><button class="btn orange newday">New Day…</button></div>
      <div class="keys">WASD move · Shift walk faster<br>E interact · Tab cycle target<br>1 Observe · 2 Offer fruit<br>3 Photograph · 4 Befriend<br>F flute · J journal<br>M map · Esc close / pause<br>H hide HUD (screenshots)</div></div></div>`);
    (el.querySelector('.q') as HTMLSelectElement).value = quality;
    el.querySelector('.mute')!.addEventListener('click', e => { const b = e.target as HTMLButtonElement; const m = b.textContent === 'Mute'; this.hooks.onMute(m); b.textContent = m ? 'Unmute' : 'Mute'; });
    const vol = () => this.hooks.onVolume(+(el.querySelector('.mv') as HTMLInputElement).value, +(el.querySelector('.sv') as HTMLInputElement).value);
    el.querySelector('.mv')!.addEventListener('input', vol); el.querySelector('.sv')!.addEventListener('input', vol);
    el.querySelector('.q')!.addEventListener('change', e => this.hooks.onQuality((e.target as HTMLSelectElement).value as any));
    el.querySelector('.resume')!.addEventListener('click', () => this.hooks.onResume());
    el.querySelector('.newday')!.addEventListener('click', () => this.confirmNewDay());
    this.open('pause', el); this.overlay = 'pause';
  }

  confirmNewDay(after?: () => void) {
    const el = h(`<div class="confirm"><div class="panel"><h2 style="font-family:var(--head);margin:0 0 .4em">Start a New Day?</h2><p>This clears your journal, photos, friendships and fruit, and starts a fresh Meadow Discovery Day.</p>
      <div class="row"><button class="btn alt no">Keep playing</button><button class="btn orange yes">Start New Day</button></div></div></div>`);
    el.querySelector('.no')!.addEventListener('click', () => { this.close(); after?.(); });
    el.querySelector('.yes')!.addEventListener('click', () => { this.close(); this.hooks.onNewDay(); });
    this.open('confirm', el); this.overlay = 'confirm';
  }

  showComplete() {
    const s = this.game.state, c = counts(s);
    const el = h(`<div><div class="panel"><h2>DISCOVERY DAY COMPLETE</h2>
      <div class="stats"><div class="stat"><div class="ic"><img src="${ICON('camera')}" alt=""></div><b>${c.species}/5</b><span>Species</span></div>
      <div class="stat"><div class="ic"><img src="${ICON('sunflower')}" alt=""></div><b>${c.habitats}/4</b><span>Habitats</span></div>
      <div class="stat"><div class="ic"><img src="${ICON('heart')}" alt=""></div><b>${c.friends}/3</b><span>Friendships</span></div></div>
      <p style="font-weight:700">More friends ahead ♥ Keep exploring the meadow, or begin a brand-new day.</p>
      <div class="row" style="display:flex;gap:1em;justify-content:center"><button class="btn keep">Keep Exploring</button><button class="btn orange nd">New Day…</button></div></div></div>`);
    el.querySelector('.keep')!.addEventListener('click', () => this.hooks.onResume());
    el.querySelector('.nd')!.addEventListener('click', () => this.confirmNewDay(() => this.showComplete()));
    this.open('complete', el); this.overlay = 'complete';
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function pin(g: CanvasRenderingContext2D, x: number, y: number, col: string, s = 1) { g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 2 * s; g.beginPath(); g.arc(x, y - 12 * s, 7 * s, Math.PI, 0); g.lineTo(x, y); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y - 12 * s, 2.5 * s, 0, 7); g.fill(); }
function playerArrow(g: CanvasRenderingContext2D, x: number, y: number, facing: number, s: number) {
  g.save(); g.translate(x, y); g.rotate(Math.PI - facing);
  g.fillStyle = '#f2a33c'; g.strokeStyle = '#fff'; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(0, -11 * s); g.lineTo(8 * s, 8 * s); g.lineTo(0, 4 * s); g.lineTo(-8 * s, 8 * s); g.closePath(); g.fill(); g.stroke(); g.restore();
}
