import { DamageType, EnemyInstance, Point, Projectile, TargetingMode, TowerInstance, TowerType } from '../types';
import { ENEMY_TYPES, PATH, TOWER_STATS, WaveConfig, getEnemyHealth, getFireInterval, getWaveConfig, isBoss } from '../constants';
import type { SoundName } from '../lib/audio';

// The game's rules, free of React and rendering: one fixed-size step of the battle at a time.
// The game (useGame) and the balance simulator (tools/balance) both run on this, so what the
// simulator measures is exactly what the player plays. Side effects the step wants to show or
// play are reported through SimEvents; a headless run simply ignores them.

export interface SimEvents {
  sound(name: SoundName, x?: number, y?: number): void;
  explosion(x: number, y: number, color: string, count: number): void;
  text(x: number, y: number, text: string, color: string): void;
}

export const NO_EVENTS: SimEvents = { sound() {}, explosion() {}, text() {} };

export interface WaveRun {
  config: WaveConfig | null;
  toSpawn: number;    // enemies still to spawn
  spawnTimer: number; // seconds banked towards the next spawn
  active: boolean;    // spawned or alive enemies remain
}

export interface SimState {
  waveNumber: number;
  enemies: EnemyInstance[];
  towers: TowerInstance[];
  projectiles: Projectile[];
  wave: WaveRun;
}

export interface StepResult {
  moneyEarned: number;
  livesLost: number;
  waveCleared: boolean; // the last enemy of the wave just died or leaked
}

// Mortar shell apex: proportional to throw distance, clamped
const MORTAR_ARC_PER_DIST = 0.45;
const MORTAR_ARC_MIN = 40;
const MORTAR_ARC_MAX = 90;

export const FIRE_SOUND: Record<TowerType, SoundName> = {
  [TowerType.BASIC]: 'vulcan', [TowerType.VULCAN_STING]: 'vulcan', [TowerType.VULCAN_TITAN]: 'vulcanHeavy',
  [TowerType.SNIPER]: 'railgun', [TowerType.RAILGUN_PIERCER]: 'railgun', [TowerType.RAILGUN_HYPER]: 'railgunHyper',
  [TowerType.SPLASH]: 'mortar', [TowerType.MORTAR_BOMBER]: 'mortar', [TowerType.MORTAR_CRYO]: 'cryoLaunch',
};

export const getDistance = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

export const PATH_LENGTH = PATH.slice(1).reduce((d, p, i) => d + getDistance(PATH[i], p), 0);

export const moveOnPath = (dist: number): Point => {
  let d = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const p1 = PATH[i];
    const p2 = PATH[i + 1];
    const segmentLen = getDistance(p1, p2);
    if (d + segmentLen >= dist) {
      const ratio = (dist - d) / segmentLen;
      return { x: p1.x + (p2.x - p1.x) * ratio, y: p1.y + (p2.y - p1.y) * ratio };
    }
    d += segmentLen;
  }
  return PATH[PATH.length - 1];
};

// Fraction of the flight covered, given the distance still left to the target
export const flightProgress = (p: Projectile, remaining: number) => {
  const total = Math.hypot(p.targetX - p.startX, p.targetY - p.startY);
  return total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 1;
};

export const towerRange = (tower: Pick<TowerInstance, 'type' | 'level'>) =>
  TOWER_STATS[tower.type].range * (1 + (tower.level - 1) * 0.1);

export const towerDamage = (tower: Pick<TowerInstance, 'type' | 'level'>) =>
  TOWER_STATS[tower.type].damage * (1 + (tower.level - 1) * 0.45);

