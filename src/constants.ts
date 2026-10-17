import { TowerType, TowerStats, EnemyType, Point, DamageType, WaveModifier, TowerInstance } from './types';

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 800;
export const INITIAL_MONEY = 500;
export const INITIAL_LIVES = 20;
export const RELOCATION_FEE = 40;
export const SELL_REFUND_RATIO = 0.6;
export const GAME_SPEEDS = [1, 2, 3];

// Refund a fixed share of everything spent on the tower, so specializing never wipes its value
export const getSellValue = (tower: TowerInstance) => Math.floor(tower.invested * SELL_REFUND_RATIO);

export const PATH: Point[] = [
  { x: 0, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 300 },
  { x: 450, y: 300 },
  { x: 450, y: 100 },
  { x: 700, y: 100 },
  { x: 700, y: 500 },
  { x: 100, y: 500 },
  { x: 100, y: 600 },
];

export const TOWER_STATS: Record<TowerType, TowerStats> = {
  [TowerType.BASIC]: {
    type: TowerType.BASIC,
    damageType: DamageType.KINETIC,
    name: 'Rapid Vulcan',
    description: 'All-purpose rapid-fire cannon. High rate of fire shreds light armor. Upgrades into sustained-DPS or hyper-speed variants.',
    range: 150,
    damage: 7,
    fireRate: 2.2,
    cost: 125,
    color: '#3b82f6',
    projectileSpeed: 450,
  },
  [TowerType.SNIPER]: {
    type: TowerType.SNIPER,
    damageType: DamageType.ENERGY,
    name: 'Railgun',
    description: 'Long-range precision cannon. Low fire rate, extreme single-target damage. Bypasses energy resistances on most enemies.',
    range: 300,
    damage: 45,
    fireRate: 0.35,
    cost: 250,
    color: '#8b5cf6',
    projectileSpeed: 1000,
  },
  [TowerType.SPLASH]: {
    type: TowerType.SPLASH,
    damageType: DamageType.EXPLOSIVE,
    name: 'Nova Mortar',
    description: 'Area-denial artillery. Explosive shells damage all enemies within blast radius. Essential against clustered waves.',
    range: 120,
    damage: 18,
    fireRate: 0.5,
    cost: 200,
    color: '#ef4444',
    projectileSpeed: 250,
    splashRadius: 65,
  },
  [TowerType.VULCAN_TITAN]: {
    type: TowerType.VULCAN_TITAN,
    damageType: DamageType.KINETIC,
    name: 'Titan Vulcan',
    description: 'Heavy kinetic platform. Trades range for raw stopping power. Best sustained DPS against armored single targets.',
    range: 170,
    damage: 15,
    fireRate: 3.5,
    cost: 300,
    color: '#60a5fa',
    projectileSpeed: 500,
  },
  [TowerType.VULCAN_STING]: {
    type: TowerType.VULCAN_STING,
    damageType: DamageType.KINETIC,
    name: 'Sting Vulcan',
    description: 'Hyper-rate suppressor. Fires so rapidly it locks fast movers in a kinetic storm. High DPS via volume over power.',
    range: 200,
    damage: 12,
    fireRate: 5.0,
    cost: 300,
    color: '#93c5fd',
    projectileSpeed: 700,
  },
  [TowerType.RAILGUN_PIERCER]: {
    type: TowerType.RAILGUN_PIERCER,
    damageType: DamageType.ENERGY,
    name: 'Piercer Rail',
    description: 'Penetrating energy beam punches through multiple enemies in a line. One shot can hit an entire column.',
    range: 360,
    damage: 75,
    fireRate: 0.55,
    cost: 450,
    color: '#a855f7',
    projectileSpeed: 1000,
    isPiercing: true,
  },
  [TowerType.RAILGUN_HYPER]: {
    type: TowerType.RAILGUN_HYPER,
    damageType: DamageType.ENERGY,
    name: 'Hyper Rail',
    description: 'Extreme long-range annihilator. Fires rarely but one shot obliterates almost anything. Ideal for boss elimination.',
    range: 400,
    damage: 220,
    fireRate: 0.3,
    cost: 450,
    color: '#d8b4fe',
    projectileSpeed: 1200,
  },
  [TowerType.MORTAR_CRYO]: {
    type: TowerType.MORTAR_CRYO,
    damageType: DamageType.FROST,
    name: 'Cryo Mortar',
    description: 'Frost-shell mortar freezes clusters on impact. Slows all enemies in blast zone by 50% for 2 seconds. Pairs well with high-damage towers.',
    range: 150,
    damage: 22,
    fireRate: 0.7,
    cost: 350,
    color: '#0ea5e9',
    projectileSpeed: 300,
    splashRadius: 80,
    slowEffect: 0.5,
  },
  [TowerType.MORTAR_BOMBER]: {
    type: TowerType.MORTAR_BOMBER,
    damageType: DamageType.FIRE,
    name: 'Heavy Bomber',
    description: 'Incendiary payload ignites all enemies in a wide blast. Burning deals 12 dmg/sec for 4 seconds after impact — damage stacks with direct hit.',
    range: 150,
    damage: 50,
    fireRate: 0.35,
    cost: 350,
    color: '#f87171',
    projectileSpeed: 220,
    splashRadius: 100,
    burnDamage: 12,
    burnDuration: 4,
  },
};

