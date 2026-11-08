import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Quality } from './materials';

/** Final display-space grade: punchier contrast, richer candy saturation, soft vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1.14 }, saturation: { value: 1.16 }, vignette: { value: 0.16 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float vignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, saturation);
      col = (col - 0.5) * contrast + 0.5;
      // gentle S-curve keeps cream highlights from clipping
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      vec2 d = vUv - 0.5; col *= 1.0 - vignette * dot(d, d) * 2.2;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/** Renderer, camera, daylight rig and the painted room backdrop (fal-generated, cover-fit). */
export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private bgScene = new THREE.Scene();
  private bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bgMat: THREE.ShaderMaterial;
  shadowCatcher: THREE.Mesh;
  boardExtent = new THREE.Box3();
  /** Fraction of viewport reserved by HUD at top / bottom (keeps board clear of the toolbar). */
  safeTop = 0.12;
  safeBottom = 0.17;
  safeLeft = 0.02;
  safeRight = 0.17;
  quality: Quality = 'high';

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 200);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight('#fff4e6', '#a9c6bd', 0.38);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffeccf', 2.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#dfeeff', 0.3);
    fill.position.set(10, 8, 12);
    this.scene.add(fill);

    // shadow catcher: the room floor plane below the board
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.36, color: '#4a3526' }));
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    this.bgMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, uvOffset: { value: new THREE.Vector2(0, 0) }, hasMap: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D map; uniform vec2 uvScale; uniform vec2 uvOffset; uniform float hasMap; varying vec2 vUv;
        void main(){
          vec3 top = vec3(0.80, 0.90, 0.95); vec3 bot = vec3(0.93, 0.89, 0.85);
          vec3 c = mix(bot, top, vUv.y);
          if (hasMap > 0.5) c = texture2D(map, vUv * uvScale + uvOffset).rgb;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat));

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.bgScene, this.bgCam));
    const main = new RenderPass(this.scene, this.camera);
    main.clear = false; main.clearDepth = true;
    this.composer.addPass(main);
    // ground-truth AO: soft contact darkening where machines, belts and candy meet the board (High only)
    this.ao = new GTAOPass(this.scene, this.camera, 512, 512);
    this.ao.blendIntensity = 1.0;
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.5, scale: 1.0, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    const aoSetSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w: number, h: number) => aoSetSize(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.25, 1.9);
    // highlight-only bloom computed at quarter resolution (cheap; threshold keeps cream surfaces clean)
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => bloomSetSize(Math.max(1, w * 0.5), Math.max(1, h * 0.5));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
  }
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: GTAOPass;

  setBackdrop(tex: THREE.Texture) {
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bgMat.uniforms.map.value = tex;
    this.bgMat.uniforms.hasMap.value = 1;
    this.resize();
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.5 : 1);
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);
    this.bloom.enabled = q === 'high';
    this.ao.enabled = q === 'high';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.resize();
  }

  private resScale = 1;
  /** Render-resolution multiplier on top of the DPR cap (adaptive quality tier 3). */
  setResolutionScale(k: number) {
    this.resScale = k;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1) * k;
    this.renderer.setPixelRatio(dpr); this.composer.setPixelRatio(dpr);
    this.sun.shadow.mapSize.set(1024, 1024); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    this.resize();
  }

  /** Board extents (world) so the camera can fit it inside the HUD-safe area. */
  setBoardExtent(box: THREE.Box3) {
    this.boardExtent.copy(box);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    // warm key light from the upper-left window, slightly in front
    this.sun.position.set(c.x - size.x * 0.55, 22, c.z + size.z * 0.15 - 4);
    this.sun.target.position.copy(c);
    const s = Math.max(size.x, size.z) * 0.75 + 2;
    const cam = this.sun.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 1; cam.far = 60;
    cam.updateProjectionMatrix();
    this.shadowCatcher.position.y = box.min.y + 0.001;
    this.fitCamera();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const tex = this.bgMat.uniforms.map.value as THREE.Texture | null;
    if (tex?.image) {
      const ia = tex.image.width / tex.image.height, va = w / h;
      const sc = this.bgMat.uniforms.uvScale.value as THREE.Vector2, of = this.bgMat.uniforms.uvOffset.value as THREE.Vector2;
      if (va > ia) { sc.set(1, ia / va); of.set(0, (1 - ia / va) * 0.5); } else { sc.set(va / ia, 1); of.set((1 - va / ia) * 0.5, 0); }
    }
    this.fitCamera();
  }

  /** Straight-on high three-quarter view (reference framing): pitch ~57°, mild perspective, fit to safe area. */
  fitCamera() {
    if (this.boardExtent.isEmpty()) return;
    const box = this.boardExtent;
    const center = box.getCenter(new THREE.Vector3());
    const pitch = THREE.MathUtils.degToRad(52);
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const target = center.clone();
    let dist = 30;
    const cam = this.camera;
    const place = () => {
      cam.position.set(target.x, target.y + Math.sin(pitch) * dist, target.z + Math.cos(pitch) * dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    };
    const usableTop = 1 - this.safeTop * 2, usableBot = -1 + this.safeBottom * 2;
    for (let it = 0; it < 40; it++) {
      place();
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const c of corners) { const p = c.clone().project(cam); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
      const usableL = -1 + this.safeLeft * 2, usableR = 1 - this.safeRight * 2;
      const sx = (maxX - minX) / (usableR - usableL), sy = (maxY - minY) / (usableTop - usableBot);
      const midX = (maxX + minX) / 2, wantX = (usableL + usableR) / 2;
      target.x += THREE.MathUtils.clamp((midX - wantX) * dist * 0.25, -2, 2);
      const s = Math.max(sx, sy);
      dist *= 0.5 + 0.5 * s;
      // shift target so the projected box centre sits in the middle of the safe band
      const midY = (maxY + minY) / 2, wantY = (usableTop + usableBot) / 2;
      target.z -= THREE.MathUtils.clamp((midY - wantY) * dist * 0.25, -2, 2);
      if (Math.abs(s - 1) < 0.004 && Math.abs(midY - wantY) < 0.004 && Math.abs(midX - wantX) < 0.004) break;
    }
    place();
  }

  render() {
    this.composer.render();
  }
}
