// Balance simulator: plays the scripted waves headless on the game's own rules (src/game/sim.ts)
// with a bot that spends like a careful player, and reports the economy and survival per wave.
//
//   npm run balance                 # all strategies, 5 seeds each
//   npm run balance -- mixed 10     # one strategy, 10 seeds
//   npm run balance -- efficiency 1 # damage per credit, enemies every 1s (0.3 dense, 20 lone targets)
//
// The bot is a proxy, not an oracle: it builds towers where they cover the most road, buys
// whatever adds the most expected damage per credit, and keeps spending through each wave.
// Its results bound the difficulty from the "competent player" side.

import { TargetingMode, TowerInstance, TowerType } from '../../src/types';
import {
  BASE_TOWERS, ENEMY_TYPES, INITIAL_LIVES, INITIAL_MONEY, PATH, TOWER_STATS, WAVES,
  getEnemyHealth, getMaxLevel, getUpgradeCost, getWaveBonus, getWaveConfig, isBaseTower, SPECIALIZATIONS,
} from '../../src/constants';
import { checkPlacement } from '../../src/lib/placement';
import { SimState, getDistance, idleWave, startWaveRun, step, PATH_LENGTH, towerDamage, towerRange } from '../../src/game/sim';
import { getFireInterval } from '../../src/constants';

const DT = 1 / 60;
const BASE = BASE_TOWERS;
const SPECS = SPECIALIZATIONS;
const isBase = isBaseTower;
const upgradeCost = (t: TowerInstance) => getUpgradeCost(t.type, t.level);
const maxLevel = (t: TowerInstance) => getMaxLevel(t.type);

const mulberry32 = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── Where towers can stand, and how much road each spot covers ─────────────
const ROAD_SAMPLES = (() => {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i], b = PATH[i + 1];
    const n = Math.ceil(getDistance(a, b) / 5);
    for (let k = 0; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  return pts;
})();
const coverage = (x: number, y: number, range: number) => ROAD_SAMPLES.filter(p => (p.x - x) ** 2 + (p.y - y) ** 2 <= range * range).length * 5;
const SPOTS = (() => {
  const s: { x: number; y: number }[] = [];
  for (let x = 20; x <= 980; x += 15) for (let y = 20; y <= 780; y += 15) {
    if (checkPlacement({ x, y }, []) === 'OK') s.push({ x, y });
  }
  return s;
})();

// ── How much a tower is worth ───────────────────────────────────────────────
// What a careful player learns by playing: how much damage each tower (and level) actually lands
// on each enemy kind, at sparse and dense spacing, measured on the game's rules (see
// damageLanded below). A spot is worth that much in proportion to the road it covers.
const SPARSE = 1.0, DENSE = 0.3;
const rates = new Map<string, number>(); // `${type}|${level}|${kind}|${interval}` -> damage per px of road covered
const rate = (type: TowerType, level: number, kind: string, interval: number) => {
  const key = `${type}|${level}|${kind}|${interval}`;
  let r = rates.get(key);
  if (r === undefined) {
    const { dealt, coverage: cov } = damageLanded(type, level, kind, interval);
    r = dealt / Math.max(1, cov);
    rates.set(key, r);
  }
  return r;
};

// The coming waves, as weights per enemy kind (share of their total health) and spacing
interface Outlook { weights: Record<string, number>; interval: number }
const outlook = (fromWave: number): Outlook => {
  const weights: Record<string, number> = {};
  let total = 0;
  for (let w = fromWave; w < fromWave + 3; w++) {
    const cfg = getWaveConfig(w);
    for (const kind of cfg.enemyTypes) {
      const hp = getEnemyHealth(kind, w, cfg.healthMult) * cfg.counts[kind];
      weights[kind] = (weights[kind] ?? 0) + hp;
      total += hp;
    }
  }
  for (const k of Object.keys(weights)) weights[k] /= total;
  return { weights, interval: getWaveConfig(fromWave).interval <= 0.6 ? DENSE : SPARSE };
};

const towerValue = (type: TowerType, level: number, x: number, y: number, look: Outlook) => {
  const cov = coverage(x, y, towerRange({ type, level }));
  let v = 0;
  for (const [kind, w] of Object.entries(look.weights)) v += w * rate(type, level, kind, look.interval);
  return v * cov;
};

