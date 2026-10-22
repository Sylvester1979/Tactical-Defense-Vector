import * as THREE from 'three';
import { CANVAS_WIDTH, CANVAS_HEIGHT, ENEMY_TYPES, PATH, TOWER_STATS } from '../constants';
import { EnemyInstance, FloatingText, Particle, Point, Projectile, TowerInstance, TowerType } from '../types';
import { fromIso } from '../lib/iso';
import type { View } from '../lib/view';
import { checkPlacement } from '../lib/placement';
import { createStage } from './stage';
import { buildWorld } from './world';
import { buildGhost, buildTower, loadTowerModels, TowerModel } from './towers';
import { buildEnemy, EnemyModel, loadEnemyModels } from './enemies';
import { createFx } from './fx';
import { onLoadProgress } from './loader';
import { toWorld, ROAD_H, ROAD_W, UNIT, FIELD_W, FIELD_D } from './coords';

// The game rendered in WebGL. Each frame it reads the current game state and brings the scene in
// line with it: models are created, moved, animated and retired by entity id. The camera is set up
// so the ground plane lands on exactly the same pixels as the 2D isometric projection (toIso), so
// clicks, the tower panel and placement checks keep working in the same 1000×800 frame.

export interface SceneInputs {
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  projectiles: Projectile[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  selectedTowerId: string | null;
  relocatingTowerId: string | null;
  placingType: TowerType | null;
  shakeTime: number;
  coreIntegrity: number;
  hoveredTowerId: string | null;
  mouse: Point | null; // cursor in game coordinates while placing or relocating
  view: View;          // where the 1000×800 frame sits in the (full-window) host
}

// toIso maps one game px along x to 0.6 screen px horizontally; that axis sits at 45° to the view
const PX_PER_UNIT = (0.6 * UNIT) / Math.SQRT1_2;
const VIEW_W = CANVAS_WIDTH / PX_PER_UNIT;
const VIEW_H = CANVAS_HEIGHT / PX_PER_UNIT;

const PATH_LENGTH = PATH.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - PATH[i].x, p.y - PATH[i].y), 0);
const CORE = toWorld(PATH[PATH.length - 1].x, PATH[PATH.length - 1].y);
const ENTRY_LABEL = toWorld(PATH[0].x, PATH[0].y).setY(8.4);
const CORE_LABEL = CORE.clone().setY(12.4);

// Rough top of each hull above its origin, for health bars
const HULL_TOP: Record<string, number> = { SCOUT: 0.8, INTERCEPTOR: 0.7, PHANTOM: 0.9, GUARDIAN: 2.7, COLOSSUS: 5.6 };
// Enemies are drawn larger than life so they stay readable at the full-field zoom; the small,
// fast flyers get the biggest boost
const ENEMY_SCALE: Record<string, number> = { SCOUT: 1.3, INTERCEPTOR: 1.35, PHANTOM: 1.25, GUARDIAN: 1.2, COLOSSUS: 1.1 };

const hdr = (c: THREE.ColorRepresentation, k: number) => new THREE.Color(c).multiplyScalar(k);
const additive = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

// The road as capsules in world XZ (segment ends; the joints round the corners off)
const ROAD_SEGS = PATH.slice(1).map((p, i) => {
  const a = toWorld(PATH[i].x, PATH[i].y), b = toWorld(p.x, p.y);
  return new THREE.Vector4(a.x, a.z, b.x, b.z);
});

// Additive overlay drawn only where it lies over the road
const roadMasked = (color: THREE.ColorRepresentation, opacity = 1) => {
  const m = additive(color, opacity);
  m.onBeforeCompile = shader => {
    shader.uniforms.uRoadSegs = { value: ROAD_SEGS };
    shader.uniforms.uRoadHalf = { value: ROAD_W / 2 };
    shader.vertexShader = 'varying vec2 vRoadXZ;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = `varying vec2 vRoadXZ;\nuniform vec4 uRoadSegs[${ROAD_SEGS.length}];\nuniform float uRoadHalf;\n` +
      shader.fragmentShader.replace('void main() {', `void main() {
  float dRoad = 1e9;
  for (int i = 0; i < ${ROAD_SEGS.length}; i++) {
    vec2 a = uRoadSegs[i].xy, ab = uRoadSegs[i].zw - a;
    float h = clamp(dot(vRoadXZ - a, ab) / dot(ab, ab), 0.0, 1.0);
    dRoad = min(dRoad, length(vRoadXZ - a - ab * h));
  }
  if (dRoad > uRoadHalf) discard;`);
  };
  return m;
};

