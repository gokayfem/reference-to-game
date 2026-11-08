import * as THREE from 'three';

/** Palette anchors derived from style/palette.json and direct sampling of the original image. */
export const PAL = {
  cream: '#ecdac0',
  creamShade: '#e6d6bd',
  ivory: '#f3e8d8',
  tile: '#efe4d8',
  tileAlt: '#e9ddd0',
  grout: '#cdbdad',
  mint: '#9fcfc4',
  mintDeep: '#6faea2',
  teal: '#4fb3a1',
  coral: '#ec8b76',
  orange: '#f28a3a',
  yellow: '#f4c24c',
  pink: '#ec9aa5',
  blue: '#4c86c6',
  navy: '#1d4f86',
  wood: '#8a5a3e',
  woodLight: '#a3714f',
  steel: '#c9c8c4',
  roller: '#6f6a66',
  text: '#1f4b52',
  red: '#e3112b',
  lemon: '#fcd21c',
  candyOrange: '#ff7a12',
  candyBlue: '#1a74d8',
};

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Build a tangent-space normal map (non-colour data) from a height function h(x, y) in [0, 1]. */
export function normalMapFrom(w: number, h: number, height: (x: number, y: number) => number, strength = 2, wrap = false) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x, y);
  const at = (x: number, y: number) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); }
    return H[y * w + x];
  };
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const nx = -dx, ny = dy, nz = 1, l = Math.hypot(nx, ny, nz);
    const i = ((h - 1 - y) * w + x) * 4; // flip rows: canvas y-down vs texture v-up
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (nz / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Height of a beveled glazed tile grid: flat plateaus, rounded edges, recessed grout. */
export function tileNormalMap(cols: number, rows: number) {
  const px = 64;
  return normalMapFrom(cols * px, rows * px, (x, y) => {
    const lx = x % px, ly = y % px;
    const d = Math.min(lx, ly, px - 1 - lx, px - 1 - ly);
    if (d < 1) return 0;
    const t = Math.min(1, (d - 1) / 8);
    return t * t * (3 - 2 * t);
  }, 2.4);
}

/** Slat grooves for belts (u along travel). */
export function slatNormalMap() {
  const w = 192, h = 32, n = 6, sw = w / n;
  return normalMapFrom(w, h, (x) => {
    const lx = x % sw;
    const d = Math.min(lx, sw - 1 - lx);
    if (d < 1.5) return 0;
    const t = Math.min(1, (d - 1.5) / 5);
    return t * t * (3 - 2 * t);
  }, 3.5, true);
}

/** Warm pale floor tiles, one tile per cell with soft tone variation and thin grout. */
export function tileTexture(cols: number, rows: number) {
  const px = 128;
  const t = canvasTex(cols * px, rows * px, (g) => {
    g.fillStyle = PAL.grout;
    g.fillRect(0, 0, cols * px, rows * px);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = rnd();
      const base = v < 0.33 ? [236, 224, 211] : v < 0.66 ? [231, 218, 204] : [227, 214, 199];
      const x = c * px + 2, y = r * px + 2, s = px - 4;
      const grd = g.createLinearGradient(x, y, x + s, y + s);
      grd.addColorStop(0, `rgb(${base[0] + 4},${base[1] + 4},${base[2] + 4})`);
      grd.addColorStop(1, `rgb(${base[0] - 3},${base[1] - 4},${base[2] - 4})`);
      g.fillStyle = grd;
      roundRect(g, x, y, s, s, 6); g.fill();
      // faint marble speckle
      g.globalAlpha = 0.07;
      for (let i = 0; i < 18; i++) {
        g.fillStyle = rnd() > 0.5 ? '#ffffff' : '#bfae9c';
        g.beginPath(); g.ellipse(x + rnd() * s, y + rnd() * s, 4 + rnd() * 14, 2 + rnd() * 6, rnd() * 3, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }
  });
  return t;
}

/** Timber belt slats; u runs along travel, v across the belt. Repeats per cell. */
export function slatTexture() {
  const t = canvasTex(256, 128, (g) => {
    const n = 6;
    const w = 256 / n;
    for (let i = 0; i < n; i++) {
      const x = i * w;
      const tone = i % 2 ? '#74462c' : '#83523a';
      g.fillStyle = tone; g.fillRect(x, 0, w, 128);
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(255,220,180,0.20)');
      grd.addColorStop(0.15, 'rgba(255,220,180,0.05)');
      grd.addColorStop(0.85, 'rgba(0,0,0,0.0)');
      grd.addColorStop(1, 'rgba(40,20,10,0.45)');
      g.fillStyle = grd; g.fillRect(x, 0, w, 128);
      // grain
      g.strokeStyle = 'rgba(60,30,15,0.18)'; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x + 6 + k * 11, 0); g.lineTo(x + 8 + k * 11, 128); g.stroke(); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function labelTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; size?: number; round?: number; border?: string } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 160;
  return canvasTex(w, h, (g) => {
    if (opts.bg) {
      g.fillStyle = opts.bg; roundRect(g, 4, 4, w - 8, h - 8, opts.round ?? 28); g.fill();
      if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = 8; g.stroke(); }
    }
    g.fillStyle = opts.fg ?? '#fff';
    g.font = `700 ${opts.size ?? 64}px Fredoka, "Trebuchet MS", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = text.split('\n');
    const lh = (opts.size ?? 64) * 1.02;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh + 3));
  });
}

export function snowflakeTexture(fg = '#ffffff') {
  return canvasTex(256, 256, (g) => {
    g.translate(128, 128);
    g.strokeStyle = fg; g.lineCap = 'round'; g.lineWidth = 14;
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -96); g.stroke();
      g.beginPath(); g.moveTo(0, -56); g.lineTo(-26, -80); g.moveTo(0, -56); g.lineTo(26, -80); g.stroke();
    }
  });
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const cache = new Map<string, THREE.Material>();
/** Glossy enamel (machines, rims). Shared instances; never disposed during play. */
export function enamel(color: string, rough = 0.42, coat = 0.6): THREE.MeshPhysicalMaterial {
  // glossier enamel: everything gets a tighter highlight and a crisp clearcoat
  rough = rough * 0.6; coat = Math.max(coat, 0.75);
  const k = `en:${color}:${rough}:${coat}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.12, metalness: 0 }));
  return cache.get(k) as THREE.MeshPhysicalMaterial;
}
export function matte(color: string, rough = 0.85): THREE.MeshStandardMaterial {
  const k = `mt:${color}:${rough}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return cache.get(k) as THREE.MeshStandardMaterial;
}
export function metal(color = PAL.steel, rough = 0.35): THREE.MeshStandardMaterial {
  const k = `me:${color}:${rough}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.75 }));
  return cache.get(k) as THREE.MeshStandardMaterial;
}

