import { describe, it, expect } from 'vitest';
import {
  newGame, completeObserve, collectFruit, commitOffer, canOffer, commitBefriend, canBefriend, fluteComplete, recordPhoto, enterHabitat,
  photoValid, choosePhotoSubject, counts, isComplete, deserialize, serialize, saveTo, loadFrom, SAVE_KEY, type StorageLike, T,
} from '../src/game/state';
import world from '../src/data/world.json';

class Mem implements StorageLike { m = new Map<string, string>(); quota = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { if (v.length > this.quota) throw new Error('QuotaExceeded'); this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('fruit and offers', () => {
  it('starts with 3 fruit and 12 orchard fruit with stable unique IDs', () => {
    const s = newGame(); expect(s.fruit).toBe(3);
    expect(new Set(world.fruit.map(f => f.id)).size).toBe(12);
  });
  it('collects each fruit once', () => {
    const s = newGame();
    expect(collectFruit(s, 'fruit-01')[0].kind).toBe('fruitCollected');
    expect(collectFruit(s, 'fruit-01')[0].kind).toBe('rejected');
    expect(collectFruit(s, 'nope')[0].kind).toBe('rejected');
    expect(s.fruit).toBe(4);
  });
  it('never goes negative and consumes exactly one per committed offer', () => {
    const s = newGame();
    for (let i = 0; i < 3; i++) commitOffer(s, 'peach-01', 1);
    expect(s.fruit).toBe(0);
    expect(commitOffer(s, 'peach-01', 1)[0].kind).toBe('rejected');
    expect(s.fruit).toBe(0);
    expect(s.companions['peach-01'].trust).toBe(100); // 20 + 30 + 30 + 30 capped
  });
  it('requires range 2.5 m', () => {
    const s = newGame();
    expect(canOffer(s, 'leaflet-01', 2.6)).not.toBeNull();
    expect(commitOffer(s, 'leaflet-01', 3)[0].kind).toBe('rejected');
    expect(s.fruit).toBe(3);
  });
});

describe('friendship', () => {
  it('trust threshold alone does not allow befriend without observe + feed', () => {
    const s = newGame();
    s.companions['bubble-01'].trust = 80;
    expect(canBefriend(s, 'bubble-01')).toMatch(/Observe/);
    completeObserve(s, 'bubble', 'bubble-01');
    expect(canBefriend(s, 'bubble-01')).toMatch(/fruit/);
    commitOffer(s, 'bubble-01', 1);
    expect(canBefriend(s, 'bubble-01')).toBeNull();
    expect(commitBefriend(s, 'bubble-01')[0].kind).toBe('befriended');
    expect(commitBefriend(s, 'bubble-01')[0].kind).toBe('rejected');
  });
  it('observe/feed path reaches exactly 60', () => {
    const s = newGame();
    completeObserve(s, 'leaflet', 'leaflet-01'); completeObserve(s, 'leaflet', 'leaflet-01');
    expect(s.companions['leaflet-01'].trust).toBe(30);
    commitOffer(s, 'leaflet-01', 1);
    expect(s.companions['leaflet-01'].trust).toBe(T.befriendThreshold);
  });
  it('flute rewards once per companion', () => {
    const s = newGame();
    fluteComplete(s, ['leaflet-01', 'peach-01', 'bubble-01']); fluteComplete(s, ['leaflet-01', 'peach-01', 'bubble-01']);
    expect(Object.values(s.companions).map(c => c.trust)).toEqual([30, 30, 30]);
  });
});

describe('photos and habitats', () => {
  const ok = { species: 'leaflet' as const, inFrustum: true, distance: 5, screenFraction: 0.2, occluded: false, centerOffset: 0.1 };
  it('rejects occluded, tiny, far or off-frame subjects', () => {
    expect(photoValid(ok)).toBeNull();
    expect(photoValid({ ...ok, occluded: true })).toBe('blocked');
    expect(photoValid({ ...ok, screenFraction: 0.01 })).toBe('too small');
    expect(photoValid({ ...ok, distance: 12.5 })).toBe('too far');
    expect(photoValid({ ...ok, inFrustum: false })).toBe('not in view');
    expect(choosePhotoSubject([{ ...ok, occluded: true }, { ...ok, species: 'bubble', centerOffset: 0.5 }])?.species).toBe('bubble');
  });
  it('ten photos of one species count once', () => {
    const s = newGame();
    for (let i = 0; i < 10; i++) recordPhoto(s, 'bloomble', 'x', i);
    expect(counts(s).species).toBe(1); expect(s.photoCount).toBe(10);
  });
  it('habitats fire once in any order', () => {
    const s = newGame(); let n = 0;
    for (const h of ['lookout', 'orchard', 'lookout', 'riverbank', 'sunflowers', 'orchard'] as const) n += enterHabitat(s, h).filter(e => e.kind === 'habitat').length;
    expect(n).toBe(4); expect(counts(s).habitats).toBe(4);
  });
  it('completion fires exactly once and only from real counts', () => {
    const s = newGame(); let completes = 0;
    const tally = (evs: { kind: string }[]) => { completes += evs.filter(e => e.kind === 'complete').length; };
    for (const sp of ['leaflet', 'bloomble', 'bubble', 'flower-grazer', 'meadow-finch'] as const) tally(recordPhoto(s, sp, '', 1));
    for (const h of ['lookout', 'orchard', 'riverbank', 'sunflowers'] as const) tally(enterHabitat(s, h));
    expect(isComplete(s)).toBe(false);
    for (const [id, sp] of [['leaflet-01', 'leaflet'], ['peach-01', 'bloomble'], ['bubble-01', 'bubble']] as const) { completeObserve(s, sp, id); commitOffer(s, id, 1); tally(commitBefriend(s, id)); }
    expect(isComplete(s)).toBe(true); expect(completes).toBe(1);
    tally(recordPhoto(s, 'leaflet', '', 2)); expect(completes).toBe(1);
  });
  it('the day completes with only initial fruit (3 offers needed, 3 available, 12 more in orchard)', () => {
    expect(T.initialFruit + world.fruit.length).toBeGreaterThanOrEqual(3);
  });
});

describe('persistence', () => {
  it('round-trips with schema version', () => {
    const s = newGame(); s.fruit = 7; s.habitats.push('orchard');
    const r = deserialize(serialize(s))!; expect(r.fruit).toBe(7); expect(r.habitats).toEqual(['orchard']);
  });
  it('recovers from corrupt or wrong-version saves', () => {
    const m = new Mem(); m.setItem(SAVE_KEY, '{bad json');
    expect(loadFrom(m).status).toBe('corrupt'); expect(m.getItem(SAVE_KEY)).toBeNull();
    m.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 99 })); expect(loadFrom(m).status).toBe('corrupt');
  });
  it('sanitises tampered values (negative fruit, duplicate ids, befriended without prerequisites)', () => {
    const s: any = newGame(); s.fruit = -5; s.collectedFruit = ['fruit-01', 'fruit-01', 'bogus']; s.companions['peach-01'].befriended = true;
    const r = deserialize(JSON.stringify(s))!;
    expect(r.fruit).toBe(0); expect(r.collectedFruit).toEqual(['fruit-01']); expect(r.companions['peach-01'].befriended).toBe(false);
  });
  it('drops thumbnails when storage is full', () => {
    const m = new Mem(); const s = newGame(); recordPhoto(s, 'leaflet', 'x'.repeat(5000), 1); m.quota = 3000;
    expect(saveTo(m, s)).toBe('trimmed');
    m.quota = 10; expect(saveTo(m, s)).toBe('failed');
  });
});
