import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Renderer, camera, light rig and post-processing for the 3D prototype.
//
// Look: night-time sci-fi deck. A cool, low key light rakes across the platform so panels,
// bolts and hulls read through real shading and cast soft shadows; a dim environment map gives
// metals something to reflect; neon parts are emissive and the only things that bloom.

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  composer: EffectComposer;
  keyLight: THREE.DirectionalLight;
  resize: (pixelRatio?: number) => void;
  setAmbientOcclusion: (on: boolean) => void;
  dispose: () => void;
}

// Night-time reflection environment: a dark hangar with a cool overhead softbox and a few neon
// strips. Metals and gloss then pick up believable highlights instead of a bright studio.
const makeNightEnvironment = () => {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: '#06080c', side: THREE.BackSide })));
  const panel = (w: number, h: number, color: string, k: number, pos: [number, number, number], rot: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot);
    env.add(m);
  };
  panel(26, 10, '#b8c8ff', 2.2, [-6, 14.5, -4], [Math.PI / 2, 0, 0]);   // overhead softbox
  panel(40, 0.6, '#00e5ff', 6, [0, 4, -29], [0, 0, 0]);                 // cyan strip, back wall
  panel(0.6, 30, '#00e5ff', 5, [-29, 6, 0], [0, Math.PI / 2, 0]);       // cyan strip, left wall
  panel(18, 0.5, '#ffb000', 5, [10, 2.5, 29], [0, Math.PI, 0]);         // amber strip, front
  panel(10, 4, '#ff6a3d', 0.8, [29, 8, 10], [0, -Math.PI / 2, 0]);     // warm bounce, right
  return env;
};

// Dimetric 2:1 isometric view (30° elevation, 45° azimuth) — same angle as the 2D game
export const CAM_DIR = new THREE.Vector3(Math.sin(Math.PI / 4) * Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6));

export interface StageOptions {
  focus: THREE.Vector3;  // ground point at the centre of the view
  viewHeight: number;    // world units visible vertically
  viewWidth?: number;    // fixed width in world units; default: follow the host's aspect ratio
}

export const createStage = (host: HTMLElement, { focus, viewHeight, viewWidth }: StageOptions): Stage => {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens once, in OutputPass
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05080e');
  // Fog only reaches the void below the deck (the deck spans ~170–290 units from the camera)
  scene.fog = new THREE.Fog('#05080e', 300, 460);

  // Reflections: a neutral studio environment, turned well down for a night scene
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(makeNightEnvironment(), 0.03).texture;
  scene.environmentIntensity = 1.0;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
  camera.position.copy(CAM_DIR.clone().multiplyScalar(220).add(focus));
  camera.lookAt(focus);

  // Key: cool moonlight raking in from the back-left, casting the main shadows
  const keyLight = new THREE.DirectionalLight('#c3d2ff', 2.6);
  keyLight.position.set(-80, 62, -30);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  const sc = keyLight.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 260;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.04;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);

  // Fill: deep blue sky / near-black ground bounce
  scene.add(new THREE.HemisphereLight('#2f4470', '#07090c', 1.1));
  // Rim: a faint warm counter-light from the front-right so silhouettes separate from the deck
  const rim = new THREE.DirectionalLight('#ffb36b', 0.35);
  rim.position.set(70, 30, 60);
  scene.add(rim);

  // Post: MSAA scene render → ambient occlusion → bloom (only HDR-bright emissives) → tone map
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.blendIntensity = 0.85;
  gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.5, scale: 1.2, samples: 16 });
  composer.addPass(gtao);
  const setAmbientOcclusion = (on: boolean) => { gtao.enabled = on; };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 1.0);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);
  renderer.toneMappingExposure = 1.15;
  // OutputPass reads the renderer's tone mapping settings
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // pixelRatio: device pixels per CSS pixel of the host (callers that CSS-scale the host pass it in)
  const resize = (pixelRatio = Math.min(window.devicePixelRatio, 2)) => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    const width = viewWidth ?? viewHeight * (w / h);
    camera.left = -width / 2; camera.right = width / 2;
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
  };
  resize();

  const dispose = () => {
    composer.dispose();
    target.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { renderer, scene, camera, composer, keyLight, resize, setAmbientOcclusion, dispose };
};
