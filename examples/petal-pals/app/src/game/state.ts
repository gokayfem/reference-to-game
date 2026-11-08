// Pure game state + rules. No Three.js / DOM here so it can be unit-tested.
import world from '../data/world.json';

export const SCHEMA_VERSION = 1;
/** Start position: moved east of world.json's proposal (-26,24) so the opening view frames the river, bridge, camp and village like the reference image. */
export const START_XZ: [number, number] = [-9, 38];
export const T = world.tuning;

export type SpeciesId = 'leaflet' | 'bloomble' | 'bubble' | 'flower-grazer' | 'meadow-finch';
export type HabitatId = 'sunflowers' | 'riverbank' | 'orchard' | 'lookout';
export type CompanionId = 'leaflet-01' | 'peach-01' | 'bubble-01';

export const SPECIES: Record<SpeciesId, { name: string; type: string; habitat: string; note: string; mood: string }> = {
  leaflet: { name: 'Leaflet', type: 'Meadow Type', habitat: 'Sunny meadows', note: 'Turns its leaf cap toward the sun and naps in warm grass. Loves sunny spots.', mood: 'Cheerful' },
  bloomble: { name: 'Bloomble', type: 'Meadow Type', habitat: 'Flower fields', note: 'Petal ears flutter when it is curious. Peach is fond of orchard fruit and flowers.', mood: 'Curious' },
  bubble: { name: 'Bubble', type: 'River Type', habitat: 'Clear streams', note: 'Its bubble tail keeps it buoyant in shallow water. Playful and loves clean rivers.', mood: 'Playful' },
  'flower-grazer': { name: 'Flower Grazer', type: 'Meadow Type', habitat: 'Open grassland', note: 'A gentle grazer that wears a crown of tiny blossoms it never eats.', mood: 'Calm' },
  'meadow-finch': { name: 'Meadow Finch', type: 'Sky Type', habitat: 'Sunflower patches', note: 'Hops in little flocks and sprouts a new leaf every spring.', mood: 'Busy' },
};
export const SPECIES_ORDER: SpeciesId[] = ['leaflet', 'bloomble', 'bubble', 'flower-grazer', 'meadow-finch'];
export const HABITATS: Record<HabitatId, string> = { sunflowers: 'Sunflower Meadow', riverbank: 'Riverbank', orchard: 'Orchard', lookout: 'Lookout Hill' };
export const HABITAT_ORDER: HabitatId[] = ['sunflowers', 'riverbank', 'orchard', 'lookout'];
export const COMPANIONS: { id: CompanionId; species: SpeciesId; name: string }[] = [
  { id: 'leaflet-01', species: 'leaflet', name: 'Leaflet' },
  { id: 'peach-01', species: 'bloomble', name: 'Peach' },
  { id: 'bubble-01', species: 'bubble', name: 'Bubble' },
];

export interface CompanionState { trust: number; observed: boolean; fed: boolean; befriended: boolean; fluteRewarded: boolean }
export interface PhotoRecord { speciesId: SpeciesId; thumb: string; takenAt: number; score: number }
export interface GameState {
  schemaVersion: number;
  fruit: number;
  collectedFruit: string[];
  observedSpecies: SpeciesId[];
  photographedSpecies: SpeciesId[];
  photos: Partial<Record<SpeciesId, PhotoRecord>>;
  photoCount: number;
  habitats: HabitatId[];
  companions: Record<CompanionId, CompanionState>;
  completionShown: boolean;
  waypoint: [number, number] | null;
  player: [number, number];
}

export function newGame(): GameState {
  const c = (): CompanionState => ({ trust: T.trustInitial, observed: false, fed: false, befriended: false, fluteRewarded: false });
  const start = START_XZ;
  return {
    schemaVersion: SCHEMA_VERSION, fruit: T.initialFruit, collectedFruit: [], observedSpecies: [], photographedSpecies: [],
    photos: {}, photoCount: 0, habitats: [], companions: { 'leaflet-01': c(), 'peach-01': c(), 'bubble-01': c() },
    completionShown: false, waypoint: null, player: [start[0], start[1]],
  };
}

export type RuleEvent =
  | { kind: 'speciesObserved'; species: SpeciesId }
  | { kind: 'trust'; companion: CompanionId; amount: number; reason: string }
  | { kind: 'fruitCollected'; id: string }
  | { kind: 'fruitOffered'; companion: CompanionId }
  | { kind: 'photo'; species: SpeciesId; firstTime: boolean }
  | { kind: 'habitat'; habitat: HabitatId }
  | { kind: 'befriended'; companion: CompanionId }
  | { kind: 'complete' }
  | { kind: 'rejected'; reason: string };

