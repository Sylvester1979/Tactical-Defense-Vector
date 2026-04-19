import React, { useRef, useEffect, useState } from 'react';
import { TowerInstance, EnemyInstance, Projectile, Particle, FloatingText, Point, TowerType } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, PATH, TOWER_STATS, ENEMY_TYPES } from '../constants';

import { toIso, fromIso, ISO_SCALE } from '../lib/iso';

// Helper for hover detection
const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
};

interface GameCanvasProps {
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  projectiles: Projectile[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  selectedTowerId: string | null;
  relocatingTowerId: string | null;
  placingType: TowerType | null;
  shakeTime: number;
  onCanvasClick: (x: number, y: number, sx: number, sy: number) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  towers,
  enemies,
  projectiles,
  particles,
  floatingTexts,
  selectedTowerId,
  relocatingTowerId,
  placingType,
  shakeTime,
  onCanvasClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredTowerId, setHoveredTowerId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });

  // Hoisted drawing helpers
  const drawIsoPoly = (ctx: CanvasRenderingContext2D, points: {x: number, y: number}[], fillStyle?: string, strokeStyle?: string, lineWidth: number = 1) => {
    ctx.beginPath();
    const first = toIso(points[0].x, points[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const p = toIso(points[i].x, points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    if (strokeStyle) { ctx.strokeStyle = strokeStyle; ctx.lineWidth = lineWidth; ctx.stroke(); }
  };

  const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

  const drawPrism = (ctx: CanvasRenderingContext2D, x: number, y: number, z: number, r: number, h: number, sides: number, color: string, topColor: string, alpha: number = 1.0, edgeColor?: string) => {
    const b = []; const t = [];
    for(let i=0; i<sides; i++){
      const a = (i/sides) * Math.PI*2 + Math.PI/sides;
      b.push(toIso(x + Math.cos(a)*r, y + Math.sin(a)*r, z));
      t.push(toIso(x + Math.cos(a)*r, y + Math.sin(a)*r, z+h));
    }

    const oldAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.strokeStyle = edgeColor ?? `rgba(0,0,0,${0.3 * alpha})`;
    for(let i=0; i<sides; i++){
       const next = (i+1)%sides;
       if (color !== 'transparent') ctx.fillStyle = color;
       ctx.beginPath();
       ctx.moveTo(b[i].x, b[i].y); ctx.lineTo(b[next].x, b[next].y);
       ctx.lineTo(t[next].x, t[next].y); ctx.lineTo(t[i].x, t[i].y);
       ctx.closePath();
       if (color !== 'transparent') ctx.fill();
       ctx.stroke();
    }
    if (topColor !== 'transparent') ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(t[0].x, t[0].y); t.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    if (topColor !== 'transparent') ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = oldAlpha;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const roadWidth = 55;
    const roadHeight = 15;
    const step = 40;

    // --- CACHING STRATEGY: PRE-RENDER STATIC ENVIRONMENT ---
    if (!cacheRef.current) {
      cacheRef.current = document.createElement('canvas');
      cacheRef.current.width = CANVAS_WIDTH;
      cacheRef.current.height = CANVAS_HEIGHT;
      const cctx = cacheRef.current.getContext('2d');
      if (cctx) {
        // Draw Static Environment once into the cache

        // 1. Clear & Background
        const grad = cctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 0, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_WIDTH);
        grad.addColorStop(0, '#0d1117');
        grad.addColorStop(1, '#010409');
        cctx.fillStyle = grad;
        cctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 2. Foundation Platform
        const baseH = 45;
        const margin = 40;
        const cornerPts = [
          {x: -margin, y: -margin},
          {x: CANVAS_WIDTH + margin, y: -margin},
          {x: CANVAS_WIDTH + margin, y: CANVAS_HEIGHT + margin},
          {x: -margin, y: CANVAS_HEIGHT + margin}
        ];
        
        const b_iso = cornerPts.map(p => toIso(p.x, p.y, -baseH));
        const t_iso = cornerPts.map(p => toIso(p.x, p.y, 0));

        // Side Walls
        cctx.fillStyle = '#010409';
        cctx.beginPath();
        cctx.moveTo(b_iso[0].x, b_iso[0].y); cctx.lineTo(b_iso[1].x, b_iso[1].y);
        cctx.lineTo(t_iso[1].x, t_iso[1].y); cctx.lineTo(t_iso[0].x, t_iso[0].y);
        cctx.closePath(); cctx.fill();

        // South Wall (Graded)
        const sGrad = cctx.createLinearGradient(b_iso[1].x, b_iso[1].y, b_iso[2].x, b_iso[2].y);
        sGrad.addColorStop(0, '#0d1117');
        sGrad.addColorStop(1, '#050608');
        cctx.fillStyle = sGrad;
        cctx.beginPath();
        cctx.moveTo(b_iso[1].x, b_iso[1].y); cctx.lineTo(b_iso[2].x, b_iso[2].y);
        cctx.lineTo(t_iso[2].x, t_iso[2].y); cctx.lineTo(t_iso[1].x, t_iso[1].y);
        cctx.closePath(); cctx.fill(); 

        // East Face
        cctx.fillStyle = '#050608';
        cctx.beginPath();
        cctx.moveTo(b_iso[2].x, b_iso[2].y); cctx.lineTo(b_iso[3].x, b_iso[3].y);
        cctx.lineTo(t_iso[3].x, t_iso[3].y); cctx.lineTo(t_iso[2].x, t_iso[2].y);
        cctx.closePath(); cctx.fill();

        // Top Surface
        const tGrad = cctx.createRadialGradient(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, 50, CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_WIDTH);
        tGrad.addColorStop(0, '#1c2128');
        tGrad.addColorStop(1, '#0d1117');
        cctx.fillStyle = tGrad;
        cctx.beginPath();
        cctx.moveTo(t_iso[0].x, t_iso[0].y); t_iso.forEach(p => cctx.lineTo(p.x, p.y));
        cctx.closePath(); cctx.fill();

        // 3. Technical Grid Patterns
        cctx.strokeStyle = 'rgba(0, 242, 255, 0.05)';
        cctx.lineWidth = 0.5;
        for (let i = 0; i < CANVAS_WIDTH; i += 120) {
          for (let j = 0; j < CANVAS_HEIGHT; j += 120) {
            const p1 = toIso(i, j);
            const p2 = toIso(i + 40, j);
            const p3 = toIso(i + 40, j + 40);
            cctx.beginPath();
            cctx.moveTo(p1.x, p1.y); cctx.lineTo(p2.x, p2.y); cctx.lineTo(p3.x, p3.y);
            cctx.stroke();
          }
        }

        // 4. Road/Path
        cctx.fillStyle = '#0a0d11';
        PATH.forEach(p => {
           cctx.beginPath();
           for(let i=0; i<=16; i++){
              const a = (i/16) * Math.PI * 2;
              const px = p.x + Math.cos(a) * roadWidth/2;
              const py = p.y + Math.sin(a) * roadWidth/2;
              const pi = toIso(px, py);
              if (i===0) cctx.moveTo(pi.x, pi.y); else cctx.lineTo(pi.x, pi.y);
           }
           cctx.fill();
        });

        cctx.fillStyle = '#1c2128';
        cctx.strokeStyle = '#2d333b';
        for (let i = 0; i < PATH.length - 1; i++) {
           const p1 = PATH[i]; const p2 = PATH[i+1];
           const angle = Math.atan2(p2.y-p1.y, p2.x-p1.x);
           const perpAngle = angle + Math.PI/2;
           const dx = Math.cos(perpAngle) * roadWidth/2;
           const dy = Math.sin(perpAngle) * roadWidth/2;

           const q1_t = toIso(p1.x - dx, p1.y - dy, roadHeight);
           const q2_t = toIso(p2.x - dx, p2.y - dy, roadHeight);
           const q3_t = toIso(p2.x + dx, p2.y + dy, roadHeight);
           const q4_t = toIso(p1.x + dx, p1.y + dy, roadHeight);

           cctx.beginPath();
           cctx.moveTo(q1_t.x, q1_t.y); cctx.lineTo(q2_t.x, q2_t.y); cctx.lineTo(q3_t.x, q3_t.y); cctx.lineTo(q4_t.x, q4_t.y);
           cctx.closePath(); cctx.fill(); cctx.stroke();
        }

        PATH.forEach(p => {
           cctx.beginPath();
           for(let i=0; i<=16; i++){
              const a = (i/16) * Math.PI * 2;
              const pt = toIso(p.x + Math.cos(a) * roadWidth/2, p.y + Math.sin(a) * roadWidth/2, roadHeight);
              if (i===0) cctx.moveTo(pt.x, pt.y); else cctx.lineTo(pt.x, pt.y);
           }
           cctx.closePath(); cctx.fill(); cctx.stroke();
        });
      }
    }

    ctx.save();
    
    // Screen Shake
    if (shakeTime > 0) {
      const intensity = shakeTime * 20;
      ctx.translate(Math.random() * intensity - intensity/2, Math.random() * intensity - intensity/2);
    }

    // 1. Render Background from Cache
    if (cacheRef.current) {
       ctx.drawImage(cacheRef.current, 0, 0);
    }

    // --- DYNAMIC GLOBAL ILLUMINATION (Projectile & Explosion Glow on ground) ---
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    projectiles.forEach(p => {
      const groundPt = toIso(p.x, p.y, 0);
      const intensity = 0.08 + (p.progress * 0.05);
      const rad = 35 + (p.progress * 15);
      const grad = ctx.createRadialGradient(groundPt.x, groundPt.y, 0, groundPt.x, groundPt.y, rad);
      const color = TOWER_STATS[p.type].color;
      // Extract RGB for alpha mixing
      const r = parseInt(color.slice(1,3),16);
      const g = parseInt(color.slice(3,5),16);
      const b = parseInt(color.slice(5,7),16);
      grad.addColorStop(0, `rgba(${r},${g},${b},${intensity})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(groundPt.x, groundPt.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Explosion ambient flares
    particles.forEach(p => {
      if (p.life > 0.7) {
        const pt = toIso(p.x, p.y, 0);
        const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 25 * p.life);
        grad.addColorStop(0, p.color.replace(')', `,${0.1 * p.life})`).replace('rgb', 'rgba'));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(pt.x, pt.y, 25 * p.life, 12 * p.life, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();

    // --- 1. THE PATH (ROAD VOLUME) ---
    
    // Draw all path sides first for better occlusion
    ctx.fillStyle = '#0a0d11'; // Shaded X-face
    const fillSideY = '#161b22'; // Brighter Y-face
    
    for (let i = 0; i < PATH.length - 1; i++) {
      const p1 = PATH[i]; const p2 = PATH[i+1];
      const angle = Math.atan2(p2.y-p1.y, p2.x-p1.x);
      const perpAngle = angle + Math.PI/2;
      const dx = Math.cos(perpAngle) * roadWidth/2;
      const dy = Math.sin(perpAngle) * roadWidth/2;

      const quad = [
        {x: p1.x - dx, y: p1.y - dy},
        {x: p2.x - dx, y: p2.y - dy},
        {x: p2.x + dx, y: p2.y + dy},
        {x: p1.x + dx, y: p1.y + dy}
      ];

      const q = quad.map(p => toIso(p.x, p.y));
      const qt = quad.map(p => toIso(p.x, p.y, roadHeight));

      // Side Wall 1 (Leftish)
      ctx.fillStyle = Math.abs(angle) > Math.PI/2 ? fillSideY : '#0a0d11';
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(qt[1].x, qt[1].y); ctx.lineTo(qt[0].x, qt[0].y);
      ctx.closePath(); ctx.fill();
      
      // Side Wall 2 (Rightish)
      ctx.fillStyle = Math.abs(angle) > Math.PI/2 ? '#0a0d11' : fillSideY;
      ctx.beginPath();
      ctx.moveTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(qt[2].x, qt[2].y); ctx.lineTo(qt[1].x, qt[1].y);
      ctx.closePath(); ctx.fill();
    }

    // Joint Cylinders sides
    ctx.fillStyle = '#0a0d11';
    PATH.forEach(p => {
       const b = toIso(p.x, p.y);
       const t = toIso(p.x, p.y, roadHeight);
       ctx.beginPath();
       for(let i=0; i<=32; i++){
          const a = (i/32) * Math.PI * 2;
          const px = p.x + Math.cos(a) * roadWidth/2;
          const py = p.y + Math.sin(a) * roadWidth/2;
          const pi = toIso(px, py);
          const pit = toIso(px, py, roadHeight);
          if (i===0) ctx.moveTo(pi.x, pi.y); else ctx.lineTo(pi.x, pi.y);
       }
       ctx.fill();
    });

    // Draw All Path Tops
    ctx.fillStyle = '#1c2128';
    ctx.strokeStyle = '#2d333b';
    ctx.lineWidth = 1;

    for (let i = 0; i < PATH.length - 1; i++) {
       const p1 = PATH[i]; const p2 = PATH[i+1];
       const angle = Math.atan2(p2.y-p1.y, p2.x-p1.x);
       const perpAngle = angle + Math.PI/2;
       const dx = Math.cos(perpAngle) * roadWidth/2;
       const dy = Math.sin(perpAngle) * roadWidth/2;

       const q1_t = toIso(p1.x - dx, p1.y - dy, roadHeight);
       const q2_t = toIso(p2.x - dx, p2.y - dy, roadHeight);
       const q3_t = toIso(p2.x + dx, p2.y + dy, roadHeight);
       const q4_t = toIso(p1.x + dx, p1.y + dy, roadHeight);

       ctx.beginPath();
       ctx.moveTo(q1_t.x, q1_t.y); ctx.lineTo(q2_t.x, q2_t.y); ctx.lineTo(q3_t.x, q3_t.y); ctx.lineTo(q4_t.x, q4_t.y);
       ctx.closePath(); ctx.fill(); ctx.stroke();

       // Energy Stream along the path core
       const streamTime = Date.now() / 1500;
       const streamPos = (streamTime + i * 0.2) % 1.0;
       ctx.strokeStyle = 'rgba(0, 242, 255, 0.4)';
       ctx.lineWidth = 2;
       ctx.beginPath();
       const s1 = toIso(p1.x + (p2.x-p1.x)*(streamPos), p1.y + (p2.y-p1.y)*(streamPos), roadHeight + 1);
       const streamLen = 0.2;
       const sEnd = Math.min(1.0, streamPos + streamLen);
       const s2 = toIso(p1.x + (p2.x-p1.x)*(sEnd), p1.y + (p2.y-p1.y)*(sEnd), roadHeight + 1);
       ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
       ctx.stroke();
    }
    
    // Path Caps (Joint Tops)
    PATH.forEach(p => {
       ctx.beginPath();
       for(let i=0; i<=32; i++){
          const a = (i/32) * Math.PI * 2;
          const pt = toIso(p.x + Math.cos(a) * roadWidth/2, p.y + Math.sin(a) * roadWidth/2, roadHeight);
          if (i===0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
       }
       ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // --- 2. SHADOWS (On top of road) ---
    const drawShadow = (x: number, y: number, radius: number, isEnemy: boolean = false) => {
      // Check if entity is on path to adjust shadow height
      // (Simplified: we use roadHeight for all if they are roughly on path, 
      // or we can detect intersection. For now, we'll draw shadows at both 0 and roadHeight with alpha)
      const pTop = toIso(x, y, roadHeight + 0.5);
      const pBot = toIso(x, y, 0.5);
      
      ctx.save();
      ctx.scale(1, 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      
      ctx.beginPath();
      ctx.arc(pTop.x, pTop.y * 2, radius, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    };

    towers.forEach(t => drawShadow(t.x, t.y, 22));
    enemies.forEach(e => drawShadow(e.x, e.y, 10, true));

    // Energy Flow on Path
    const flowTime = Date.now() / 1000;
    ctx.setLineDash([10, 20]);
    ctx.lineDashOffset = -flowTime * 50;
    ctx.strokeStyle = '#00f2ff';
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const firstFlow = toIso(PATH[0].x, PATH[0].y, roadHeight + 1);
    ctx.moveTo(firstFlow.x, firstFlow.y);
    PATH.forEach(p => { const pt = toIso(p.x, p.y, roadHeight + 1); ctx.lineTo(pt.x, pt.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // Building Grid (Placement Highlights)
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#00f2ff';
    const checkPath = (px: number, py: number) => {
      for (let i = 0; i < PATH.length - 1; i++) {
        const p1 = PATH[i]; const p2 = PATH[i + 1];
        const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2; if (l2 === 0) continue;
        let t = ((px - p1.x) * (p2.x - p1.x) + (py - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const dx = px - (p1.x + t * (p2.x - p1.x)); const dy = py - (p1.y + t * (p2.y - p1.y));
        if (Math.sqrt(dx*dx + dy*dy) < 40) return true;
      }
      return false;
    };

    for (let x = step/2; x < CANVAS_WIDTH; x += step) {
      for (let y = step/2; y < CANVAS_HEIGHT; y += step) {
        if (!checkPath(x, y)) {
          const hasTower = towers.some(t => Math.sqrt((t.x - x)**2 + (t.y - y)**2) < 20);
          if (!hasTower) {
            const p = toIso(x, y);
            ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    ctx.globalAlpha = 1.0;

    // Draw Towers Range
    if (selectedTowerId) {
      const tower = towers.find(t => t.id === selectedTowerId);
      if (tower) {
        const stats = TOWER_STATS[tower.type];
        const range = stats.range * (1 + (tower.level - 1) * 0.1);
        ctx.strokeStyle = 'rgba(0, 242, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          const px = tower.x + Math.cos(a) * range;
          const py = tower.y + Math.sin(a) * range;
          const pt = toIso(px, py);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(0, 242, 255, 0.05)';
        ctx.fill();
      }
    }

    // Z-SORTING AND RENDERING
    const renderables = [
      ...enemies.map(e => ({ type: 'enemy', data: e, depth: e.x + e.y })),
      ...towers.map(t => ({ type: 'tower', data: t, depth: t.x + t.y }))
    ].sort((a, b) => a.depth - b.depth);

    renderables.forEach(obj => {
      if (obj.type === 'enemy') {
        const enemy = obj.data as EnemyInstance;
        const type = ENEMY_TYPES[enemy.type];
        const hitDuration = 100;
        const timeSinceHit = Date.now() - enemy.lastHitTime;
        const isHit = timeSinceHit < hitDuration;
        
        const s = type.size;
        const healthPct = enemy.health / enemy.maxHealth;
        const animTime = (Date.now() / 1000) * 2;
        
        const isFlyer = enemy.type === 'PHANTOM' || enemy.type === 'SCOUT' || enemy.type === 'INTERCEPTOR';
        const floatH = isFlyer ? roadHeight + 15 + Math.sin(animTime * 5) * 5 : roadHeight + s/4;
        
        let dX = enemy.x; let dY = enemy.y;
        if (isHit) {
          const recoilDist = (1 - timeSinceHit / hitDuration) * 5;
          dX += Math.cos(enemy.hitAngle) * recoilDist;
          dY += Math.sin(enemy.hitAngle) * recoilDist;
        }
        
        const pt = toIso(dX, dY, floatH);
        const groundPt = toIso(dX, dY, roadHeight);

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(groundPt.x, groundPt.y, s * 0.4, s * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(pt.x, pt.y);

        // --- ENERGY TRAILS (Ghosting) ---
        if (enemy.type === 'PHANTOM' || enemy.type === 'INTERCEPTOR' || enemy.type === 'SCOUT') {
           ctx.save();
           ctx.globalAlpha = 0.15;
           for(let i=1; i<4; i++) {
             const tx = -i * 4;
             const ty = Math.sin(animTime * 10 + i) * 2;
             ctx.fillStyle = type.color;
             ctx.beginPath();
             ctx.arc(tx, ty, s/2 - i*2, 0, Math.PI * 2);
             ctx.fill();
           }
           ctx.restore();
        }

        if (isHit) { ctx.fillStyle = '#fff'; ctx.shadowBlur = 15; ctx.shadowColor = '#fff'; }
        else { ctx.fillStyle = type.color; ctx.shadowBlur = 10 + Math.sin(animTime * 4) * 5; ctx.shadowColor = type.color; }

        ctx.beginPath();
        if (enemy.type === 'SCOUT') {
          const wf = Math.sin(animTime * 10) * 4;
          ctx.moveTo(0, -s/2); ctx.lineTo(s/2 + wf, 0); ctx.lineTo(0, s/2); ctx.lineTo(-s/2 - wf, 0); ctx.closePath();
        } else if (enemy.type === 'INTERCEPTOR') {
          ctx.moveTo(s/2, 0); ctx.lineTo(-s/2, -s/3); ctx.lineTo(-s/3, 0); ctx.lineTo(-s/2, s/3); ctx.closePath();
        } else if (enemy.type === 'GUARDIAN') {
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            ctx.lineTo(Math.cos(a) * s/2, Math.sin(a) * s/4);
          }
          ctx.closePath();
        } else if (enemy.type === 'PHANTOM') {
          ctx.globalAlpha = 0.4 + Math.sin(animTime * 8) * 0.1;
          ctx.ellipse(0, 0, s/2, s/4, 0, 0, Math.PI * 2);
        } else if (enemy.type === 'COLOSSUS') {
          // Architectural Heavy Dreadnought
          ctx.save();
          // Main Body (Triangular wedge)
          ctx.fillStyle = '#334155';
          ctx.beginPath();
          ctx.moveTo(s/2, 0); ctx.lineTo(-s/2, -s/2.5); ctx.lineTo(-s/2, s/2.5); ctx.closePath();
          ctx.fill();
          // Mid Deck
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.moveTo(s/4, 0); ctx.lineTo(-s/2.5, -s/3.5); ctx.lineTo(-s/2.5, s/3.5); ctx.closePath();
          ctx.fill();
          // Navigation bridge
          ctx.fillStyle = '#ef4444';
          ctx.beginPath(); ctx.arc(-s/4, 0, 4, 0, Math.PI * 2); ctx.fill();
          // Side Engine exhausts (Glow)
          ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.fillRect(-s/2 - 2, -s/4, 4, s/2);
          ctx.restore();
        } else {
          ctx.rect(-s/2, -s/4, s, s/2);
        }
        ctx.fill();

        // --- STATUS EFFECT VISUALS ---
        if (enemy.slowDuration > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#0ea5e9';
          ctx.strokeStyle = '#0ea5e9';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }

        if (enemy.burnDuration > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.shadowBlur = 8 + Math.random() * 8;
          ctx.shadowColor = '#f87171';
          ctx.fillStyle = `rgba(248, 113, 113, ${0.2 + Math.random() * 0.3})`;
          ctx.fill();
          ctx.restore();
        }
        
        const barY = -s/2 - 5;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-s/2, barY, s, 3);
        ctx.fillStyle = healthPct > 0.5 ? '#00ff00' : healthPct > 0.25 ? '#ffff00' : '#ff0000';
        ctx.fillRect(-s/2, barY, s * healthPct, 3);
        ctx.restore();
      } else {
        const tower = obj.data as TowerInstance;
        const stats = TOWER_STATS[tower.type];
        // Tall architectural towers
        const towerH = 40 + tower.level * 2;
        const baseSize = 22;
        
        const pt = toIso(tower.x, tower.y);
        const topPt = toIso(tower.x, tower.y, towerH);
        const timeSinceFired = (Date.now() - tower.lastFired) / 1000;
        
        // --- TOWER ARCHITECTURE ---
        // 1. Broad Plinth
        drawPrism(ctx, tower.x, tower.y, 0, baseSize * 0.5, 6, 8, '#0d1117', '#1a1d23');
        // 2. Main Obelisk
        drawPrism(ctx, tower.x, tower.y, 6, baseSize * 0.35, towerH - 12, 4, '#1a1d23', '#2d333b');
        // Highlight effect when hovered or selected
        const isHovered = tower.id === hoveredTowerId;
        const isSelected = tower.id === selectedTowerId;
        
        // Recharge Pulse
        const rechargeProgress = Math.min(1, timeSinceFired / (1 / stats.fireRate));
        const pulseIntensity = Math.pow(1 - rechargeProgress, 2);
    
        // 3. Decorative Energy Band
        const bandColor = (isHovered || isSelected) ? '#fff' : stats.color;
        drawPrism(ctx, tower.x, tower.y, towerH * 0.6, baseSize * 0.4, 4, 8, bandColor, bandColor);
        
        // --- NEON EDGE HIGHLIGHTS ---
        ctx.strokeStyle = (isHovered || isSelected) ? '#fff' : stats.color;
        ctx.lineWidth = (isHovered || isSelected) ? 1.0 : 0.5;
        
        // Energy Pulse Glow
        if (pulseIntensity > 0) {
          ctx.save();
          ctx.shadowBlur = 4 * pulseIntensity;
          ctx.shadowColor = stats.color;
          drawPrism(ctx, tower.x, tower.y, towerH * 0.6, baseSize * 0.45, 4, 8, 'transparent', 'transparent', 0.25 * pulseIntensity, stats.color);
          ctx.restore();
        }
        const beamPt1 = toIso(tower.x, tower.y, 6);
        const beamPt2 = toIso(tower.x, tower.y, towerH - 6);
        ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.moveTo(beamPt1.x, beamPt1.y); ctx.lineTo(beamPt2.x, beamPt2.y); ctx.stroke();
        ctx.globalAlpha = 1.0;

        // --- TURRET PIVOT BASE ---
        const pivotPt = toIso(tower.x, tower.y, towerH - 3);
        ctx.fillStyle = '#0a0c10';
        ctx.strokeStyle = '#2d333b';
        ctx.beginPath();
        const pr = baseSize * 0.25;
        ctx.ellipse(pivotPt.x, pivotPt.y, pr, pr * 0.5, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        // --- COMPACT TURRET HEAD ---
        ctx.save();
        ctx.translate(topPt.x, topPt.y);

        // Convert world-space angle to screen-space angle for isometric projection.
        // The iso transform maps world direction (dx,dy) → screen (dx-dy)*ISO_SCALE, (dx+dy)*ISO_SCALE*0.5
        const worldAngle = tower.currentAngle || -Math.PI / 2;
        const wdx = Math.cos(worldAngle);
        const wdy = Math.sin(worldAngle);
        const screenAngle = Math.atan2((wdx + wdy) * ISO_SCALE * 0.5, (wdx - wdy) * ISO_SCALE);

        const recoil = Math.max(0, 1 - timeSinceFired * 15) * 5;

        ctx.rotate(screenAngle);
        
        // Compact modular head with multiple layers for 2.5D depth
        // Shadow layer (Projected on tower body)
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(-7 - recoil, 3, 16, 6);

        // Main Head Body
        ctx.fillStyle = '#1c2128';
        ctx.strokeStyle = '#444c56';
        ctx.lineWidth = 1;
        drawRoundRect(ctx, -8 - recoil, -8, 16, 16, 3);
        ctx.fill(); ctx.stroke();
        
        // Internal Glow (Core)
        ctx.fillStyle = stats.color;
        ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.arc(0 - recoil, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1.0;

        // Top Detail (Sensor/Lens)
        ctx.fillStyle = '#2d333b';
        ctx.beginPath(); ctx.arc(-3 - recoil, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(-3 - recoil, 0, 2, 0, Math.PI * 2); ctx.fill();

        // Type-specific compact emitters
        ctx.fillStyle = stats.color;
        if (tower.type === TowerType.BASIC) {
          // Double micro-nozzles
          ctx.fillRect(8 - recoil, -7, 6, 4);
          ctx.fillRect(8 - recoil, 3, 6, 4);
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = 0.6;
          ctx.fillRect(10 - recoil, -6, 2, 2);
          ctx.fillRect(10 - recoil, 4, 2, 2);
          ctx.globalAlpha = 1.0;
        } else if (tower.type === TowerType.SNIPER) {
          // Single precision lens (Extended)
          ctx.fillStyle = '#30363d';
          ctx.fillRect(8 - recoil, -3, 10, 6);
          ctx.fillStyle = stats.color;
          ctx.beginPath();
          ctx.arc(16 - recoil, 0, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(17 - recoil, -1, 1.5, 0, Math.PI * 2); ctx.fill();
        } else if (tower.type === TowerType.SPLASH) {
          // Broad energy array
          ctx.fillRect(8 - recoil, -10, 4, 20);
          ctx.fillRect(10 - recoil, -6, 4, 12);
          ctx.fillStyle = '#fff';
          ctx.globalAlpha = 0.4;
          ctx.fillRect(8 - recoil, -8, 1, 16);
          ctx.globalAlpha = 1.0;
          // Side cooling fins
          ctx.fillStyle = '#222';
          ctx.fillRect(-4 - recoil, -11, 8, 2);
          ctx.fillRect(-4 - recoil, 9, 8, 2);
        }

        // Muzzle Flash / Energy Pulse (Enhanced)
        if (timeSinceFired < 0.05) {
          ctx.shadowBlur = 25; ctx.shadowColor = stats.color;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(18 - recoil, 0, 10, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.restore();

        // Selected indicator (Ambient glow around base)
        if (isSelected || isHovered) {
          const selP = toIso(tower.x, tower.y, 2);
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(selP.x, selP.y, baseSize * 0.8, baseSize * 0.4, 0, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.4)';
          ctx.setLineDash(isHovered && !isSelected ? [4, 4] : []);
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.shadowBlur = isSelected ? 15 : 5; ctx.shadowColor = stats.color;
          ctx.stroke();
          ctx.restore();
        }

        // Level Indicators (Dots on foundation)
        ctx.fillStyle = stats.color;
        for (let i = 0; i < tower.level; i++) {
           const lpt = toIso(tower.x - baseSize/2 + 5, tower.y - baseSize/2 + 5 + i * 5, 8);
           ctx.beginPath(); ctx.arc(lpt.x, lpt.y, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    });

    // Draw Particles
    particles.forEach(p => {
      const pt = toIso(p.x, p.y, p.z || 10);
      ctx.globalAlpha = (p.life / p.maxLife) * 0.8;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 5; ctx.shadowColor = p.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1.0;

    // Draw Projectiles
    projectiles.forEach(p => {
      const pt = toIso(p.x, p.y, p.z);
      ctx.fillStyle = TOWER_STATS[p.type].color;
      ctx.shadowBlur = 4;
      ctx.shadowColor = TOWER_STATS[p.type].color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      
      // Tracer line
      ctx.strokeStyle = TOWER_STATS[p.type].color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      const tailPt = toIso(p.x - (p.targetX - p.x)*0.1, p.y - (p.targetY - p.y)*0.1, p.z - (p.targetZ - p.z)*0.1);
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(tailPt.x, tailPt.y);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });

    // Draw Floating Texts
    floatingTexts.forEach(t => {
      const pt = toIso(t.x, t.y, 30 + (1 - t.life) * 50);
      ctx.globalAlpha = t.life;
      ctx.fillStyle = t.color;
      ctx.font = 'bold 12px "JetBrains Mono"';
      ctx.textAlign = 'center';
      ctx.fillText(t.text, pt.x, pt.y);
    });
    ctx.globalAlpha = 1.0;

    // Post-Process (Cinematic Vignette & Scanlines)
    const renderPostProcess = () => {
      ctx.save();
      // 1. Precise Vignette
      const vGrad = ctx.createRadialGradient(
        CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_WIDTH * 0.2,
        CANVAS_WIDTH/2, CANVAS_HEIGHT/2, CANVAS_WIDTH * 1.2
      );
      vGrad.addColorStop(0, 'rgba(0,0,0,0)');
      vGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = vGrad;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      
      // 2. Subtle Digital Noise
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.03;
      for(let i=0; i<100; i++) {
        const x = Math.random() * CANVAS_WIDTH;
        const y = Math.random() * CANVAS_HEIGHT;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, y, 1, 1);
      }
      
      // 3. Scanline Interlace (Moving)
      ctx.globalAlpha = 0.05;
      const offset = (Date.now() / 50) % 8;
      ctx.fillStyle = '#0f1115';
      for(let i=offset; i<CANVAS_HEIGHT; i+=8) {
        ctx.fillRect(0, i, CANVAS_WIDTH, 2);
      }
      ctx.restore();
    };
    renderPostProcess();

    // --- GHOST PREVIEWS (New Placement or Relocation) ---
    if (relocatingTowerId || placingType) {
       const gx = mousePos.x;
       const gy = mousePos.y;
       let stats, towerH, color, range;

       if (relocatingTowerId) {
          const tower = towers.find(t => t.id === relocatingTowerId);
          if (tower) {
             stats = TOWER_STATS[tower.type];
             towerH = 40 + tower.level * 2;
             color = 'rgba(255, 184, 0, 0.4)';
             range = stats.range * (1 + (tower.level - 1) * 0.1);
          }
       } else if (placingType) {
          stats = TOWER_STATS[placingType];
          towerH = 40;
          color = 'rgba(0, 242, 255, 0.4)';
          range = stats.range;
       }

       if (stats && towerH !== undefined && color && range) {
          ctx.save();
          const rP = toIso(gx, gy, 2);
          
          // Range circle
          ctx.beginPath();
          ctx.ellipse(rP.x, rP.y, range, range * 0.5, 0, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.setLineDash([5, 5]);
          ctx.stroke();

          // Base placeholder (indicates validity)
          ctx.fillStyle = color.replace('0.4', '0.1');
          ctx.beginPath();
          ctx.ellipse(rP.x, rP.y, 25, 12, 0, 0, Math.PI * 2);
          ctx.fill();

          // Ghost Tower
          drawPrism(ctx, gx, gy, 0, 11, 6, 8, color, color, 0.5);
          drawPrism(ctx, gx, gy, 6, 8, towerH - 12, 4, color, color, 0.5);
          
          ctx.restore();
       }
    }

    if (shakeTime > 0) {
      ctx.fillStyle = `rgba(255, 77, 77, ${shakeTime * 0.3})`;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    ctx.restore();

  }, [towers, enemies, projectiles, particles, floatingTexts, selectedTowerId, hoveredTowerId, relocatingTowerId, placingType, mousePos, shakeTime]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    
    // Convert Screen to Game Coordinates
    const coords = fromIso(sx, sy);
    onCanvasClick(coords.x, coords.y, sx, sy);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const hovered = towers.find(t => {
      const towerH = 40 + t.level * 2;
      const base = toIso(t.x, t.y, 0);
      const top = toIso(t.x, t.y, towerH + 15);
      return distToSegment(sx, sy, base.x, base.y, top.x, top.y) < 25;
    });

    const coords = fromIso(sx, sy);
    setMousePos(coords);
    setHoveredTowerId(hovered?.id || null);
  };

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      className={`bg-dark-bg transition-all duration-200 rounded-lg border border-slate-800 shadow-2xl ${hoveredTowerId ? 'cursor-pointer' : 'cursor-crosshair'}`}
      id="game-canvas"
    />
  );
};
