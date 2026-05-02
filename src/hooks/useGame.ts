import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TowerInstance,
  EnemyInstance,
  Projectile,
  GameState,
  TowerType,
  TargetingMode,
  WaveModifier,
  Point,
  Particle,
  FloatingText
} from '../types';
import { 
  CANVAS_WIDTH, 
  CANVAS_HEIGHT, 
  INITIAL_MONEY, 
  INITIAL_LIVES, 
  PATH, 
  TOWER_STATS, 
  ENEMY_TYPES, 
  WAVES 
} from '../constants';

export function useGame() {
  const [gameState, setGameState] = useState<GameState>({
    money: INITIAL_MONEY,
    lives: INITIAL_LIVES,
    waveNumber: 0,
    isPaused: true,
    isGameOver: false,
    isWaveReady: true,
    selectedTowerId: null,
    relocatingTowerId: null,
    shakeTime: 0,
    currentWaveModifier: WaveModifier.NONE,
  });

  const [towers, setTowers] = useState<TowerInstance[]>([]);
  const [enemies, setEnemies] = useState<EnemyInstance[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [waveActive, setWaveActive] = useState(false);

  // --- REFS FOR ENGINE STABILITY (Prevents stuttering from constant dependency shifts) ---
  const enemiesRef = useRef<EnemyInstance[]>([]);
  const towersRef = useRef<TowerInstance[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const gameStateRef = useRef<GameState>(gameState);

  // Sync refs with state for the engine loop
  useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
  useEffect(() => { towersRef.current = towers; }, [towers]);
  useEffect(() => { projectilesRef.current = projectiles; }, [projectiles]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const requestRef = useRef<number>(null);
  const lastTimeRef = useRef<number>(0);
  const spawnTimerRef = useRef<number>(0);
  const enemiesToSpawnRef = useRef<number>(0);
  const currentWaveRef = useRef<any>(null);

  // Helper: Create particles
  const createExplosion = useCallback((x: number, y: number, color: string, count: number = 10) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 100 + 50;
      newParticles.push({
        id: `p-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
        x,
        y,
        z: 10,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
        size: Math.random() * 3 + 1,
      });
    }
    setParticles(prev => [...prev.slice(-60), ...newParticles]);
  }, []);

  const createFloatingText = useCallback((x: number, y: number, text: string, color: string) => {
    const newText: FloatingText = {
      id: `t-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
      x,
      y,
      text,
      life: 1,
      color,
    };
    setFloatingTexts(prev => [...prev.slice(-20), newText]);
  }, []);

  // Helper: Distance between two points
  const getDistance = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

  // Helper: Check if point is near path (Buffer of 40px)
  const isNearPath = useCallback((x: number, y: number, buffer: number = 40) => {
    for (let i = 0; i < PATH.length - 1; i++) {
      const p1 = PATH[i];
      const p2 = PATH[i + 1];
      
      const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
      if (l2 === 0) continue;
      
      let t = ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      
      const dist = getDistance({ x, y }, {
        x: p1.x + t * (p2.x - p1.x),
        y: p1.y + t * (p2.y - p1.y)
      });
      
      if (dist < buffer) return true;
    }
    return false;
  }, []);

  // Helper: Move along path
  const moveOnPath = (dist: number): Point => {
    let d = 0;
    for (let i = 0; i < PATH.length - 1; i++) {
      const p1 = PATH[i];
      const p2 = PATH[i + 1];
      const segmentLen = getDistance(p1, p2);
      if (d + segmentLen >= dist) {
        const ratio = (dist - d) / segmentLen;
        return {
          x: p1.x + (p2.x - p1.x) * ratio,
          y: p1.y + (p2.y - p1.y) * ratio,
        };
      }
      d += segmentLen;
    }
    return PATH[PATH.length - 1];
  };

  const getPathLength = () => {
    let d = 0;
    for (let i = 0; i < PATH.length - 1; i++) {
      d += getDistance(PATH[i], PATH[i + 1]);
    }
    return d;
  };

  const pathLength = getPathLength();

  const startWave = useCallback(() => {
    if (waveActive || gameState.isGameOver) return;
    
    // Increment wave number and reset ready state
    const waveNumber = (gameState.waveNumber || 0) + 1;
    let wave;
    
    if (waveNumber <= WAVES.length) {
      wave = WAVES[waveNumber - 1];
    } else {
      // Procedural scaling wave
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
    let effectiveCount = wave.count;
    if (modifier === WaveModifier.SWARM) effectiveCount = wave.count * 2;
    if (modifier === WaveModifier.ELITE) effectiveCount = Math.ceil(wave.count * 0.5);

    enemiesToSpawnRef.current = effectiveCount;
    currentWaveRef.current = { ...wave, modifier };
    spawnTimerRef.current = 0;
    setWaveActive(true);
    setGameState(prev => ({ ...prev, isPaused: false, isWaveReady: false, waveNumber, currentWaveModifier: modifier }));
  }, [waveActive, gameState.waveNumber, gameState.isGameOver]);

  const placeTower = useCallback((type: TowerType, x: number, y: number) => {
    const stats = TOWER_STATS[type];
    if (gameState.money < stats.cost) return;

    // RULE: Cannot place on path or too close to it
    if (isNearPath(x, y)) {
      createFloatingText(x, y, "INVALID TERRAIN", "#ff4d4d");
      return;
    }

    // RULE: Cannot place on top of another tower
    const onTower = towers.some(t => getDistance(t, { x, y }) < 35);
    if (onTower) {
      createFloatingText(x, y, "SPACE OCCUPIED", "#ff4d4d");
      return;
    }

    const newTower: TowerInstance = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x,
      y,
      level: 1,
      lastFired: 0,
      targetId: null,
      currentAngle: -Math.PI / 2,
      baseType: type,
      targetingMode: TargetingMode.FIRST,
    };

    setTowers(prev => [...prev, newTower]);
    setGameState(prev => ({ ...prev, money: prev.money - stats.cost }));
  }, [gameState.money, isNearPath, towers, createFloatingText]);

  const upgradeTower = useCallback((id: string) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;
    
    // Check if tower is at cap (level 3 for base towers)
    if (tower.level >= 3 && (tower.type === TowerType.BASIC || tower.type === TowerType.SNIPER || tower.type === TowerType.SPLASH)) {
      return; // UI should handle specialization selection
    }

    const stats = TOWER_STATS[tower.type];
    const upgradeCost = Math.floor(stats.cost * 0.7 * tower.level);
    
    if (gameState.money >= upgradeCost) {
      setTowers(prev => prev.map(t => t.id === id ? { ...t, level: t.level + 1 } : t));
      setGameState(prev => ({ ...prev, money: prev.money - upgradeCost }));
      createFloatingText(tower.x, tower.y - 20, "UPGRADED!", "#00f2ff");
    }
  }, [towers, gameState.money, createFloatingText]);

  const specializeTower = useCallback((id: string, newType: TowerType) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;

    const stats = TOWER_STATS[newType];
    const cost = stats.cost; // Branching cost

    if (gameState.money >= cost) {
      setTowers(prev => prev.map(t => t.id === id ? { ...t, type: newType, level: 1 } : t));
      setGameState(prev => ({ ...prev, money: prev.money - cost }));
      createExplosion(tower.x, tower.y, stats.color, 20);
      createFloatingText(tower.x, tower.y - 20, stats.name.toUpperCase(), stats.color);
    }
  }, [towers, gameState.money, createFloatingText, createExplosion]);

  const sellTower = useCallback((id: string) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;
    
    const stats = TOWER_STATS[tower.type];
    const sellValue = Math.floor(stats.cost * 0.5 + (tower.level - 1) * stats.cost * 0.3);
    
    setTowers(prev => prev.filter(t => t.id !== id));
    setGameState(prev => ({ ...prev, money: prev.money + sellValue, selectedTowerId: null, relocatingTowerId: null }));
    createFloatingText(tower.x, tower.y, `+$${sellValue}`, "#ffb800");
  }, [towers, createFloatingText]);

  const startRelocation = useCallback((id: string) => {
    if (gameState.money < 40) { // Using standard relocation fee
      createFloatingText(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, "NOT ENOUGH ENERGY", "#ff4d4d");
      return;
    }
    setGameState(prev => ({ ...prev, relocatingTowerId: id }));
  }, [gameState.money, createFloatingText]);

  const cancelRelocation = useCallback(() => {
    setGameState(prev => ({ ...prev, relocatingTowerId: null }));
  }, []);

  const confirmRelocation = useCallback((id: string, x: number, y: number) => {
    const tower = towers.find(t => t.id === id);
    if (!tower) return;

    if (isNearPath(x, y)) {
      createFloatingText(x, y, "INVALID TERRAIN", "#ff4d4d");
      return;
    }

    const onTower = towers.some(t => t.id !== id && getDistance(t, { x, y }) < 35);
    if (onTower) {
      createFloatingText(x, y, "SPACE OCCUPIED", "#ff4d4d");
      return;
    }

    setTowers(prev => prev.map(t => t.id === id ? { ...t, x, y } : t));
    setGameState(prev => ({ 
      ...prev, 
      money: prev.money - 40, // Match CONST
      relocatingTowerId: null,
      selectedTowerId: id 
    }));
    createExplosion(x, y, "#00f2ff", 15);
    createFloatingText(x, y - 20, "REDEPLOYED", "#00f2ff");
  }, [towers, isNearPath, createFloatingText, createExplosion]);

  const selectTarget = (inRange: EnemyInstance[], mode: TargetingMode, tower: TowerInstance): EnemyInstance | undefined => {
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

  const update = useCallback((time: number) => {
    if (lastTimeRef.current !== undefined) {
      const dt = Math.min(0.05, (time - lastTimeRef.current) / 1000); // Bulletproof dt cap
      const currentGameState = gameStateRef.current;
      
      if (!currentGameState.isPaused && !currentGameState.isGameOver) {
        let currentEnemies = [...enemiesRef.current];
        let currentTowers = [...towersRef.current];
        let currentProjectiles = [...projectilesRef.current];
        let moneyEarned = 0;
        let livesLost = 0;
        let newShake = currentGameState.shakeTime;

        // 1. Spawning
        if (enemiesToSpawnRef.current > 0 && currentWaveRef.current) {
          spawnTimerRef.current += dt;
          const wave = currentWaveRef.current;
          if (spawnTimerRef.current >= wave.interval) {
            spawnTimerRef.current = 0;
            enemiesToSpawnRef.current--;
            
            const randomType = wave.enemyTypes[Math.floor(Math.random() * wave.enemyTypes.length)];
            const enemyType = ENEMY_TYPES[randomType];
            const waveNumber = currentGameState.waveNumber || 1;
            // Slightly softer health scaling for early game
            const scalingFactor = Math.max(0, waveNumber - 2) * 0.10;
            const mod = (currentWaveRef.current?.modifier ?? WaveModifier.NONE) as WaveModifier;
            const healthMult  = mod === WaveModifier.SWARM ? 0.5 : mod === WaveModifier.ELITE ? 2.0 : 1.0;
            const speedMult   = mod === WaveModifier.RUSH  ? 1.6 : 1.0;
            const rewardMult  = mod === WaveModifier.ELITE ? 1.5 : 1.0;
            const baseHealth  = enemyType.health * (1 + scalingFactor) * healthMult;
            currentEnemies.push({
              id: `e-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
              type: randomType,
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
              speedMultiplier: speedMult,
              rewardMultiplier: rewardMult,
            });
          }
        }

        // 2. Movement & Path Logic
        currentEnemies = currentEnemies.map(enemy => {
          const enemyType = ENEMY_TYPES[enemy.type];
          
          let slowMult = 1;
          let newSlowDuration = Math.max(0, enemy.slowDuration - dt);
          if (newSlowDuration > 0) {
            slowMult = enemy.slowMultiplier;
          }

          // Damage Over Time (Burn)
          let currentHealth = enemy.health;
          let newBurnDuration = Math.max(0, enemy.burnDuration - dt);
          if (newBurnDuration > 0) {
            currentHealth -= enemy.burnDamagePerSec * dt;
          }

          const waveSpeedMult = enemy.speedMultiplier ?? 1;
          const newDist = enemy.distanceTraveled + (enemyType.speed * waveSpeedMult * slowMult) * dt;
          const pos = moveOnPath(newDist);
          return { 
            ...enemy, 
            health: currentHealth,
            distanceTraveled: newDist, 
            x: pos.x, 
            y: pos.y, 
            slowDuration: newSlowDuration,
            burnDuration: newBurnDuration
          };
        }).filter(enemy => {
           if (enemy.distanceTraveled >= pathLength) {
             livesLost++;
             newShake = 0.3;
             return false;
           }
           return true;
        });

        // 3. Projectiles (Collision & Movement)
        const nextProjs: Projectile[] = [];
        currentProjectiles.forEach(p => {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const distToDest = Math.sqrt(dx * dx + dy * dy);
          const moveStep = p.speed * dt;
          
          let collisionEnemy: EnemyInstance | null = null;
          let targetsHit: EnemyInstance[] = [];

          for (const enemy of currentEnemies) {
            if (p.hitEnemyIds?.includes(enemy.id)) continue;
            
            const d = getDistance(p, enemy);
            if (d < 24) { // Wider radius compensates for frame-rate discretization
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
            const hitX = collisionEnemy ? collisionEnemy.x : (targetsHit.length > 0 ? targetsHit[0].x : p.targetX);
            const hitY = collisionEnemy ? collisionEnemy.y : (targetsHit.length > 0 ? targetsHit[0].y : p.targetY);
            
            if (collisionEnemy || targetsHit.length > 0) {
              createExplosion(hitX, hitY, TOWER_STATS[p.type].color, p.splashRadius ? 15 : 6);
            }
            
            const processHit = (e: EnemyInstance, dmg: number) => {
              const enemyType = ENEMY_TYPES[e.type];
              const resistance = enemyType.resistances?.[p.damageType] ?? 1;
              const finalDmg = dmg * resistance;

              const angle = Math.atan2(e.y - p.y, e.x - p.x);
              let nextE = { ...e, health: e.health - finalDmg, lastHitTime: Date.now(), hitAngle: angle };
              
              if (p.slowEffect) {
                nextE.slowDuration = 2.0; // 2 seconds of slow
                nextE.slowMultiplier = p.slowEffect;
              }

              if (p.burnDamage && p.burnDuration) {
                nextE.burnDuration = p.burnDuration;
                nextE.burnDamagePerSec = p.burnDamage;
              }

              return nextE;
            };

            if (p.splashRadius) {
              currentEnemies = currentEnemies.map(e => {
                const d = Math.sqrt((e.x - hitX) ** 2 + (e.y - hitY) ** 2);
                if (d <= p.splashRadius!) {
                  return processHit(e, p.damage);
                }
                return e;
              });
            } else if (collisionEnemy) {
              currentEnemies = currentEnemies.map(e => (e.id === collisionEnemy!.id ? processHit(e, p.damage) : e));
            } else if (targetsHit.length > 0) {
              const hitIds = targetsHit.map(t => t.id);
              currentEnemies = currentEnemies.map(e => (hitIds.includes(e.id) ? processHit(e, p.damage) : e));
            }

            if (!p.isPiercing || moveStep >= distToDest) {
               // Remove projectile
            } else {
              nextProjs.push({
                ...p,
                x: p.x + dx * (moveStep / distToDest),
                y: p.y + dy * (moveStep / distToDest),
                progress: p.progress + (moveStep / distToDest)
              });
            }
          } else {
            const ratio = moveStep / distToDest;
            nextProjs.push({
              ...p,
              x: p.x + (p.targetX - p.x) * ratio,
              y: p.y + (p.targetY - p.y) * ratio,
              z: p.z + (p.targetZ - p.z) * ratio,
              progress: p.progress + ratio
            });
          }
        });
        currentProjectiles = nextProjs;

        // 4. Cleanup & Rewards
        currentEnemies = currentEnemies.filter(e => {
          if (e.health <= 0) {
            const type = ENEMY_TYPES[e.type];
            const reward = Math.round(type.reward * (e.rewardMultiplier ?? 1));
            moneyEarned += reward;
            createExplosion(e.x, e.y, type.color, 12);
            createFloatingText(e.x, e.y, `+$${reward}`, "#00f2ff");
            return false;
          }
          return true;
        });

        // 5. Tower Logic (Targeting & Firing)
        currentTowers = currentTowers.map(tower => {
          const stats = TOWER_STATS[tower.type];
          const fireInterval = 1 / (stats.fireRate * (1 + (tower.level - 1) * 0.2));
          let nextLastFired = tower.lastFired + dt;
          
          // Efficient Targeted Selection
          const range = stats.range * (1 + (tower.level - 1) * 0.1);
          const inRange = currentEnemies.filter(e => getDistance(tower, e) <= range);
          const target = selectTarget(inRange, tower.targetingMode, tower);

          let currentAngle = tower.currentAngle || -Math.PI / 2;
          if (target) {
            const targetAngle = Math.atan2(target.y - tower.y, target.x - tower.x);
            let angleDiff = targetAngle - currentAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            currentAngle += angleDiff * dt * 14;
          }

          if (target && nextLastFired >= fireInterval) {
            const enemyType = ENEMY_TYPES[target.type];
            const dist = getDistance(tower, target);
            const targetSpeedMult = target.speedMultiplier ?? 1;
            const targetSlowMult = target.slowDuration > 0 ? target.slowMultiplier : 1;
            const actualSpeed = enemyType.speed * targetSpeedMult * targetSlowMult;
            // Iterative intercept: 3 passes converge for any enemy speed
            let t = dist / stats.projectileSpeed;
            let predPos = moveOnPath(Math.min(target.distanceTraveled + actualSpeed * t, pathLength));
            for (let iter = 0; iter < 2; iter++) {
              t = getDistance(tower, predPos) / stats.projectileSpeed;
              predPos = moveOnPath(Math.min(target.distanceTraveled + actualSpeed * t, pathLength));
            }

            currentProjectiles.push({
              id: `pr-${Math.random().toString(36).substr(2, 5)}-${Date.now()}`,
              x: tower.x + Math.cos(currentAngle) * 12,
              y: tower.y + Math.sin(currentAngle) * 12,
              z: 40 + tower.level * 2,
              targetX: predPos.x,
              targetY: predPos.y,
              targetZ: 15,
              damage: stats.damage * (1 + (tower.level - 1) * 0.45),
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
            nextLastFired -= fireInterval; // Preserve overflow for accurate ROF
          }
          return { ...tower, lastFired: nextLastFired, targetId: target?.id || null, currentAngle };
        });

        // 6. Global Housekeeping
        if (newShake > 0) newShake = Math.max(0, newShake - dt);
        
        // --- CRITICAL: IMMEDIATE REF SYNC ---
        // This eliminates the 1-frame "React lag" that previously broke fire rates and collision logic.
        enemiesRef.current = currentEnemies;
        towersRef.current = currentTowers;
        projectilesRef.current = currentProjectiles;

        // Final Sync to local states
        setEnemies(currentEnemies);
        setTowers(currentTowers);
        setProjectiles(currentProjectiles);
        
        if (moneyEarned !== 0 || livesLost !== 0 || newShake !== currentGameState.shakeTime) {
          const nextLives = Math.max(0, currentGameState.lives - livesLost);
          const nextMoney = currentGameState.money + moneyEarned;
          const updatedGameState = {
            ...currentGameState,
            money: nextMoney,
            lives: nextLives,
            shakeTime: newShake,
            isGameOver: nextLives <= 0
          };
          setGameState(updatedGameState);
          gameStateRef.current = updatedGameState;
        }

        if (currentEnemies.length === 0 && enemiesToSpawnRef.current === 0 && waveActive) {
          const waveBonus = 120 + (currentGameState.waveNumber - 1) * 25;
          const updatedState = {
            ...gameStateRef.current,
            money: gameStateRef.current.money + waveBonus,
            isWaveReady: true,
            currentWaveModifier: WaveModifier.NONE,
          };
          setWaveActive(false);
          setGameState(updatedState);
          gameStateRef.current = updatedState;
          createFloatingText(PATH[PATH.length - 1].x, PATH[PATH.length - 1].y, `Wave Bonus: +$${waveBonus}`, "#10b981");
        }
        
        // Ephemeral Update
        setParticles(prev => prev.map(p => ({
            ...p,
            x: p.x + p.vx * dt,
            y: p.y + (p.vy || 0) * dt,
            z: (p.z || 10) + (Math.random() - 0.5) * 15 * dt,
            life: p.life - dt * 2.2
          })).filter(p => p.life > 0));

        setFloatingTexts(prev => prev.map(t => ({
            ...t,
            y: t.y - dt * 50,
            life: t.life - dt * 1.5
          })).filter(t => t.life > 0));
      }
    }
    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(update);
  }, [waveActive, pathLength, createExplosion, createFloatingText]); // Stable dependencies


  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [update]);

  const setTowerTargetingMode = useCallback((id: string, mode: TargetingMode) => {
    setTowers(prev => prev.map(t => t.id === id ? { ...t, targetingMode: mode } : t));
  }, []);

  const restart = () => {
    setGameState({
      money: INITIAL_MONEY,
      lives: INITIAL_LIVES,
      waveNumber: 0,
      isPaused: false,
      isGameOver: false,
      isWaveReady: true,
      selectedTowerId: null,
      relocatingTowerId: null,
      shakeTime: 0,
      currentWaveModifier: WaveModifier.NONE,
    });
    setTowers([]);
    setEnemies([]);
    setProjectiles([]);
    setParticles([]);
    setFloatingTexts([]);
    setWaveActive(false);
    enemiesToSpawnRef.current = 0;
  };

  return {
    gameState,
    setGameState,
    towers,
    enemies,
    projectiles,
    particles,
    floatingTexts,
    startWave,
    placeTower,
    upgradeTower,
    specializeTower,
    sellTower,
    startRelocation,
    cancelRelocation,
    confirmRelocation,
    setTowerTargetingMode,
    waveActive,
    restart
  };
}