const radialTexture = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
})();

const family = (type: TowerType) => {
  const base = TOWER_STATS[type].type;
  if (base === TowerType.SNIPER) return 'railgun';
  if (base === TowerType.SPLASH) return 'mortar';
  return 'vulcan';
};
const isSpecialized = (type: TowerType) => TOWER_STATS[type].type !== type;
const towerRange = (type: TowerType, level: number) => TOWER_STATS[type].range * (1 + (level - 1) * 0.1);

// Shared geometry
const ringGeo = new THREE.RingGeometry(0.965, 1, 96).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const pipGeo = new THREE.BoxGeometry(0.18, 0.07, 0.1);
const tracerGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6).rotateZ(Math.PI / 2);
const boltGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.6, 6).rotateZ(Math.PI / 2);
const shellGeo = new THREE.SphereGeometry(0.32, 14, 10);
const haloGeo = new THREE.SphereGeometry(1, 16, 12);
const frostGeo = new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2);

let modelsLoading: Promise<void> | null = null;
const loadModels = () => (modelsLoading ??= Promise.all([loadTowerModels(), loadEnemyModels()])
  .then(() => undefined)
  .catch(err => console.error('model load failed, using procedural models', err)));

type GlowMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

interface TowerView {
  model: TowerModel; type: TowerType; level: number; x: number; y: number;
  kick: number; pool: THREE.Mesh; pips: THREE.Mesh[]; specRing: THREE.Mesh | null;
}
interface EnemyView {
  model: EnemyModel; type: string; prev: THREE.Vector3; heading: number; hitAt: number; flash: number;
  halo: GlowMesh; frost: GlowMesh; burn: GlowMesh; seen: boolean; last: EnemyInstance;
}
interface ProjectileView {
  mesh: THREE.Mesh; offset: THREE.Vector3; fam: 'vulcan' | 'railgun' | 'mortar'; color: string;
  marker: THREE.Group | null; last: Projectile; seen: boolean;
}