const clampTrust = (v: number) => Math.max(0, Math.min(100, v));
const companionOf = (id: CompanionId) => COMPANIONS.find(c => c.id === id)!;

/** Completed observation of an entity (after the uninterrupted interval). */
export function completeObserve(s: GameState, species: SpeciesId, companion: CompanionId | null): RuleEvent[] {
  const ev: RuleEvent[] = [];
  if (!s.observedSpecies.includes(species)) { s.observedSpecies.push(species); ev.push({ kind: 'speciesObserved', species }); }
  if (companion) {
    const c = s.companions[companion];
    if (!c.observed) { c.observed = true; c.trust = clampTrust(c.trust + T.observeFirstReward); ev.push({ kind: 'trust', companion, amount: T.observeFirstReward, reason: 'observed' }); }
  }
  return ev.concat(checkComplete(s));
}

export function collectFruit(s: GameState, id: string): RuleEvent[] {
  if (!world.fruit.some(f => f.id === id)) return [{ kind: 'rejected', reason: 'unknown fruit' }];
  if (s.collectedFruit.includes(id)) return [{ kind: 'rejected', reason: 'already collected' }];
  s.collectedFruit.push(id); s.fruit += 1;
  return [{ kind: 'fruitCollected', id }];
}

export function canOffer(s: GameState, companion: CompanionId, distance: number): string | null {
  if (s.fruit <= 0) return 'No fruit left — the orchard has more.';
  if (distance > T.offerRange) return 'Move a little closer to offer fruit.';
  if (s.companions[companion].trust >= 100) return `${companionOf(companion).name} is already full of trust.`;
  return null;
}

/** Called once when the offer animation commits. Consumes exactly one fruit. */
export function commitOffer(s: GameState, companion: CompanionId, distance: number): RuleEvent[] {
  const why = canOffer(s, companion, distance);
  if (why) return [{ kind: 'rejected', reason: why }];
  s.fruit -= 1;
  const c = s.companions[companion];
  c.fed = true;
  const before = c.trust; c.trust = clampTrust(c.trust + T.fruitReward);
  return [{ kind: 'fruitOffered', companion }, { kind: 'trust', companion, amount: c.trust - before, reason: 'fruit' }];
}

export function canBefriend(s: GameState, companion: CompanionId): string | null {
  const c = s.companions[companion];
  if (c.befriended) return 'Already friends!';
  if (!c.observed) return 'Observe this pal first.';
  if (!c.fed) return 'Offer some fruit first.';
  if (c.trust < T.befriendThreshold) return `Trust ${c.trust}/${T.befriendThreshold} — keep bonding.`;
  return null;
}

export function commitBefriend(s: GameState, companion: CompanionId): RuleEvent[] {
  const why = canBefriend(s, companion);
  if (why) return [{ kind: 'rejected', reason: why }];
  s.companions[companion].befriended = true;
  return [{ kind: 'befriended', companion } as RuleEvent].concat(checkComplete(s));
}

export function fluteComplete(s: GameState, arrived: CompanionId[]): RuleEvent[] {
  const ev: RuleEvent[] = [];
  for (const id of arrived) {
    const c = s.companions[id];
    if (!c.fluteRewarded) { c.fluteRewarded = true; const b = c.trust; c.trust = clampTrust(c.trust + T.fluteFirstReward); ev.push({ kind: 'trust', companion: id, amount: c.trust - b, reason: 'flute' }); }
  }
  return ev;
}

export interface PhotoCandidate { species: SpeciesId; inFrustum: boolean; distance: number; screenFraction: number; occluded: boolean; centerOffset: number }
export const PHOTO_MIN_FRACTION = 0.06;
export function photoValid(c: PhotoCandidate): string | null {
  if (!c.inFrustum) return 'not in view';
  if (c.distance > T.photoMaxRange) return 'too far';
  if (c.occluded) return 'blocked';
  if (c.screenFraction < PHOTO_MIN_FRACTION) return 'too small';
  return null;
}
/** Pick the best valid subject (closest to reticle centre) and record the photo. */
export function choosePhotoSubject(cands: PhotoCandidate[]): PhotoCandidate | null {
  const ok = cands.filter(c => photoValid(c) === null).sort((a, b) => a.centerOffset - b.centerOffset);
  return ok[0] ?? null;
}
export function recordPhoto(s: GameState, species: SpeciesId, thumb: string, score: number): RuleEvent[] {
  s.photoCount += 1;
  const first = !s.photographedSpecies.includes(species);
  if (first) s.photographedSpecies.push(species);
  const prev = s.photos[species];
  if (!prev || score >= prev.score) s.photos[species] = { speciesId: species, thumb, takenAt: Date.now(), score };
  return [{ kind: 'photo', species, firstTime: first } as RuleEvent].concat(checkComplete(s));
}