// ── Strategies ─────────────────────────────────────────────────────────────
// casual: builds only between waves, on good rather than the best spots — closer to a human
type Strategy = { name: string; allow: (t: TowerType) => boolean; specialize: boolean; casual?: boolean };
const STRATEGIES: Strategy[] = [
  { name: 'mixed', allow: () => true, specialize: true },
  { name: 'casual', allow: () => true, specialize: true, casual: true },
  { name: 'no-specialize', allow: () => true, specialize: false },
  { name: 'vulcan-only', allow: t => TOWER_STATS[t].type === TowerType.BASIC, specialize: true },
  { name: 'railgun-only', allow: t => TOWER_STATS[t].type === TowerType.SNIPER, specialize: true },
  { name: 'mortar-only', allow: t => TOWER_STATS[t].type === TowerType.SPLASH, specialize: true },
];

interface Option { cost: number; gain: number; apply: () => void }

const plan = (towers: TowerInstance[], money: number, prof: Outlook, strat: Strategy, rng: () => number): Option | null => {
  const opts: Option[] = [];
  // New towers at the best free spot for their range
  for (const type of BASE.filter(strat.allow)) {
    let best: { x: number; y: number; v: number } | null = null;
    const ranked: { x: number; y: number; v: number }[] = [];
    for (const s of SPOTS) {
      if (checkPlacement(s, towers) !== 'OK') continue;
      const v = towerValue(type, 1, s.x, s.y, prof);
      ranked.push({ ...s, v });
      if (!best || v > best.v) best = { ...s, v };
    }
    if (strat.casual && ranked.length) {
      // A decent spot, not the optimum: somewhere in the top third
      ranked.sort((a, b) => b.v - a.v);
      best = ranked[Math.floor(rng() * Math.max(1, ranked.length / 3))];
    }
    if (best) {
      const b = best;
      opts.push({
        cost: TOWER_STATS[type].cost, gain: b.v,
        apply: () => towers.push({
          id: `t${towers.length}-${Math.floor(rng() * 1e9)}`, type, baseType: type, x: b.x, y: b.y, level: 1,
          lastFired: getFireInterval(type, 1), targetId: null, currentAngle: -Math.PI / 2,
          targetingMode: TargetingMode.FIRST, invested: TOWER_STATS[type].cost,
        }),
      });
    }
  }
  for (const t of towers) {
    const now = towerValue(t.type, t.level, t.x, t.y, prof);
    if (t.level < maxLevel(t)) {
      const cost = upgradeCost(t);
      opts.push({ cost, gain: towerValue(t.type, t.level + 1, t.x, t.y, prof) - now, apply: () => { t.level++; t.invested += cost; } });
    } else if (strat.specialize && isBase(t.type)) {
      for (const spec of SPECS[t.type].filter(strat.allow)) {
        const cost = TOWER_STATS[spec].cost;
        opts.push({ cost, gain: towerValue(spec, t.level, t.x, t.y, prof) - now, apply: () => { t.type = spec; t.invested += cost; } });
      }
    }
  }
  const best = opts.filter(o => o.gain > 0).sort((a, b) => b.gain / b.cost - a.gain / a.cost)[0];
  return best && best.cost <= money ? best : null; // save up for the best option rather than buy a worse one
};

// ── One run ────────────────────────────────────────────────────────────────
interface WaveRow {
  wave: number; modifier: string; count: number; hpEach: number; startMoney: number; spent: number;
  earned: number; bonus: number; leaks: number; lives: number; towers: number; dps: number; seconds: number;
  danger: number; // how far along the road (%) the deepest enemy got; 100 = it reached the core
}

