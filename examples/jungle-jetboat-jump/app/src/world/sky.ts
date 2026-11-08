import * as THREE from 'three';
import { PAL } from './palette';
import { rng } from '../core/rng';

/** Gradient sky dome with painted cream cumulus billboards. */
export function buildSky(scene: THREE.Scene) {
  const geo = new THREE.SphereGeometry(1400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(PAL.skyTop) }, mid: { value: new THREE.Color(PAL.skyMid) },
      hor: { value: new THREE.Color(PAL.skyHorizon) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
      void main(){ float h = clamp(vP.y,0.,1.);
        vec3 c = mix(hor, mid, smoothstep(0.0,0.18,h)); c = mix(c, top, smoothstep(0.15,0.6,h));
        gl_FragColor = vec4(c,1.);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // painted cloud texture
  const tex = cloudTexture();
  const group = new THREE.Group();
  const r = rng(77);
  const cmat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(cmat);
    const ang = r() * Math.PI * 2;
    const dist = 500 + r() * 600;
    const big = 120 + r() * 220;
    s.scale.set(big, big * (0.42 + r() * 0.15), 1);
    s.position.set(Math.cos(ang) * dist, 70 + r() * 230, Math.sin(ang) * dist);
    group.add(s);
  }
  scene.add(group);
  return { dome, clouds: group };
}

function cloudTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const r = rng(3);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const x = 90 + r() * 330, rad = 40 + r() * 55;
    const y = 170 - rad * 0.55 - r() * 50 * Math.sin(((x - 90) / 330) * Math.PI);
    puffs.push([x, y, rad]);
  }
  // shade layer (warm underside) then lit tops
  for (const [x, y, rad] of puffs) {
    const gr = g.createRadialGradient(x, y + rad * 0.25, rad * 0.2, x, y, rad);
    gr.addColorStop(0, 'rgba(236,206,170,1)'); gr.addColorStop(0.85, 'rgba(236,206,170,0.95)'); gr.addColorStop(1, 'rgba(236,206,170,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  for (const [x, y, rad] of puffs) {
    const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.35, rad * 0.1, x, y - rad * 0.15, rad * 0.85);
    gr.addColorStop(0, 'rgba(255,252,240,1)'); gr.addColorStop(0.7, 'rgba(255,246,226,0.9)'); gr.addColorStop(1, 'rgba(255,246,226,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y - rad * 0.12, rad * 0.85, 0, Math.PI * 2); g.fill();
  }
  // flatten base
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(0, 190, 0, 256);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade; g.fillRect(0, 190, 512, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
