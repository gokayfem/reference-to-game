// Map rendering derived from the actual world layout functions.
import { BRIDGES, PLACEMENTS, pathStrength, riverInfo, riverHalfAt, groundHeight, LM, HABITAT_ZONES } from '../world/layout';

export const MAP_RANGE = 62; // metres from centre shown on the full map
let base: HTMLCanvasElement | null = null;

export function mapBase(): HTMLCanvasElement {
  if (base) return base;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!, img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -MAP_RANGE + (i + 0.5) / N * MAP_RANGE * 2, z = -MAP_RANGE + (j + 0.5) / N * MAP_RANGE * 2;
    const h = groundHeight(x, z);
    let r = 150 + h * 4, gg = 192 + h * 3, b = 98;
    const rv = riverInfo(x, z), half = riverHalfAt(x, z);
    if (rv.d < half - 0.2) { r = 112; gg = 180; b = 220; }
    else if (rv.d < half + 0.8) { r = 186; gg = 204; b = 140; }
    const p = pathStrength(x, z); if (p > 0.3) { r = r + (222 - r) * p; gg = gg + (186 - gg) * p; b = b + (128 - b) * p; }
    if (Math.abs(x) > 58 || Math.abs(z) > 58) { r *= 0.88; gg *= 0.9; b *= 0.88; }
    const k = (j * N + i) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const big = document.createElement('canvas'); big.width = big.height = 1024;
  const bg = big.getContext('2d')!; bg.imageSmoothingQuality = 'high'; bg.drawImage(c, 0, 0, 1024, 1024);
  const W = (x: number) => (x + MAP_RANGE) / (MAP_RANGE * 2) * 1024;
  // bridges
  bg.lineCap = 'round';
  for (const br of BRIDGES) { bg.strokeStyle = '#9a6a3c'; bg.lineWidth = 22; bg.beginPath(); bg.moveTo(W(br.a[0]), W(br.a[1])); bg.lineTo(W(br.b[0]), W(br.b[1])); bg.stroke(); bg.strokeStyle = '#c99561'; bg.lineWidth = 14; bg.stroke(); }
  // trees and props as painted dots
  for (const p of PLACEMENTS) {
    if (p.kind.startsWith('tree')) { bg.fillStyle = 'rgba(86,140,62,0.9)'; bg.beginPath(); bg.arc(W(p.x), W(p.z), p.kind === 'tree-poplar' ? 9 : 14, 0, 7); bg.fill(); bg.fillStyle = 'rgba(140,190,90,0.8)'; bg.beginPath(); bg.arc(W(p.x) - 3, W(p.z) - 3, p.kind === 'tree-poplar' ? 5 : 8, 0, 7); bg.fill(); }
    else if (p.kind === 'sunflowers') { bg.fillStyle = '#f1cf3c'; bg.beginPath(); bg.arc(W(p.x), W(p.z), 6, 0, 7); bg.fill(); }
    else if (p.kind === 'tent') { bg.fillStyle = '#5b86c4'; bg.beginPath(); bg.moveTo(W(p.x) - 20, W(p.z) + 12); bg.lineTo(W(p.x), W(p.z) - 16); bg.lineTo(W(p.x) + 20, W(p.z) + 12); bg.fill(); }
    else if (p.kind.startsWith('cottage') || p.kind === 'windmill') { bg.fillStyle = p.kind === 'cottage-blue' ? '#6f95cf' : '#e8875b'; bg.fillRect(W(p.x) - 14, W(p.z) - 12, 28, 24); }
    else if (p.kind === 'lookout-tower') { bg.fillStyle = '#5b86c4'; bg.fillRect(W(p.x) - 12, W(p.z) - 12, 24, 24); }
    else if (p.kind === 'boulders' || p.kind === 'cairn') { bg.fillStyle = '#b8b2a6'; bg.beginPath(); bg.arc(W(p.x), W(p.z), 7, 0, 7); bg.fill(); }
  }
  // habitat rings
  bg.setLineDash([10, 8]); bg.lineWidth = 3; bg.strokeStyle = 'rgba(255,255,255,0.7)';
  for (const h of HABITAT_ZONES) { bg.beginPath(); bg.arc(W(h.c[0]), W(h.c[1]), h.r / (MAP_RANGE * 2) * 1024, 0, 7); bg.stroke(); }
  bg.setLineDash([]);
  void LM;
  base = big; return big;
}

export const LABELS: { id: string; text: string; x: number; z: number; icon: string }[] = [
  { id: 'camp', text: 'Research Camp', x: 22, z: 10, icon: '⛺' },
  { id: 'sunflowers', text: 'Sunflower Meadow', x: -30, z: 4, icon: '🌻' },
  { id: 'orchard', text: 'Orchard', x: -28, z: -30, icon: '🍊' },
  { id: 'riverbank', text: 'Riverbank', x: 14, z: 24, icon: '💧' },
  { id: 'lookout', text: 'Lookout Hill', x: 36, z: -32, icon: '🔭' },
  { id: 'village', text: 'Village (scenic)', x: 42, z: -52, icon: '🏡' },
  { id: 'start', text: 'Picnic Spot', x: -13, z: 30, icon: '' },
];