const run = (strat: Strategy, seed: number, lastWave = WAVES.length) => {
  const rng = mulberry32(seed);
  const s: SimState = { waveNumber: 0, enemies: [], towers: [], projectiles: [], wave: idleWave() };
  let money = INITIAL_MONEY, lives = INITIAL_LIVES;
  const rows: WaveRow[] = [];
  // Spend on what the given wave and the two after it need
  const spend = (wave: number) => {
    let spent = 0;
    const prof = outlook(wave);
    for (let guard = 0; guard < 50; guard++) {
      const o = plan(s.towers, money, prof, strat, rng);
      if (!o) break;
      o.apply();
      money -= o.cost;
      spent += o.cost;
    }
    return spent;
  };
  for (let w = 1; w <= lastWave && lives > 0; w++) {
    const startMoney = money;
    let spent = spend(w);
    s.waveNumber = w;
    s.wave = startWaveRun(w);
    let earned = 0, leaks = 0, t = 0, danger = 0;
    while (s.wave.active && lives > 0 && t < 900) {
      const r = step(s, DT, undefined, rng, t * 1000);
      for (const e of s.enemies) danger = Math.max(danger, e.distanceTraveled / PATH_LENGTH);
      if (r.livesLost) danger = 1;
      earned += r.moneyEarned; money += r.moneyEarned;
      leaks += r.livesLost; lives -= r.livesLost;
      t += DT;
      // A player keeps building during the wave
      if (!strat.casual && Math.floor(t / 2) !== Math.floor((t - DT) / 2)) spent += spend(w);
    }
    const bonus = lives > 0 ? getWaveBonus(w) : 0;
    money += bonus;
    const cfg = getWaveConfig(w);
    rows.push({
      wave: w, modifier: cfg.modifier, count: cfg.count,
      hpEach: Math.round(cfg.enemyTypes.reduce((a, ty) => a + getEnemyHealth(ty, w, cfg.healthMult) * cfg.counts[ty], 0) / cfg.count),
      startMoney, spent, earned, bonus, leaks, lives: Math.max(0, lives), towers: s.towers.length,
      dps: Math.round(s.towers.reduce((a, tw) => a + towerDamage(tw) / getFireInterval(tw.type, tw.level), 0)),
      seconds: Math.round(t), danger: Math.round(danger * 100),
    });
  }
  return { rows, towers: s.towers, money, lives };
};

// ── Tower efficiency: one tower alone against a stream of unkillable enemies ─────────────
// Damage actually landed (misses, road coverage, splash and resistances included) per credit.
const investedFor = (type: TowerType, level: number) => {
  const ups = (t: TowerType, upto: number) =>
    Array.from({ length: upto - 1 }, (_, i) => getUpgradeCost(t, i + 1)).reduce((a, b) => a + b, 0);
  if (isBase(type)) return TOWER_STATS[type].cost + ups(type, level);
  // Specializing keeps the level: base to L3, the specialization, then upgrades from L3
  const base = BASE.find(b => SPECS[b].includes(type))!;
  return TOWER_STATS[base].cost + ups(base, 3) + TOWER_STATS[type].cost + ups(type, level) - ups(type, 3);
};

const damageLanded = (type: TowerType, level: number, kind: string, interval: number, count = 30) => {
  const range = towerRange({ type, level });
  let spot = SPOTS[0], best = -1;
  for (const sp of SPOTS) { const c = coverage(sp.x, sp.y, range); if (c > best) { best = c; spot = sp; } }
  const rng = mulberry32(7);
  const s: SimState = {
    waveNumber: 1, enemies: [], projectiles: [],
    towers: [{ id: 'x', type, baseType: isBase(type) ? type : BASE.find(b => SPECS[b].includes(type))!, x: spot.x, y: spot.y, level, lastFired: 0, targetId: null,
      currentAngle: 0, targetingMode: TargetingMode.FIRST, invested: 0 }],
    wave: { config: { ...getWaveConfig(1), count, interval, enemyTypes: [kind], counts: { [kind]: count }, spawns: Array(count).fill(kind) },
      toSpawn: count, spawnTimer: 0, active: true },
  };
  // Enemies never die: count the damage each step, then top their health back up
  const HUGE = 1e12;
  let dealt = 0, t = 0;
  while (s.wave.active && t < 400) {
    step(s, DT, undefined, rng, t * 1000);
    for (const e of s.enemies) {
      const before = e.maxHealth === HUGE ? HUGE : e.maxHealth;
      dealt += before - e.health;
      e.health = e.maxHealth = HUGE;
    }
    t += DT;
  }
  return { dealt, coverage: best };
};