export const createGameScene = (
  host: HTMLElement, hud: HTMLCanvasElement, read: () => SceneInputs,
  onReady: () => void, onProgress: (fraction: number) => void,
) => {
  const focus = fromIso(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
  const stage = createStage(host, { focus: toWorld(focus.x, focus.y), viewHeight: VIEW_H, viewWidth: VIEW_W });
  const { scene, camera } = stage;
  const world = buildWorld(scene);
  const fx = createFx(scene);
  const hudCtx = hud.getContext('2d')!;

  const towers = new Map<string, TowerView>();
  const enemies = new Map<string, EnemyView>();
  const projectiles = new Map<string, ProjectileView>();

  // ── Overlays on the deck: range, selection, placement grid, ghost ──
  // A tower's reach, drawn on the deck and again on top of the raised road, which would otherwise
  // hide it right where the enemies walk. The road copy is brighter: that's the part that matters.
  const makeRange = (deckFill: number, deckEdge: number, roadFill: number, roadEdge: number) => {
    const group = new THREE.Group();
    const fills: THREE.MeshBasicMaterial[] = [], edges: THREE.MeshBasicMaterial[] = [];
    const layer = (geo: THREE.BufferGeometry, mat: THREE.MeshBasicMaterial, y: number, into: THREE.MeshBasicMaterial[]) => {
      if (mat.opacity <= 0) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = y;
      group.add(mesh);
      into.push(mat);
    };
    layer(discGeo, additive('#ffffff', deckFill), 0.04, fills);
    layer(ringGeo, additive('#ffffff', deckEdge), 0.05, edges);
    layer(discGeo, roadMasked('#ffffff', roadFill), ROAD_H + 0.02, fills);
    layer(ringGeo, roadMasked('#ffffff', roadEdge), ROAD_H + 0.03, edges);
    group.visible = false;
    scene.add(group);
    return {
      show(x: number, y: number, radius: number, color: string) {
        group.visible = true;
        group.position.copy(toWorld(x, y));
        group.scale.set(radius / UNIT, 1, radius / UNIT); // flat: keep the layers' heights
        fills.forEach(m => m.color.copy(hdr(color, 1)));
        edges.forEach(m => m.color.copy(hdr(color, 1.4)));
      },
      hide() { group.visible = false; },
    };
  };
  const range = makeRange(0.06, 0.55, 0.16, 0.95);
  const hoverRange = makeRange(0, 0.25, 0.06, 0.5);
  const selectRing = new THREE.Mesh(new THREE.RingGeometry(2.75, 2.95, 64).rotateX(-Math.PI / 2), additive('#ffffff', 0.9));
  selectRing.visible = false;
  scene.add(selectRing);
  const ghostPad = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.6, 8, 1, Math.PI / 8).rotateX(-Math.PI / 2), additive('#ffffff', 0.8));
  ghostPad.visible = false;
  scene.add(ghostPad);

  const grid = (() => {
    const pts: number[] = [];
    const step = 4;
    for (let x = -FIELD_W / 2; x <= FIELD_W / 2 + 0.01; x += step) pts.push(x, 0, -FIELD_D / 2, x, 0, FIELD_D / 2);
    for (let z = -FIELD_D / 2; z <= FIELD_D / 2 + 0.01; z += step) pts.push(-FIELD_W / 2, 0, z, FIELD_W / 2, 0, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: hdr('#00e5ff', 0.5), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.position.y = 0.03;
    lines.visible = false;
    scene.add(lines);
    return lines;
  })();

  const ghosts = new Map<string, THREE.Object3D>();
  const ghostFor = (type: TowerType, valid: boolean) => {
    const key = `${type}:${valid}`;
    let g = ghosts.get(key);
    if (!g) {
      g = buildGhost(type, valid ? TOWER_STATS[type].color : '#ff3b3b').root;
      g.visible = false;
      scene.add(g);
      ghosts.set(key, g);
    }
    return g;
  };

  // ── Particles from the game (sparks, debris dust) ──
  const MAX_PARTICLES = 600;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3), pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 5, sizeAttenuation: false, vertexColors: true, map: radialTexture(), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const tmpColor = new THREE.Color();

  // ── Towers ──
  const createTower = (t: TowerInstance): TowerView => {
    const model = buildTower(t.type, { light: false });
    const color = TOWER_STATS[t.type].color;
    // Coloured light pooling on the deck around the tower (a decal, not a light)
    const pool = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      map: radialTexture(), color: hdr(color, 0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    pool.scale.set(11, 1, 11);
    pool.position.y = 0.025;
    model.root.add(pool);
    // Level lights along the plinth edge facing the camera
    const front = new THREE.Vector3(1, 0, 1).normalize(), side = new THREE.Vector3(1, 0, -1).normalize();
    const pipOn = new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: 4 });
    const pips: THREE.Mesh[] = [];
    const maxPips = isSpecialized(t.type) ? 5 : 3;
    for (let i = 0; i < maxPips; i++) {
      const pip = new THREE.Mesh(pipGeo, pipOn);
      pip.position.copy(front).multiplyScalar(1.78).addScaledVector(side, (i - (maxPips - 1) / 2) * 0.27).setY(0.91);
      pip.rotation.y = Math.PI / 4;
      model.root.add(pip);
      pips.push(pip);
    }
    let specRing: THREE.Mesh | null = null;
    if (isSpecialized(t.type)) {
      specRing = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.05, 8, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: 3 }));
      specRing.position.y = 1.15;
      model.root.add(specRing);
    }
    model.root.position.copy(toWorld(t.x, t.y));
    scene.add(model.root);
    return { model, type: t.type, level: -1, x: t.x, y: t.y, kick: 0, pool, pips, specRing };
  };

  const removeObject = (o: THREE.Object3D) => {
    o.removeFromParent();
    o.traverse(c => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Model geometry/materials are shared with the loaded templates; only free per-instance ones
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => { if (m.userData.perInstance) m.dispose(); });
    });
  };

  // ── Enemies ──
  const createEnemy = (e: EnemyInstance): EnemyView => {
    const model = buildEnemy(e.type);
    const scale = ENEMY_SCALE[e.type] ?? 1.25;
    model.root.scale.setScalar(scale);
    // Status effects are sized in world units, so they're set against the model's scale
    const size = (ENEMY_TYPES[e.type]?.size ?? 14) / UNIT / scale;
    const halo = new THREE.Mesh(haloGeo, additive(hdr('#ffffff', 1.4), 0));
    halo.material.userData.perInstance = true;
    halo.scale.setScalar(size * 0.75);
    halo.visible = false;
    const frost = new THREE.Mesh(frostGeo, additive(hdr('#7dd3fc', 3), 0.85));
    frost.material.userData.perInstance = true;
    frost.scale.setScalar(size * 1.2);
    frost.visible = false;
    const burn = new THREE.Mesh(haloGeo, additive(hdr('#ff7a1a', 1.6), 0.3));
    burn.material.userData.perInstance = true;
    burn.scale.setScalar(size * 0.8);
    burn.visible = false;
    model.root.add(halo, frost, burn);
    scene.add(model.root);
    const pos = toWorld(e.x, e.y);
    return { model, type: e.type, prev: pos, heading: 0, hitAt: e.lastHitTime, flash: 0, halo, frost, burn, seen: true, last: e };
  };

  const enemyPosition = (e: EnemyInstance, view?: EnemyView) =>
    toWorld(e.x, e.y).setY(ROAD_H + (view?.model.hover ?? 0));

  // ── Projectiles ──
  const muzzleWorld = new THREE.Vector3();
  const createProjectile = (p: Projectile, inputs: SceneInputs): ProjectileView => {
    const fam = family(p.type);
    const color = TOWER_STATS[p.type].color;
    const start = toWorld(p.startX, p.startY, p.startZ);
    const offset = new THREE.Vector3();
    // The shot that just appeared: kick the tower that fired it, flash its muzzle
    const shooter = inputs.towers.reduce<TowerInstance | null>((best, t) => {
      const d = Math.hypot(t.x - p.startX, t.y - p.startY);
      return d < 20 && (!best || d < Math.hypot(best.x - p.startX, best.y - p.startY)) ? t : best;
    }, null);
    const view = shooter && towers.get(shooter.id);
    if (view) {
      view.kick = 1;
      view.model.root.updateMatrixWorld(true);
      view.model.muzzles[0].getWorldPosition(muzzleWorld);
      offset.copy(muzzleWorld).sub(start);
      fx.muzzleFlash(muzzleWorld, color, fam === 'mortar' ? 0.42 : fam === 'railgun' ? 0.5 : 0.32);
      if (fam === 'railgun') fx.beam(muzzleWorld, toWorld(p.targetX, p.targetY, p.targetZ + 8), color);
    }
    const geo = fam === 'mortar' ? shellGeo : fam === 'railgun' ? boltGeo : tracerGeo;
    const mesh = new THREE.Mesh(geo, additive(hdr(color, fam === 'mortar' ? 5 : 8)));
    mesh.material.userData.perInstance = true;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), toWorld(p.targetX, p.targetY, p.targetZ).sub(start).normalize());
    scene.add(mesh);
    let marker: THREE.Group | null = null;
    if (fam === 'mortar') {
      // Where the shell will land: blast radius, plus a ring that closes as it comes down
      marker = new THREE.Group();
      const r = (p.splashRadius ?? 40) / UNIT;
      const edge = new THREE.Mesh(ringGeo, additive(hdr(color, 1.6), 0.5));
      edge.material.userData.perInstance = true;
      edge.scale.setScalar(r);
      const closing = new THREE.Mesh(ringGeo, additive(hdr(color, 2.5), 0.8));
      closing.material.userData.perInstance = true;
      closing.name = 'closing';
      closing.scale.setScalar(r);
      marker.add(edge, closing);
      marker.position.copy(toWorld(p.targetX, p.targetY)).setY(ROAD_H + 0.04);
      marker.userData.radius = r;
      scene.add(marker);
    }
    return { mesh, offset, fam, color, marker, last: p, seen: true };
  };

  // ── Frame ──
  let loaded = false, disposed = false, raf = 0;
  // Before play starts: compile every model's shaders and upload its textures, so the first tower
  // built or the first enemy of each kind doesn't stall a frame mid-fight
  const warmUp = async () => {
    const stash = new THREE.Group();
    for (const type of [TowerType.BASIC, TowerType.SNIPER, TowerType.SPLASH]) {
      stash.add(buildTower(type, { light: false }).root, buildGhost(type, TOWER_STATS[type].color).root);
    }
    for (const kind of Object.keys(ENEMY_TYPES)) stash.add(buildEnemy(kind).root);
    // Compiled while visible but out of sight: under the deck, and the range rings off screen
    stash.position.y = -60;
    scene.add(stash);
    range.show(-5000, -5000, 100, '#ffffff');
    hoverRange.show(-5000, -5000, 100, '#ffffff');
    await stage.renderer.compileAsync(scene, camera);
    range.hide();
    hoverRange.hide();
    stash.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) stage.renderer.initTexture(value);
      }
    });
    scene.remove(stash);
  };
  onLoadProgress(fraction => { if (!disposed) onProgress(fraction); });
  loadModels()
    .then(() => (disposed ? undefined : warmUp()))
    .catch(err => console.warn('model warm-up failed', err))
    .then(() => {
      onLoadProgress(null);
      if (!disposed) { loaded = true; onReady(); }
    });

  const timer = new THREE.Timer();
  let t = 0;
  // Adaptive quality: drop ambient occlusion, then resolution, if frames run long
  const quality = { ao: new URLSearchParams(location.search).get('quality') !== 'low', scale: 1, samples: 0, total: 0 };
  stage.setAmbientOcclusion(quality.ao);
  let pixelRatio = 0, frame = 0;
  const camBase = camera.position.clone();
  const v = new THREE.Vector3();

  // The view the camera is framed for, and the host size it was framed at
  let view: View = { k: 1, ox: 0, oy: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT };
  let viewKey = '';

  // Frame the camera so the 1000×800 frame lands where the view puts it. The camera looks at the
  // frame's centre; shifting the (orthographic) frustum moves that point on screen, and its size
  // sets the zoom: k screen px per frame px.
  const applyView = () => {
    const w = host.clientWidth || CANVAS_WIDTH, h = host.clientHeight || CANVAS_HEIGHT;
    const s = PX_PER_UNIT * view.k; // screen px per world unit
    const dx = (CANVAS_WIDTH / 2) * view.k + view.ox - w / 2;
    const dy = (CANVAS_HEIGHT / 2) * view.k + view.oy - h / 2;
    const cx = -dx / s, cy = dy / s;
    camera.left = cx - w / (2 * s); camera.right = cx + w / (2 * s);
    camera.top = cy + h / (2 * s); camera.bottom = cy - h / (2 * s);
    camera.updateProjectionMatrix();
  };

  // World point → frame coordinates (what the HUD draws in)
  const project = (p: THREE.Vector3) => {
    v.copy(p).project(camera);
    const w = host.clientWidth || CANVAS_WIDTH, h = host.clientHeight || CANVAS_HEIGHT;
    return { x: ((v.x + 1) / 2 * w - view.ox) / view.k, y: ((1 - v.y) / 2 * h - view.oy) / view.k };
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    timer.update();
    const dt = Math.min(0.05, timer.getDelta());
    t += dt;
    frame++;

    const inputs = read();

    // The host fills the window: render at its size times the device pixel ratio (scaled down by
    // the adaptive quality), and reframe the camera whenever the view or the host size changes
    const key = `${inputs.view.k}|${inputs.view.ox}|${inputs.view.oy}|${host.clientWidth}|${host.clientHeight}`;
    if (frame % 20 === 1 || key !== viewKey) {
      const pr = Math.min(2, Math.max(0.5, window.devicePixelRatio * quality.scale));
      if (Math.abs(pr - pixelRatio) > 0.02 || key !== viewKey) {
        pixelRatio = pr;
        viewKey = key;
        view = inputs.view;
        stage.resize(pr);
        applyView();
        hud.width = Math.round((host.clientWidth || CANVAS_WIDTH) * pr);
        hud.height = Math.round((host.clientHeight || CANVAS_HEIGHT) * pr);
      }
    }

    world.setIntegrity(inputs.coreIntegrity);
    world.update(dt);

    if (loaded) {
      syncTowers(inputs, dt);
      syncEnemies(inputs, dt);
      syncProjectiles(inputs);
      syncOverlays(inputs);
    }
    syncParticles(inputs.particles);
    fx.update(dt);

    // Damage shake
    camera.position.copy(camBase);
    if (inputs.shakeTime > 0) {
      const k = Math.min(1, inputs.shakeTime) * 0.7;
      camera.position.x += (Math.random() - 0.5) * k;
      camera.position.y += (Math.random() - 0.5) * k;
    }

    const start = performance.now();
    stage.composer.render(dt);
    drawHud(inputs);
    adaptQuality(performance.now() - start, dt);
  };

  const adaptQuality = (renderMs: number, dt: number) => {
    // Judge on the whole frame interval, which includes the GPU catching up
    quality.total += Math.max(renderMs, dt * 1000);
    if (++quality.samples < 120) return;
    const avg = quality.total / quality.samples;
    quality.samples = quality.total = 0;
    if (avg < 30) return;
    if (quality.ao) { quality.ao = false; stage.setAmbientOcclusion(false); }
    else if (quality.scale > 0.75) { quality.scale -= 0.15; pixelRatio = 0; }
  };

  const syncTowers = (inputs: SceneInputs, dt: number) => {
    const live = new Set<string>();
    for (const tw of inputs.towers) {
      live.add(tw.id);
      let view = towers.get(tw.id);
      if (view && view.type !== tw.type) { removeObject(view.model.root); view = undefined; }
      if (!view) { view = createTower(tw); towers.set(tw.id, view); }
      if (view.x !== tw.x || view.y !== tw.y) {
        view.model.root.position.copy(toWorld(tw.x, tw.y));
        view.x = tw.x; view.y = tw.y;
      }
      if (view.level !== tw.level) {
        view.level = tw.level;
        view.pips.forEach((pip, i) => { pip.visible = i < tw.level; });
      }
      const m = view.model;
      m.yaw.rotation.y = -(tw.currentAngle ?? -Math.PI / 2);
      if (m.family !== 'mortar') {
        const target = tw.targetId ? enemies.get(tw.targetId) : undefined;
        let pitch = 0;
        if (target) {
          m.muzzles[0].getWorldPosition(muzzleWorld);
          const tp = target.model.root.position;
          pitch = Math.atan2(tp.y + 0.5 - muzzleWorld.y, Math.hypot(tp.x - m.root.position.x, tp.z - m.root.position.z)) * 0.9;
        }
        m.pitch.rotation.z += (pitch - m.pitch.rotation.z) * Math.min(1, dt * 10);
      }
      view.kick = Math.max(0, view.kick - dt * 6);
      m.recoil.position.x = -view.kick * (m.family === 'mortar' ? 0.5 : 0.25);
      // The mortar's glow covers its bore and shell rack; a full pulse there bloomed into a red blob
      m.band.emissiveIntensity = 3 + view.kick * (m.family === 'mortar' ? 1.5 : 6);
      if (m.spin) m.spin.rotation.x += dt * (tw.targetId ? 32 : 1.5);
      const relocating = inputs.relocatingTowerId === tw.id;
      (view.pool.material as THREE.MeshBasicMaterial).opacity = relocating ? 0.3 : 1;
    }
    for (const [id, view] of towers) if (!live.has(id)) { removeObject(view.model.root); towers.delete(id); }
  };

  const syncEnemies = (inputs: SceneInputs, dt: number) => {
    enemies.forEach(v => { v.seen = false; });
    for (const e of inputs.enemies) {
      let view = enemies.get(e.id);
      if (!view) { view = createEnemy(e); enemies.set(e.id, view); view.model.root.position.copy(enemyPosition(e, view)); }
      view.seen = true;
      view.last = e;
      const pos = enemyPosition(e, view);
      const root = view.model.root;
      const dx = pos.x - root.position.x, dz = pos.z - root.position.z;
      if (dx * dx + dz * dz > 1e-6) {
        let d = Math.atan2(-dz, dx) - view.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        view.heading += d * Math.min(1, dt * 8);
      }
      root.position.copy(pos);
      root.rotation.y = view.heading;
      view.model.animate(t);
      // Hit flash, frost ring, burning glow
      if (e.lastHitTime > view.hitAt) { view.hitAt = e.lastHitTime; view.flash = 0.12; }
      view.flash = Math.max(0, view.flash - dt);
      view.halo.visible = view.flash > 0;
      view.halo.material.opacity = (view.flash / 0.12) * 0.3;
      view.frost.visible = e.slowDuration > 0;
      if (view.frost.visible) { view.frost.rotation.y += dt * 2; view.frost.position.y = (-view.model.hover * 0.5 + 0.2) / root.scale.x; }
      view.burn.visible = e.burnDuration > 0;
      if (view.burn.visible) view.burn.material.opacity = 0.15 + Math.random() * 0.15;
    }
    for (const [id, view] of enemies) {
      if (view.seen) continue;
      const e = view.last;
      const pos = view.model.root.position.clone();
      const color = ENEMY_TYPES[e.type]?.color ?? '#ffffff';
      const size = (ENEMY_TYPES[e.type]?.size ?? 14) / UNIT;
      if (e.distanceTraveled >= PATH_LENGTH - 5) {
        // Reached the core
        fx.flash(CORE.clone().setY(ROAD_H + 4), '#ff3030', 220, 0.5);
      } else {
        fx.explode(pos, color, 0.8 + size * 0.5, ROAD_H);
        fx.debris(pos, color, Math.round(5 + size * 4));
      }
      removeObject(view.model.root);
      enemies.delete(id);
    }
  };

  const syncProjectiles = (inputs: SceneInputs) => {
    projectiles.forEach(v => { v.seen = false; });
    for (const p of inputs.projectiles) {
      let view = projectiles.get(p.id);
      if (!view) { view = createProjectile(p, inputs); projectiles.set(p.id, view); }
      view.seen = true;
      view.last = p;
      // Shots start at the model's muzzle and blend onto the simulated flight path
      view.mesh.position.copy(toWorld(p.x, p.y, p.z)).addScaledVector(view.offset, Math.max(0, 1 - p.progress * 1.5));
      if (view.marker) {
        const closing = view.marker.getObjectByName('closing')!;
        closing.scale.setScalar(view.marker.userData.radius * Math.max(0.05, 1 - p.progress));
      }
    }
    for (const [id, view] of projectiles) {
      if (view.seen) continue;
      const pos = view.mesh.position.clone();
      if (view.fam === 'mortar') {
        const r = (view.last.splashRadius ?? 40) / UNIT;
        fx.explode(toWorld(view.last.targetX, view.last.targetY).setY(ROAD_H + 0.6), view.color, r, ROAD_H);
      } else {
        fx.spark(pos, view.color);
      }
      removeObject(view.mesh);
      if (view.marker) removeObject(view.marker);
      projectiles.delete(id);
    }
  };

  const syncParticles = (list: Particle[]) => {
    const n = Math.min(list.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const w = toWorld(p.x, p.y, (p.z ?? 10) + 8);
      pPos[i * 3] = w.x; pPos[i * 3 + 1] = w.y; pPos[i * 3 + 2] = w.z;
      tmpColor.set(p.color).multiplyScalar(2.5 * Math.max(0, p.life / p.maxLife));
      pCol[i * 3] = tmpColor.r; pCol[i * 3 + 1] = tmpColor.g; pCol[i * 3 + 2] = tmpColor.b;
    }
    pGeo.setDrawRange(0, n);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  };

  const syncOverlays = (inputs: SceneInputs) => {
    const selected = inputs.towers.find(tw => tw.id === inputs.selectedTowerId);
    const hovered = inputs.towers.find(tw => tw.id === inputs.hoveredTowerId && tw.id !== inputs.selectedTowerId);
    // Range of the selected tower, and a lighter ring for the one under the cursor
    if (selected) {
      const color = TOWER_STATS[selected.type].color;
      range.show(selected.x, selected.y, towerRange(selected.type, selected.level), color);
      selectRing.visible = true;
      selectRing.position.copy(toWorld(selected.x, selected.y)).setY(0.06);
      (selectRing.material as THREE.MeshBasicMaterial).color.copy(hdr(color, 1.6 + Math.sin(t * 5) * 0.4));
    } else {
      range.hide();
      selectRing.visible = false;
    }
    if (hovered) hoverRange.show(hovered.x, hovered.y, towerRange(hovered.type, hovered.level), TOWER_STATS[hovered.type].color);
    else hoverRange.hide();

    // Placement / relocation preview
    ghosts.forEach(g => { g.visible = false; });
    const relocating = inputs.towers.find(tw => tw.id === inputs.relocatingTowerId);
    const ghostType = inputs.placingType ?? relocating?.type ?? null;
    grid.visible = ghostType !== null;
    ghostPad.visible = false;
    if (ghostType && inputs.mouse) {
      const valid = checkPlacement(inputs.mouse, inputs.towers, relocating?.id) === 'OK';
      const at = toWorld(inputs.mouse.x, inputs.mouse.y);
      const ghost = ghostFor(ghostType, valid);
      ghost.visible = true;
      ghost.position.copy(at);
      const color = valid ? TOWER_STATS[ghostType].color : '#ff3b3b';
      range.show(inputs.mouse.x, inputs.mouse.y, towerRange(ghostType, relocating?.level ?? 1), color);
      ghostPad.visible = true;
      ghostPad.position.copy(at).setY(0.05);
      (ghostPad.material as THREE.MeshBasicMaterial).color.copy(hdr(color, 2));
    }
  };

  // ── HUD: health bars, floating texts, placement hint, damage tint ──
  const drawHud = (inputs: SceneInputs) => {
    const ctx = hudCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, hud.width, hud.height);
    if (!loaded) return;
    // Draw in frame coordinates: the view's scale and offset, times the canvas's pixel ratio
    const pr = pixelRatio || 1;
    ctx.setTransform(pr * view.k, 0, 0, pr * view.k, pr * view.ox, pr * view.oy);
    const now = Date.now();
    for (const e of inputs.enemies) {
      const view = enemies.get(e.id);
      if (!view) continue;
      const boss = e.type === 'COLOSSUS';
      const since = now - e.lastHitTime;
      if (!boss && since > 2500) continue;
      const alpha = boss ? 1 : Math.min(1, (2500 - since) / 500);
      const top = view.model.root.position.clone();
      top.y += (HULL_TOP[e.type] ?? 1) * (ENEMY_SCALE[e.type] ?? 1.25) + 0.6;
      const s = project(top);
      const w = boss ? 60 : 26, h = boss ? 5 : 3.5;
      const f = Math.max(0, e.health / e.maxHealth);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(5,8,14,0.85)';
      ctx.fillRect(s.x - w / 2 - 1, s.y - 1, w + 2, h + 2);
      ctx.fillStyle = f > 0.5 ? '#22d3a5' : f > 0.25 ? '#ffb800' : '#ff3b3b';
      ctx.fillRect(s.x - w / 2, s.y, w * f, h);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(3,6,10,0.9)';
    // Landmarks
    ctx.font = 'bold 9px "JetBrains Mono", ui-monospace, monospace';
    for (const [label, at, color] of [['ENTRY', ENTRY_LABEL, '#00e5ff'], ['CORE', CORE_LABEL, inputs.coreIntegrity > 0.3 ? '#00e5ff' : '#ff3b3b']] as const) {
      const s = project(at);
      ctx.strokeText(label, s.x, s.y);
      ctx.fillStyle = color;
      ctx.fillText(label, s.x, s.y);
    }
    ctx.font = 'bold 13px "JetBrains Mono", ui-monospace, monospace';
    for (const ft of inputs.floatingTexts) {
      // The game drifts texts up the screen by moving them in y; undo that and rise in height instead
      const age = 1 - ft.life;
      const p = toWorld(ft.x, ft.y + age * (50 / 1.5), 0).setY(6 + age * 4);
      const s = project(p);
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life * 1.4));
      ctx.strokeText(ft.text, s.x, s.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    const relocating = inputs.towers.find(tw => tw.id === inputs.relocatingTowerId);
    if ((inputs.placingType || relocating) && inputs.mouse) {
      const check = checkPlacement(inputs.mouse, inputs.towers, relocating?.id);
      if (check !== 'OK') {
        const s = project(toWorld(inputs.mouse.x, inputs.mouse.y, 0));
        ctx.font = 'bold 11px "JetBrains Mono", ui-monospace, monospace';
        ctx.strokeText(check === 'PATH' ? 'ROAD' : 'OCCUPIED', s.x, s.y + 26);
        ctx.fillStyle = '#ff5c5c';
        ctx.fillText(check === 'PATH' ? 'ROAD' : 'OCCUPIED', s.x, s.y + 26);
      }
    }
    if (inputs.shakeTime > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255, 77, 77, ${Math.min(1, inputs.shakeTime) * 0.25})`;
      ctx.fillRect(0, 0, hud.width, hud.height);
    }
  };

  raf = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      stage.dispose();
    },
  };
};
