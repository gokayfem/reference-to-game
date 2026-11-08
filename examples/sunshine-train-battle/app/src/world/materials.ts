import * as THREE from 'three';

export const PALETTE = {
  trainBlue: '#3a7ab5',
  orange: '#eb6e1b',
  purple: '#7c43a3',
  warmWhite: '#f0e7e1',
  meadow: '#7a9e45',
  sky: '#6fbce8',
  cyan: '#4ff3f0',
  hazardYellow: '#f2b322',
  dark: '#262c36',
};

export interface Textures { roof: THREE.Texture; meadow: THREE.Texture; flowers: THREE.Texture; trees: THREE.Texture; backdrop: THREE.Texture }

const loader = new THREE.TextureLoader();
export function loadTexture(url: string, srgb = true): Promise<THREE.Texture> {
  return new Promise((res, rej) => loader.load(url, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => rej(new Error('Failed to load ' + url))));
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

export function hazardTexture() {
  return canvasTex(256, 64, (g) => {
    g.fillStyle = '#f1b51f'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1f2228';
    for (let x = -64; x < 320; x += 48) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 24, 64); g.lineTo(x + 24 + 40, 0); g.lineTo(x + 40, 0); g.closePath(); g.fill(); }
    // painted wear
    g.globalAlpha = 0.18; g.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 256, Math.random() * 64, 2 + Math.random() * 6, 1);
  }, true);
}

/** Side panel of a carriage: blue painted body, tall windows with orange frames, trim line. */
export function carSideTexture(windows: boolean) {
  return canvasTex(1024, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#3f7fbf'); grd.addColorStop(1, '#2f6aa6');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 256);
    // top hazard band at both ends
    g.fillStyle = '#1f2228'; g.fillRect(0, 10, 1024, 4);
    g.fillStyle = '#e86d1e'; g.fillRect(0, 196, 1024, 8);
    if (windows) {
      for (let i = 0; i < 7; i++) {
        const x = 70 + i * 128;
        g.fillStyle = '#e86d1e'; g.fillRect(x - 5, 50, 78, 120);
        g.fillStyle = '#26364d'; g.fillRect(x, 55, 68, 110);
        g.fillStyle = 'rgba(160,210,240,0.35)'; g.fillRect(x + 6, 60, 18, 100);
      }
    } else {
      g.strokeStyle = 'rgba(20,40,70,0.55)'; g.lineWidth = 3;
      for (let i = 0; i < 5; i++) g.strokeRect(40 + i * 196, 40, 170, 140);
    }
    // small orange lamps
    g.fillStyle = '#ffb347'; g.fillRect(20, 214, 26, 12); g.fillRect(978, 214, 26, 12);
    g.globalAlpha = 0.12; g.fillStyle = '#dfe9f5';
    for (let i = 0; i < 160; i++) g.fillRect(Math.random() * 1024, Math.random() * 256, 1 + Math.random() * 10, 1);
  });
}

export function landingTexture() {
  return canvasTex(256, 128, (g) => {
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(241,181,31,0.95)';
    for (let i = 0; i < 3; i++) {
      const y = 18 + i * 34;
      g.beginPath(); g.moveTo(78, y + 24); g.lineTo(128, y); g.lineTo(178, y + 24); g.lineTo(162, y + 24); g.lineTo(128, y + 8); g.lineTo(94, y + 24); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(241,181,31,0.95)'; g.lineWidth = 6; g.strokeRect(8, 8, 240, 112);
  });
}

export function gateFieldTexture() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = 'rgba(80,240,240,0.18)'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(160,255,255,0.75)'; g.lineWidth = 3;
    for (let y = 0; y < 128; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y + 8); g.stroke(); }
  }, true);
}

export function trackTexture() {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = '#8a8172'; g.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 2500; i++) { const v = 100 + Math.random() * 70; g.fillStyle = `rgb(${v},${v - 6},${v - 16})`; g.fillRect(Math.random() * 256, Math.random() * 512, 3, 3); }
    for (let y = 0; y < 512; y += 64) { g.fillStyle = '#5b4232'; g.fillRect(28, y + 10, 200, 26); g.fillStyle = '#6e5240'; g.fillRect(28, y + 10, 200, 6); }
  }, true);
}

export function glowSprite(color: string) {
  return canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, color); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
}

export function flashSprite() {
  return canvasTex(128, 128, (g) => {
    g.translate(64, 64);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    r.addColorStop(0, 'rgba(255,255,240,1)'); r.addColorStop(0.3, 'rgba(255,190,80,0.9)'); r.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = r;
    for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, i % 2 ? -58 : -38); g.lineTo(6, 0); g.closePath(); g.fill(); }
    g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill();
  });
}

/** Roughness (G channel) from the painted roof: lighter wear marks stay matte, clean paint stays glossy. */
export function wearRoughness(src: THREE.Texture) {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height); const a = d.data;
  let sum = 0; for (let i = 0; i < a.length; i += 4) sum += a[i] + a[i + 1] + a[i + 2];
  const avg = sum / (a.length / 4);
  for (let i = 0; i < a.length; i += 4) {
    const l = a[i] + a[i + 1] + a[i + 2];
    const v = Math.max(0, Math.min(255, 105 + (l - avg) * 1.6 + (Math.random() - 0.5) * 14));
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function makeMaterials(tex: Textures) {
  tex.roof.wrapS = tex.roof.wrapT = THREE.RepeatWrapping;
  tex.roof.anisotropy = 8;
  const hazard = hazardTexture();
  const rough = wearRoughness(tex.roof);
  // glossy painted metal: metallic base under a hard lacquer clearcoat, roughness broken up by wear
  const paint = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial({ roughness: 0.6, roughnessMap: rough, metalness: 0.72, clearcoat: 0.55, clearcoatRoughness: 0.08, ...o });
  return {
    panel: paint({ color: '#a9c9ff', map: tex.roof }),
    blue: paint({ color: '#8fb8f2', map: tex.roof }),
    blueDark: paint({ color: '#2f63a0', roughness: 0.45, roughnessMap: null, clearcoatRoughness: 0.12 }),
    seam: new THREE.MeshStandardMaterial({ color: '#203f66', roughness: 0.8 }),
    orange: new THREE.MeshPhysicalMaterial({ color: '#f26c1c', roughness: 0.22, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.05 }),
    dark: new THREE.MeshPhysicalMaterial({ color: '#2a2f38', roughness: 0.38, metalness: 0.7, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b4bcc6', roughness: 0.16, metalness: 1 }),
    bolt: new THREE.MeshStandardMaterial({ color: '#8f9aa8', roughness: 0.2, metalness: 1 }),
    hazard: new THREE.MeshStandardMaterial({ color: '#ffffff', map: hazard, roughness: 0.55 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff8a1c', emissiveIntensity: 1.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1c2c44', roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#0d3a4a', emissiveIntensity: 0.3 }),
    sideWin: paint({ color: '#cfe0ff', map: carSideTexture(true) }),
    sidePlain: paint({ color: '#cfe0ff', map: carSideTexture(false) }),
    hazardTex: hazard,
  };
}
export type Mats = ReturnType<typeof makeMaterials>;
