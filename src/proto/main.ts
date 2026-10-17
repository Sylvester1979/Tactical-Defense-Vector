import * as THREE from 'three';
import { PATH, TOWER_STATS } from '../constants';
import { TowerType } from '../types';
import { createStage } from './stage';
import { buildWorld } from './world';
import { buildTower, loadTowerModels, TowerModel } from './towers';
import { buildEnemy, EnemyModel } from './enemies';
import { createFx } from './fx';
import { toWorld, ROAD_H } from './coords';

// 3D rendering prototype: same road, same tower/enemy roster, rendered with WebGL (PBR materials,
// shadows, ambient occlusion, HDR bloom). Not playable — a looping skirmish to judge the look.

const host = document.getElementById('stage')!;
const stage = createStage(host);
const world = buildWorld(stage.scene);
const fx = createFx(stage.scene);

// ── Path helpers (in 3D units) ──
const pts = PATH.map(p => toWorld(p.x, p.y));
const segLen = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
const pathLen = segLen.reduce((a, b) => a + b, 0);
const along = (d: number) => {
  d = ((d % pathLen) + pathLen) % pathLen;
  for (let i = 0; i < segLen.length; i++) {
    if (d <= segLen[i]) {
      const p = pts[i].clone().lerp(pts[i + 1], d / segLen[i]);
      return { pos: p, dir: pts[i + 1].clone().sub(pts[i]).normalize() };
    }
    d -= segLen[i];
  }
  return { pos: pts[pts.length - 1].clone(), dir: new THREE.Vector3(1, 0, 0) };
};

// ── Towers (game coordinates, same spots a player might pick) ──
interface Tower { model: TowerModel; type: TowerType; range: number; cooldown: number; rate: number; kick: number }
const towers: Tower[] = [];
loadTowerModels().catch(err => console.error('model load failed, using procedural towers', err)).then(() => {
  towers.push(...([
  [TowerType.BASIC, 300, 200], [TowerType.SNIPER, 560, 200], [TowerType.SPLASH, 330, 400],
  [TowerType.BASIC, 580, 400], [TowerType.SNIPER, 780, 300], [TowerType.SPLASH, 160, 420],
] as const).map(([type, x, y]) => {
  const model = buildTower(type);
  model.root.position.copy(toWorld(x, y));
  model.yaw.rotation.y = Math.random() * Math.PI * 2;
  stage.scene.add(model.root);
  const s = TOWER_STATS[type];
  return { model, type, range: (s.range * 1.4) / 10, cooldown: Math.random(), rate: s.fireRate * 1.4, kick: 0 };
}));
});

// ── Enemies looping along the road ──
interface Enemy { model: EnemyModel; dist: number; speed: number; pos: THREE.Vector3 }
const roster: ['SCOUT' | 'GUARDIAN' | 'COLOSSUS', number, number][] = [
  ['COLOSSUS', 40, 2.2], ['GUARDIAN', 70, 3.4], ['GUARDIAN', 95, 3.4], ['SCOUT', 20, 8], ['SCOUT', 55, 8],
  ['SCOUT', 120, 8], ['SCOUT', 150, 8], ['GUARDIAN', 140, 3.4], ['SCOUT', 175, 8],
];
const enemies: Enemy[] = roster.map(([type, dist, speed]) => {
  const model = buildEnemy(type);
  stage.scene.add(model.root);
  return { model, dist, speed, pos: new THREE.Vector3() };
});

// ── Loop ──
const timer = new THREE.Timer();
const fpsEl = document.getElementById('fps')!;
let frames = 0, fpsT = 0, t = 0;
const muzzleWorld = new THREE.Vector3();

const tick = () => {
  timer.update();
  const dt = Math.min(0.05, timer.getDelta());
  t += dt;

  enemies.forEach(e => {
    e.dist += e.speed * dt;
    const { pos, dir } = along(e.dist);
    e.pos.copy(pos).setY(ROAD_H + e.model.hover + (e.model.hover > 1 ? Math.sin(t * 2.4 + e.dist) * 0.25 : 0));
    e.model.root.position.copy(e.pos);
    // Ease the heading so turns at corners are smooth
    const target = Math.atan2(-dir.z, dir.x);
    let d = target - e.model.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    e.model.root.rotation.y += d * Math.min(1, dt * 6);
    e.model.animate(t);
  });

  towers.forEach(tw => {
    const m = tw.model;
    const here = m.root.position;
    let best: Enemy | null = null, bestD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.pos.x - here.x, e.pos.z - here.z);
      if (d < tw.range && d < bestD) { best = e; bestD = d; }
    }
    if (m.spin) m.spin.rotation.x += dt * (tw.kick > 0 ? 40 : 2);
    tw.kick = Math.max(0, tw.kick - dt * 6);
    m.recoil.position.x = -tw.kick * (m.family === 'mortar' ? 0.5 : 0.25);
    m.band.emissiveIntensity = 3 + tw.kick * 6;
    tw.cooldown -= dt;
    if (!best) return;
    // Turn smoothly to face the target; guns pitch to it (mortar keeps its lob angle)
    const yawTarget = Math.atan2(-(best.pos.z - here.z), best.pos.x - here.x);
    let d = yawTarget - m.yaw.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.yaw.rotation.y += d * Math.min(1, dt * 8);
    if (m.family !== 'mortar') {
      const muzzleY = here.y + 5;
      m.pitch.rotation.z = Math.atan2(best.pos.y + 0.8 - muzzleY, bestD) * 0.9;
    }
    if (tw.cooldown <= 0 && Math.abs(d) < 0.25) {
      tw.cooldown = 1 / tw.rate;
      tw.kick = 1;
      m.muzzles[0].getWorldPosition(muzzleWorld);
      const aim = best.pos.clone().setY(best.pos.y + 0.8);
      if (m.family === 'vulcan') fx.tracer(muzzleWorld, aim, TOWER_STATS[tw.type].color);
      else if (m.family === 'railgun') fx.beam(muzzleWorld, aim, TOWER_STATS[tw.type].color);
      else fx.shell(muzzleWorld, best.pos.clone().setY(ROAD_H), TOWER_STATS[tw.type].color);
    }
  });

  world.update(dt);
  fx.update(dt);
  stage.composer.render(dt);

  frames++; fpsT += dt;
  if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