export type Quality = 'high' | 'low';
/** Translucent gummy. High quality uses transmission; low uses emissive-tinted gloss (same hue/value). */
export function gummy(color: string, quality: Quality, opts: { frost?: boolean } = {}): THREE.MeshPhysicalMaterial {
  const k = `gm:${color}:${quality}:${opts.frost ? 1 : 0}`;
  if (!cache.has(k)) {
    const c = new THREE.Color(color);
    const m = new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: opts.frost ? 0.35 : 0.06,
      clearcoat: 1,
      clearcoatRoughness: opts.frost ? 0.3 : 0.03,
      emissive: c.clone().multiplyScalar(quality === 'high' ? 0.18 : 0.3),
      sheen: 0.12,
      sheenColor: new THREE.Color('#ffffff'),
    });
    if (quality === 'high') {
      m.transmission = 0.55;
      m.thickness = 0.35;
      m.ior = 1.35;
      m.attenuationColor = c.clone();
      m.attenuationDistance = 0.25;
    }
    cache.set(k, m);
  }
  return cache.get(k) as THREE.MeshPhysicalMaterial;
}

export function clearGlass(tint = '#ffffff', opacity = 0.28): THREE.MeshPhysicalMaterial {
  const k = `gl:${tint}:${opacity}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshPhysicalMaterial({
    color: tint, roughness: 0.05, transparent: true, opacity, clearcoat: 1, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
  }));
  return cache.get(k) as THREE.MeshPhysicalMaterial;
}