export const selectTarget = (inRange: EnemyInstance[], mode: TargetingMode, tower: TowerInstance): EnemyInstance | undefined => {
  if (inRange.length === 0) return undefined;
  switch (mode) {
    case TargetingMode.FIRST:
      return inRange.reduce((a, b) => b.distanceTraveled > a.distanceTraveled ? b : a);
    case TargetingMode.LAST:
      return inRange.reduce((a, b) => b.distanceTraveled < a.distanceTraveled ? b : a);
    case TargetingMode.STRONGEST:
      return inRange.reduce((a, b) => b.health > a.health ? b : a);
    case TargetingMode.WEAKEST:
      return inRange.reduce((a, b) => b.health < a.health ? b : a);
    case TargetingMode.CLOSEST:
      return inRange.reduce((a, b) => getDistance(tower, b) < getDistance(tower, a) ? b : a);
  }
};

export const startWaveRun = (waveNumber: number): WaveRun => {
  const config = getWaveConfig(waveNumber);
  return { config, toSpawn: config.count, spawnTimer: 0, active: true };
};

export const idleWave = (): WaveRun => ({ config: null, toSpawn: 0, spawnTimer: 0, active: false });

const uid = (prefix: string, rng: () => number) => `${prefix}-${rng().toString(36).substr(2, 5)}-${Date.now()}`;

/**
 * Advances the battle by `dt` seconds. Mutates `s` (enemies, towers, projectiles, wave) and
 * returns what changed in the economy. `rng` only feeds ids; `now` stamps hits (ms).
 */
