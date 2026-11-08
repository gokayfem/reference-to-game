import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Optional fal-generated machine housings (static, high-detail shells). Animated parts stay procedural.
 * Anchors come from app/public/assets/models/housings.json (written after Blender normalisation:
 * front +Z, tunnel along X, base at y=0, plinth fits 1.12 x 1.12). Missing/failed models fall back
 * to the procedural housings, so the game never depends on them to run.
 */
export interface HousingAnchor {
  file: string;
  /** y of the surface where procedural parts sit (button, chamber, ice, funnel). */
  top: number;
  /** x offset of the funnel/tower centre for hoppers. */
  topX?: number;
  /** extra uniform scale applied on top of the normalised model (fine-tuning). */
  scale?: number;
  enabled?: boolean;
}

const cache = new Map<string, THREE.Object3D>();
let anchors: Record<string, HousingAnchor> = {};

export async function loadHousings(onProgress?: (p: number) => void) {
  try {
    const r = await fetch('assets/models/housings.json');
    if (!r.ok) return;
    anchors = await r.json();
  } catch { return; }
  const loader = new GLTFLoader();
  const names = Object.keys(anchors).filter((k) => anchors[k].enabled !== false);
  let done = 0;
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`assets/models/${anchors[name].file}`);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        // enamel finish under game lighting: generated textures carry their own soft shading,
        // so keep the surface glossy but avoid metalness that would darken it.
        const phys = new THREE.MeshPhysicalMaterial({
          map: mat.map ?? null, color: mat.map ? '#ffffff' : mat.color, roughness: 0.38, metalness: 0,
          clearcoat: 0.7, clearcoatRoughness: 0.18, normalMap: mat.normalMap ?? null,
        });
        m.material = phys;
      });
      cache.set(name, gltf.scene);
    } catch { /* keep procedural fallback */ }
    onProgress?.(++done / Math.max(1, names.length));
  }));
}

export function housing(name: string): { obj: THREE.Object3D; anchor: HousingAnchor } | null {
  const src = cache.get(name);
  if (!src) return null;
  const obj = src.clone(true);
  const a = anchors[name];
  if (a.scale) obj.scale.setScalar(a.scale);
  return { obj, anchor: a };
}