export function enterHabitat(s: GameState, h: HabitatId): RuleEvent[] {
  if (s.habitats.includes(h)) return [];
  s.habitats.push(h);
  return [{ kind: 'habitat', habitat: h } as RuleEvent].concat(checkComplete(s));
}

export function counts(s: GameState) {
  return {
    species: s.photographedSpecies.length,
    habitats: s.habitats.length,
    friends: Object.values(s.companions).filter(c => c.befriended).length,
  };
}
export function isComplete(s: GameState) {
  const c = counts(s);
  return c.species >= world.completion.species && c.habitats >= world.completion.habitats && c.friends >= world.completion.friendships;
}
function checkComplete(s: GameState): RuleEvent[] {
  if (!s.completionShown && isComplete(s)) { s.completionShown = true; return [{ kind: 'complete' }]; }
  return [];
}

// ---------- persistence ----------
export const SAVE_KEY = 'petalpals.save.v1';
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function serialize(s: GameState) { return JSON.stringify(s); }

/** Validates and migrates a save; returns null if unusable. */
export function deserialize(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || d.schemaVersion !== SCHEMA_VERSION) return null;
    const base = newGame();
    const fruitIds = new Set(world.fruit.map(f => f.id));
    const sp = new Set(SPECIES_ORDER);
    const out: GameState = {
      ...base,
      fruit: Number.isFinite(d.fruit) ? Math.max(0, Math.min(99, Math.floor(d.fruit))) : base.fruit,
      collectedFruit: Array.isArray(d.collectedFruit) ? [...new Set<string>(d.collectedFruit.filter((x: string) => fruitIds.has(x)))] : [],
      observedSpecies: Array.isArray(d.observedSpecies) ? [...new Set<SpeciesId>(d.observedSpecies.filter((x: SpeciesId) => sp.has(x)))] : [],
      photographedSpecies: Array.isArray(d.photographedSpecies) ? [...new Set<SpeciesId>(d.photographedSpecies.filter((x: SpeciesId) => sp.has(x)))] : [],
      photos: typeof d.photos === 'object' && d.photos ? d.photos : {},
      photoCount: Number.isFinite(d.photoCount) ? d.photoCount : 0,
      habitats: Array.isArray(d.habitats) ? [...new Set<HabitatId>(d.habitats.filter((x: HabitatId) => HABITAT_ORDER.includes(x)))] : [],
      completionShown: !!d.completionShown,
      waypoint: Array.isArray(d.waypoint) && d.waypoint.length === 2 ? [Number(d.waypoint[0]), Number(d.waypoint[1])] : null,
      player: Array.isArray(d.player) && d.player.every(Number.isFinite) ? [d.player[0], d.player[1]] : base.player,
    };
    for (const c of COMPANIONS) {
      const src = d.companions?.[c.id];
      if (src) out.companions[c.id] = {
        trust: Number.isFinite(src.trust) ? Math.max(0, Math.min(100, src.trust)) : T.trustInitial,
        observed: !!src.observed, fed: !!src.fed, befriended: !!src.befriended && !!src.observed && !!src.fed, fluteRewarded: !!src.fluteRewarded,
      };
    }
    return out;
  } catch { return null; }
}

/** Save with bounded storage: on quota failure drop photo thumbnails and retry. */
export function saveTo(store: StorageLike, s: GameState): 'ok' | 'trimmed' | 'failed' {
  try { store.setItem(SAVE_KEY, serialize(s)); return 'ok'; } catch {
    try { const lite = { ...s, photos: {} }; store.setItem(SAVE_KEY, serialize(lite)); return 'trimmed'; } catch { return 'failed'; }
  }
}
export function loadFrom(store: StorageLike): { state: GameState; status: 'loaded' | 'new' | 'corrupt' } {
  let raw: string | null = null;
  try { raw = store.getItem(SAVE_KEY); } catch { /* storage blocked */ }
  if (!raw) return { state: newGame(), status: 'new' };
  const st = deserialize(raw);
  if (!st) { try { store.removeItem(SAVE_KEY); } catch { /* ignore */ } return { state: newGame(), status: 'corrupt' }; }
  return { state: st, status: 'loaded' };
}