export const step = (s: SimState, dt: number, ev: SimEvents = NO_EVENTS, rng: () => number = Math.random, now = Date.now()): StepResult => {
  let enemies = [...s.enemies];
  let towers = [...s.towers];
  let projectiles = [...s.projectiles];
  let moneyEarned = 0;
  let livesLost = 0;
  const wave = s.wave;

  // 1. Spawning
  if (wave.toSpawn > 0 && wave.config) {
    wave.spawnTimer += dt;
    const cfg = wave.config;
    // Carry the leftover time over (and spawn more than one per step if needed)
    // so dense waves keep their scripted spawn rate instead of drifting slower
    while (wave.toSpawn > 0 && wave.spawnTimer >= cfg.interval) {
      wave.spawnTimer -= cfg.interval;
      const type = cfg.spawns[cfg.count - wave.toSpawn];
      wave.toSpawn--;
      const boss = isBoss(type); // modifiers shape the escort, not the boss
      const baseHealth = getEnemyHealth(type, s.waveNumber || 1, cfg.healthMult);
      enemies.push({
        id: uid('e', rng),
        type,
        health: baseHealth,
        maxHealth: baseHealth,
        x: PATH[0].x,
        y: PATH[0].y,
        pathIndex: 0,
        distanceTraveled: 0,
        lastHitTime: 0,
        hitAngle: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        burnDuration: 0,
        burnDamagePerSec: 0,
        speedMultiplier: boss ? 1 : cfg.speedMult,
        rewardMultiplier: boss ? 1 : cfg.rewardMult,
      });
    }
  }

  // 2. Movement, burning, leaks
  enemies = enemies.map(enemy => {
    const enemyType = ENEMY_TYPES[enemy.type];
    const slowDuration = Math.max(0, enemy.slowDuration - dt);
    const slowMult = slowDuration > 0 ? enemy.slowMultiplier : 1;
    let health = enemy.health;
    const burnDuration = Math.max(0, enemy.burnDuration - dt);
    if (burnDuration > 0) health -= enemy.burnDamagePerSec * (enemyType.resistances?.[DamageType.FIRE] ?? 1) * dt;
    const distanceTraveled = enemy.distanceTraveled + enemyType.speed * (enemy.speedMultiplier ?? 1) * slowMult * dt;
    const pos = moveOnPath(distanceTraveled);
    return { ...enemy, health, distanceTraveled, x: pos.x, y: pos.y, slowDuration, burnDuration };
  }).filter(enemy => {
    // An enemy that burned to death on the exit tile counts as a kill, not a leak
    if (enemy.distanceTraveled >= PATH_LENGTH && enemy.health > 0) {
      livesLost += ENEMY_TYPES[enemy.type].leakDamage ?? 1;
      return false;
    }
    return true;
  });
  if (livesLost > 0) {
    const core = PATH[PATH.length - 1];
    ev.text(core.x, core.y, `−${livesLost}`, '#ff4d4d');
    ev.sound('leak', core.x, core.y);
  }

  // 3. Projectiles: flight and hits
  const nextProjs: Projectile[] = [];
  projectiles.forEach(p => {
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const distToDest = Math.sqrt(dx * dx + dy * dy);
    const moveStep = p.speed * dt;
    let collisionEnemy: EnemyInstance | null = null;
    const targetsHit: EnemyInstance[] = [];

    // Lobbed shells fly over everything and only detonate where they land
    for (const enemy of (p.arcHeight ? [] : enemies)) {
      if (p.hitEnemyIds?.includes(enemy.id)) continue;
      if (getDistance(p, enemy) < 24) { // wider radius compensates for step discretization
        if (p.isPiercing) {
          targetsHit.push(enemy);
          p.hitEnemyIds = [...(p.hitEnemyIds || []), enemy.id];
        } else {
          collisionEnemy = enemy;
          break;
        }
      }
    }

    const hasHit = collisionEnemy || targetsHit.length > 0 || moveStep >= distToDest;
    if (hasHit) {
      const hit = collisionEnemy as EnemyInstance | null;
      const hitX = hit ? hit.x : (targetsHit.length > 0 ? targetsHit[0].x : p.targetX);
      const hitY = hit ? hit.y : (targetsHit.length > 0 ? targetsHit[0].y : p.targetY);
      if (hit || targetsHit.length > 0 || p.splashRadius) ev.explosion(hitX, hitY, TOWER_STATS[p.type].color, p.splashRadius ? 15 : 6);
      if (p.splashRadius) ev.sound(p.slowEffect ? 'freeze' : 'explosion', hitX, hitY);

      const processHit = (e: EnemyInstance, dmg: number) => {
        const resistance = ENEMY_TYPES[e.type].resistances?.[p.damageType] ?? 1;
        const next = { ...e, health: e.health - dmg * resistance, lastHitTime: now, hitAngle: Math.atan2(e.y - p.y, e.x - p.x) };
        if (p.slowEffect) {
          next.slowDuration = 2.0;
          next.slowMultiplier = p.slowEffect;
        }
        if (p.burnDamage && p.burnDuration) {
          next.burnDuration = p.burnDuration;
          next.burnDamagePerSec = p.burnDamage;
        }
        return next;
      };

      if (p.splashRadius) {
        enemies = enemies.map(e => (Math.hypot(e.x - hitX, e.y - hitY) <= p.splashRadius! ? processHit(e, p.damage) : e));
      } else if (hit) {
        enemies = enemies.map(e => (e.id === hit.id ? processHit(e, p.damage) : e));
      } else if (targetsHit.length > 0) {
        const ids = targetsHit.map(t => t.id);
        enemies = enemies.map(e => (ids.includes(e.id) ? processHit(e, p.damage) : e));
      }

      // Piercing rounds keep flying until they reach the end of their range
      if (p.isPiercing && moveStep < distToDest) {
        nextProjs.push({ ...p, x: p.x + dx * (moveStep / distToDest), y: p.y + dy * (moveStep / distToDest), progress: flightProgress(p, distToDest - moveStep) });
      }
    } else {
      const ratio = moveStep / distToDest;
      const progress = flightProgress(p, distToDest - moveStep);
      // Straight shots ease toward targetZ; lobbed shells follow a parabola over the line
      const z = p.arcHeight
        ? p.startZ + (p.targetZ - p.startZ) * progress + p.arcHeight * 4 * progress * (1 - progress)
        : p.z + (p.targetZ - p.z) * ratio;
      nextProjs.push({ ...p, x: p.x + dx * ratio, y: p.y + dy * ratio, z, progress });
    }
  });
  projectiles = nextProjs;

  // 4. Kills and rewards
  enemies = enemies.filter(e => {
    if (e.health > 0) return true;
    const type = ENEMY_TYPES[e.type];
    const reward = Math.round(type.reward * (e.rewardMultiplier ?? 1));
    moneyEarned += reward;
    ev.explosion(e.x, e.y, type.color, 12);
    ev.sound(e.type === 'COLOSSUS' ? 'deathBoss' : 'death', e.x, e.y);
    ev.text(e.x, e.y, `+$${reward}`, '#00f2ff');
    return false;
  });

  // 5. Towers: aim and fire
  towers = towers.map(tower => {
    const stats = TOWER_STATS[tower.type];
    const fireInterval = getFireInterval(tower.type, tower.level);
    let lastFired = tower.lastFired + dt;
    const range = towerRange(tower);
    const inRange = enemies.filter(e => getDistance(tower, e) <= range);
    const target = selectTarget(inRange, tower.targetingMode, tower);

    let currentAngle = tower.currentAngle || -Math.PI / 2;
    if (target) {
      let diff = Math.atan2(target.y - tower.y, target.x - tower.x) - currentAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      currentAngle += diff * dt * 14;
    }

    if (target && lastFired >= fireInterval) {
      const enemyType = ENEMY_TYPES[target.type];
      const dist = getDistance(tower, target);
      const actualSpeed = enemyType.speed * (target.speedMultiplier ?? 1) * (target.slowDuration > 0 ? target.slowMultiplier : 1);
      // Iterative intercept: 3 passes converge for any enemy speed
      let t = dist / stats.projectileSpeed;
      let predPos = moveOnPath(Math.min(target.distanceTraveled + actualSpeed * t, PATH_LENGTH));
      for (let iter = 0; iter < 2; iter++) {
        t = getDistance(tower, predPos) / stats.projectileSpeed;
        predPos = moveOnPath(Math.min(target.distanceTraveled + actualSpeed * t, PATH_LENGTH));
      }

      const startX = tower.x + Math.cos(currentAngle) * 12;
      const startY = tower.y + Math.sin(currentAngle) * 12;
      let destX = predPos.x;
      let destY = predPos.y;
      if (stats.isPiercing) {
        // Piercing rounds keep flying through the aim point out to max range
        const aimDist = Math.max(1, getDistance({ x: startX, y: startY }, predPos));
        destX = startX + ((predPos.x - startX) / aimDist) * range;
        destY = startY + ((predPos.y - startY) / aimDist) * range;
      }

      const startZ = 40 + tower.level * 2;
      const isLobbed = tower.baseType === TowerType.SPLASH;
      projectiles.push({
        id: uid('pr', rng),
        x: startX, y: startY, z: startZ,
        startX, startY, startZ,
        arcHeight: isLobbed
          ? Math.min(MORTAR_ARC_MAX, Math.max(MORTAR_ARC_MIN, Math.hypot(destX - startX, destY - startY) * MORTAR_ARC_PER_DIST))
          : undefined,
        targetX: destX, targetY: destY, targetZ: 15,
        damage: towerDamage(tower),
        damageType: stats.damageType,
        speed: stats.projectileSpeed,
        type: tower.type,
        splashRadius: stats.splashRadius,
        isPiercing: stats.isPiercing,
        slowEffect: stats.slowEffect,
        burnDamage: stats.burnDamage,
        burnDuration: stats.burnDuration,
        progress: 0,
        hitEnemyIds: [],
      });
      lastFired -= fireInterval; // keep the overflow so the rate of fire stays exact
      ev.sound(FIRE_SOUND[tower.type], tower.x, tower.y);
    }
    // Idle time doesn't bank shots: a tower without a target just stays ready for one
    lastFired = Math.min(lastFired, fireInterval);
    return { ...tower, lastFired, targetId: target?.id || null, currentAngle };
  });

  s.enemies = enemies;
  s.towers = towers;
  s.projectiles = projectiles;

  let waveCleared = false;
  if (enemies.length === 0 && wave.toSpawn === 0 && wave.active) {
    wave.active = false;
    waveCleared = true;
  }
  return { moneyEarned, livesLost, waveCleared };
};
