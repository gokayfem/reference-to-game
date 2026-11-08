import * as THREE from 'three';

export const SPRITES = [
  'explorer-front', 'explorer-side', 'explorer-back', 'explorer-back34', 'explorer-offer', 'explorer-camera', 'explorer-flute', 'explorer-point',
  'leaflet-front', 'leaflet-34', 'leaflet-side', 'leaflet-back', 'peach-front', 'peach-34', 'peach-side', 'peach-back',
  'bubble-front', 'bubble-34', 'bubble-side', 'bubble-back', 'grazer-34', 'grazer-graze', 'finch', 'finch-peck',
  'tree-apple', 'tree-round', 'tree-poplar', 'sunflowers', 'picnic-table', 'crates', 'notice-board', 'lilypad', 'tent', 'flag', 'easel',
  'arrow-sign', 'basket', 'bush', 'berry-bush', 'boulders', 'cairn', 'lookout-tower', 'cottage-orange', 'cottage-blue', 'fence', 'bench', 'picnic-blanket', 'burrow', 'lily-flower', 'map-sign', 'berry-cluster',
] as const;
export const WALK_FRAMES = [
  'explorer-front34',
  ...['back34', 'side', 'front', 'back', 'front34'].flatMap(v => [0, 1, 2, 3].map(i => `explorer-walk-${v}-${i}`)),
  ...[0, 1, 2, 3].map(i => `peach-walk-side-${i}`),
  ...[0, 1, 2, 3].map(i => `peach-walk-34-${i}`),
  ...[0, 1, 2, 3].map(i => `bubble-walk-side-${i}`),
  ...[0, 1, 2, 3].map(i => `peach-walk-back-${i}`),
  ...[0, 1, 2, 3].map(i => `leaflet-walk-34-${i}`),
  'fg-left', 'fg-right',
  ...[0, 1, 2, 3].map(i => `peach-walk-front-${i}`),
  ...[0, 1, 2, 3].map(i => `bubble-walk-front-${i}`),
  ...[0, 1, 2, 3].map(i => `bubble-walk-back-${i}`),
];
export const TEXTURES = ['ground', 'flower-atlas', 'skyline'] as const;
export const ICONS = ['icon-orange', 'icon-pin'] as const;

export type Tex = Record<string, THREE.Texture>;

export async function loadAll(onProgress: (f: number) => void): Promise<Tex> {
  const loader = new THREE.TextureLoader();
  const jobs: [string, string][] = [
    ...[...SPRITES, ...WALK_FRAMES].map(s => [s, `assets/sprites/${s}.webp`] as [string, string]),
    ...TEXTURES.map(s => [s, `assets/textures/${s}.webp`] as [string, string]),
    ...ICONS.map(s => [s, `assets/ui/${s}.webp`] as [string, string]),
  ];
  let done = 0;
  const out: Tex = {};
  await Promise.all(jobs.map(([k, url]) => new Promise<void>((res, rej) => {
    loader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      out[k] = t; done++; onProgress(done / jobs.length); res();
    }, undefined, () => rej(new Error(`Could not load ${url}`)));
  })));
  return out;
}