export const ENEMY_TYPES: Record<string, EnemyType> = {
  SCOUT: {
    name: 'Recon Drone',
    health: 55,
    speed: 130,
    reward: 8,
    color: '#00f2ff',
    size: 14,
    resistances: { [DamageType.KINETIC]: 1.2 }, // Weak to kinetic
  },
  INTERCEPTOR: {
    name: 'Shock Weaver',
    health: 42,
    speed: 205,
    reward: 10,
    color: '#ffb800',
    size: 12,
    resistances: { [DamageType.ENERGY]: 0.5 }, // Strong against energy
  },
  GUARDIAN: {
    name: 'Bastion Mk.I',
    health: 480,
    speed: 60,
    reward: 35,
    color: '#94a3b8',
    size: 30,
    resistances: { [DamageType.EXPLOSIVE]: 0.6, [DamageType.KINETIC]: 0.8 }, // Tanky
    leakDamage: 2,
  },
  PHANTOM: {
    name: 'Ghost Stalker',
    health: 170,
    speed: 155,
    reward: 20,
    color: '#c084fc',
    size: 18,
    resistances: { [DamageType.FROST]: 1.5 }, // Takes 1.5x frost damage
  },
  COLOSSUS: {
    name: 'Dreadnought',
    health: 3500,
    speed: 40,
    reward: 250,
    color: '#ef4444',
    size: 50,
    resistances: { [DamageType.FIRE]: 1.3, [DamageType.ENERGY]: 1.2 }, // Weak to fire/energy
    leakDamage: 5,
  },
};

