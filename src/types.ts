export type Point = { x: number; y: number };

export enum TargetingMode {
  FIRST    = 'FIRST',     // closest to path end
  LAST     = 'LAST',      // farthest from path end
  STRONGEST = 'STRONGEST', // highest current HP
  WEAKEST  = 'WEAKEST',   // lowest current HP
  CLOSEST  = 'CLOSEST',   // nearest to tower
}

export enum WaveModifier {
  NONE  = 'NONE',
  RUSH  = 'RUSH',    // 2x enemy speed
  SWARM = 'SWARM',   // 2x count, 0.5x HP
  ELITE = 'ELITE',   // 0.5x count, 2x HP, 1.5x reward
}

export enum TowerType {
  BASIC = 'BASIC',
  SNIPER = 'SNIPER',
  SPLASH = 'SPLASH',
  // Specializations
  VULCAN_TITAN = 'VULCAN_TITAN',
  VULCAN_STING = 'VULCAN_STING',
  RAILGUN_PIERCER = 'RAILGUN_PIERCER',
  RAILGUN_HYPER = 'RAILGUN_HYPER',
  MORTAR_CRYO = 'MORTAR_CRYO',
  MORTAR_BOMBER = 'MORTAR_BOMBER',
}

export enum DamageType {
  KINETIC = 'KINETIC',   // Basic bullets
  ENERGY = 'ENERGY',     // Railguns, beams
  EXPLOSIVE = 'EXPLOSIVE', // Mortars
  FROST = 'FROST',       // Slowing effects
  FIRE = 'FIRE',         // Damage over time
}

export interface TowerStats {
  type: TowerType;
  damageType: DamageType;
  range: number;
  damage: number;
  fireRate: number; // Attacks per second
  cost: number;
  color: string;
  name: string;
  projectileSpeed: number;
  splashRadius?: number;
  isPiercing?: boolean;
  slowEffect?: number; // 0 to 1, percentage reduction
  burnDamage?: number; // Damage per second
  burnDuration?: number;
}

export interface TowerInstance {
  id: string;
  type: TowerType;
  x: number;
  y: number;
  level: number;
  lastFired: number;
  targetId: string | null;
  currentAngle?: number;
  baseType: TowerType;
  targetingMode: TargetingMode;
}

export interface EnemyType {
  health: number;
  speed: number;
  reward: number;
  color: string;
  size: number;
  name: string;
  resistances?: Partial<Record<DamageType, number>>; // 0 to 1, multiplier (0.5 = 50% damage)
}

export interface EnemyInstance {
  id: string;
  type: string;
  health: number;
  maxHealth: number;
  x: number;
  y: number;
  pathIndex: number;
  distanceTraveled: number;
  lastHitTime: number; // For flash animation
  hitAngle: number;    // For recoil direction
  slowDuration: number; // For slow effect
  slowMultiplier: number;
  burnDuration: number; // Periodic damage
  burnDamagePerSec: number;
  speedMultiplier?: number;   // Wave-level speed modifier
  rewardMultiplier?: number;  // Wave-level reward modifier
}

export interface Projectile {
  id: string;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  damage: number;
  damageType: DamageType;
  speed: number;
  type: TowerType;
  splashRadius?: number;
  isPiercing?: boolean;
  slowEffect?: number;
  burnDamage?: number;
  burnDuration?: number;
  progress: number; // 0 to 1
  hitEnemyIds: string[]; // For piercing
}

export interface Wave {
  count: number;
  interval: number;
  enemyTypes: string[];
  modifier?: WaveModifier;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}

export interface GameState {
  money: number;
  lives: number;
  waveNumber: number;
  isPaused: boolean;
  isGameOver: boolean;
  isWaveReady: boolean; // Waiting for player approval
  selectedTowerId: string | null;
  relocatingTowerId: string | null;
  shakeTime: number;
  currentWaveModifier: WaveModifier;
}