// A long interval means lone targets: 3 enemies, one at a time (how bosses arrive)
const efficiencyReport = (interval: number) => {
  const count = interval >= 10 ? 3 : 30;
  const kinds = Object.keys(ENEMY_TYPES);
  const cases: [TowerType, number][] = [
    ...BASE.flatMap(t => [[t, 1], [t, 3]] as [TowerType, number][]),
    ...Object.values(SPECS).flat().flatMap(t => [[t, 3], [t, 5]] as [TowerType, number][]),
  ];
  console.log(`Damage landed per credit invested, one tower vs ${count} unkillable enemies spawning every ${interval}s, best spot for its range`);
  console.log('tower               invested  ' + kinds.map(k => k.padStart(11)).join(''));
  for (const [type, level] of cases) {
    const cost = investedFor(type, level);
    const cells = kinds.map(k => (damageLanded(type, level, k, interval, count).dealt / cost).toFixed(1).padStart(11));
    console.log(`${(type + ' L' + level).padEnd(20)}${String(cost).padStart(8)}  ${cells.join('')}`);
  }
};

// ── Report ─────────────────────────────────────────────────────────────────
const [onlyStrategy, seedsArg] = process.argv.slice(2);
if (onlyStrategy === 'efficiency') { efficiencyReport(Number(seedsArg ?? 1)); process.exit(0); }
const SEEDS = Number(seedsArg ?? 5);
const strategies = STRATEGIES.filter(st => !onlyStrategy || st.name === onlyStrategy);

console.log(`Path ${Math.round(PATH_LENGTH)} px · start $${INITIAL_MONEY}, ${INITIAL_LIVES} lives · ${SEEDS} seeds per strategy\n`);
for (const strat of strategies) {
  const runs = Array.from({ length: SEEDS }, (_, i) => run(strat, 1000 + i));
  const reached = runs.map(r => r.rows.filter(row => row.lives > 0).length);
  console.log(`== ${strat.name}: waves survived ${reached.join(', ')} (of ${WAVES.length}) · final lives ${runs.map(r => Math.max(0, r.lives)).join(', ')}`);
  // Where each run bled: wave×leaks, so one bad wave doesn't hide in the averages
  runs.forEach((r, i) => {
    const bled = r.rows.filter(row => row.leaks > 0).map(row => `${row.wave}×${row.leaks}`);
    if (bled.length) console.log(`  seed ${1000 + i}: ${bled.join(' ')}`);
  });
  console.log('wave mod    count  hp/en   start  spent  kills  bonus  leaks  lives  towers   dps   secs  danger%');
  const first = runs[0].rows;
  for (let i = 0; i < WAVES.length; i++) {
    const rs = runs.map(r => r.rows[i]).filter(Boolean);
    if (!rs.length) break;
    const avg = (k: keyof WaveRow) => Math.round(rs.reduce((a, r) => a + (r[k] as number), 0) / rs.length);
    const r0 = first[i] ?? rs[0];
    console.log(
      `${String(r0.wave).padStart(4)} ${r0.modifier.padEnd(6)} ${String(r0.count).padStart(5)} ${String(r0.hpEach).padStart(6)} ` +
      `${String(avg('startMoney')).padStart(7)} ${String(avg('spent')).padStart(6)} ${String(avg('earned')).padStart(6)} ` +
      `${String(avg('bonus')).padStart(6)} ${String(avg('leaks')).padStart(6)} ${String(avg('lives')).padStart(6)} ` +
      `${String(avg('towers')).padStart(7)} ${String(avg('dps')).padStart(5)} ${String(avg('seconds')).padStart(6)} ${String(avg('danger')).padStart(8)}  (${rs.length}/${SEEDS} runs)`);
  }
  const last = runs[0];
  console.log('  final build (seed 1):', Object.entries(last.towers.reduce<Record<string, number[]>>((a, t) => ((a[t.type] ??= []).push(t.level), a), {}))
    .map(([type, lv]) => `${type}×${lv.length} (L${lv.join('/')})`).join(', '));
  console.log('');
}