export const WAVES = [
  { count: 12, interval: 1.5, enemyTypes: ['SCOUT'] },
  { count: 18, interval: 1.0, enemyTypes: ['SCOUT', 'INTERCEPTOR'] },
  { count: 15, interval: 0.8, enemyTypes: ['INTERCEPTOR'], modifier: WaveModifier.RUSH },
  { count: 10, interval: 2.2, enemyTypes: ['SCOUT', 'GUARDIAN'] },
  { count: 20, interval: 1.2, enemyTypes: ['PHANTOM', 'SCOUT'] },
  { count: 30, interval: 0.7, enemyTypes: ['SCOUT', 'INTERCEPTOR', 'PHANTOM'], modifier: WaveModifier.SWARM },
  { count: 15, interval: 2.0, enemyTypes: ['GUARDIAN', 'PHANTOM'], modifier: WaveModifier.ELITE },
  { count: 25, interval: 0.6, enemyTypes: ['INTERCEPTOR', 'PHANTOM'] },
  { count: 1,  interval: 1.0, enemyTypes: ['COLOSSUS'], modifier: WaveModifier.ELITE },
  { count: 45, interval: 0.5, enemyTypes: ['SCOUT', 'INTERCEPTOR', 'PHANTOM', 'GUARDIAN'] },
  { count: 15, interval: 2.5, enemyTypes: ['GUARDIAN', 'INTERCEPTOR'] },
  { count: 35, interval: 0.3, enemyTypes: ['SCOUT'], modifier: WaveModifier.SWARM },
  { count: 12, interval: 1.5, enemyTypes: ['COLOSSUS', 'SCOUT'], modifier: WaveModifier.ELITE },
  { count: 50, interval: 0.8, enemyTypes: ['PHANTOM', 'INTERCEPTOR'], modifier: WaveModifier.RUSH },
  { count: 20, interval: 1.0, enemyTypes: ['GUARDIAN', 'PHANTOM', 'COLOSSUS'], modifier: WaveModifier.ELITE },
  { count: 100, interval: 0.1, enemyTypes: ['SCOUT', 'INTERCEPTOR'], modifier: WaveModifier.SWARM },
  { count: 30, interval: 1.2, enemyTypes: ['COLOSSUS', 'GUARDIAN'], modifier: WaveModifier.ELITE },
  { count: 50, interval: 0.5, enemyTypes: ['PHANTOM', 'GUARDIAN'] },
  { count: 2,  interval: 2.0, enemyTypes: ['COLOSSUS'], modifier: WaveModifier.ELITE },
  { count: 150, interval: 0.05, enemyTypes: ['INTERCEPTOR', 'PHANTOM'], modifier: WaveModifier.RUSH },
];

export interface WaveConfig {
  count: number;          // Enemies actually spawned (modifier already applied)
  interval: number;
  enemyTypes: string[];
  modifier: WaveModifier;
  healthMult: number;
  speedMult: number;
  rewardMult: number;
}

// Single source of truth for a wave's composition — used by the engine and the preview UI
export const getWaveConfig = (waveNumber: number): WaveConfig => {
  let wave = WAVES[waveNumber - 1];
  if (!wave) {
    // Procedural scaling past the scripted waves
    const baseWave = WAVES[(waveNumber - 1) % WAVES.length];
    const difficultyScale = Math.floor(waveNumber / WAVES.length);
    wave = {
      count: Math.floor(baseWave.count * (1 + difficultyScale * 0.8)),
      interval: baseWave.interval * Math.pow(0.85, difficultyScale),
      enemyTypes: baseWave.enemyTypes,
      modifier: baseWave.modifier,
    };
  }
  const modifier = wave.modifier ?? WaveModifier.NONE;
  let count = wave.count;
  if (modifier === WaveModifier.SWARM) count = wave.count * 2;
  if (modifier === WaveModifier.ELITE) count = Math.ceil(wave.count * 0.5);
  return {
    count,
    interval: wave.interval,
    enemyTypes: wave.enemyTypes,
    modifier,
    healthMult: modifier === WaveModifier.SWARM ? 0.5 : modifier === WaveModifier.ELITE ? 2.0 : 1.0,
    speedMult: modifier === WaveModifier.RUSH ? 1.6 : 1.0,
    rewardMult: modifier === WaveModifier.ELITE ? 1.5 : 1.0,
  };
};

// Slightly softer health scaling for early game
export const getEnemyHealth = (type: string, waveNumber: number, healthMult: number) =>
  ENEMY_TYPES[type].health * (1 + Math.max(0, waveNumber - 2) * 0.10) * healthMult;

export const getWaveBonus = (waveNumber: number) => 120 + (waveNumber - 1) * 25;

// Seconds between shots for a tower type at a given level (+20% fire rate per level)
export const getFireInterval = (type: TowerType, level: number) =>
  1 / (TOWER_STATS[type].fireRate * (1 + (level - 1) * 0.2));
