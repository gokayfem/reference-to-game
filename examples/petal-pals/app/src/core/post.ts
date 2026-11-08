// Restrained painterly grade: applied after OutputPass (in display sRGB space).
// Matches the reference's richer saturation, gentle warm highlights, deeper foreground and soft vignette —
// no bloom, no depth of field.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.12 }, uContrast: { value: 1.07 }, uVignette: { value: 0.32 }, uGlow: { value: 0.10 },
    uAspect: { value: 16 / 9 }, uPaper: { value: 0.018 }, uTime: { value: 0 }, uEnabled: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette, uGlow, uAspect, uPaper, uTime, uEnabled; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uEnabled < 0.5) { gl_FragColor = vec4(c, 1.0); return; }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);                                  // richer painted colour
      c = (c - 0.5) * uContrast + 0.5;                            // a touch more value contrast
      // warm highlights, slightly cooler-green shadows (gouache feel)
      c *= mix(vec3(0.97, 1.0, 0.99), vec3(1.035, 1.0, 0.95), smoothstep(0.35, 0.9, l));
      // soft sun glow from the upper right (reference light direction)
      vec2 sp = (vUv - vec2(0.82, 1.05)) * vec2(uAspect, 1.0);
      c += vec3(1.0, 0.93, 0.78) * uGlow * exp(-dot(sp, sp) * 1.6);
      // vignette, heavier along the bottom foreground like the painting's framing foliage
      vec2 q = (vUv - 0.5) * vec2(uAspect * 0.75, 1.0);
      float v = smoothstep(0.45, 1.05, length(q)) + smoothstep(0.32, 0.0, vUv.y) * 0.45;
      c *= 1.0 - uVignette * v * vec3(0.85, 0.9, 1.0);
      // faint paper grain (kept very low so UI/edges never turn grey)
      c += (hash(floor(vUv * vec2(960.0, 540.0)) + floor(uTime * 0.0)) - 0.5) * uPaper;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { composer, grade };
}
