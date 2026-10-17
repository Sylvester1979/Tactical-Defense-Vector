import { toIso, ISO_SCALE } from '../lib/iso';
import { CANVAS_WIDTH, CANVAS_HEIGHT, PATH } from '../constants';

// Static scenery and landmarks around the battlefield. Everything drawn by the `draw*Static`
// functions goes into GameCanvas's background cache once; the `draw*` per-frame functions only
// animate small parts (lights, energy fields) on top.

// World extents of the platform (the playable field plus a non-buildable rim)
export const PLATFORM_MARGIN = 40;
const PLATFORM_DEPTH = 45;

// Deterministic pseudo-random sequence so the scenery is identical on every load
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

// Axis-aligned box in world space (footprint w × d centred on x,y), lit from the upper left.
// Only the faces the isometric camera sees (+x, +y, top) are drawn.
const drawBox = (
  ctx: CanvasRenderingContext2D, x: number, y: number, z: number,
  w: number, d: number, h: number, top: string, sideX: string, sideY: string,
) => {
  const x0 = x - w / 2, x1 = x + w / 2, y0 = y - d / 2, y1 = y + d / 2;
  const quad = (pts: { x: number; y: number }[], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  quad([toIso(x0, y1, z), toIso(x1, y1, z), toIso(x1, y1, z + h), toIso(x0, y1, z + h)], sideY);
  quad([toIso(x1, y0, z), toIso(x1, y1, z), toIso(x1, y1, z + h), toIso(x1, y0, z + h)], sideX);
  quad([toIso(x0, y0, z + h), toIso(x1, y0, z + h), toIso(x1, y1, z + h), toIso(x0, y1, z + h)], top);
};

// Ellipse of a world-space circle at height z
const isoEllipse = (ctx: CanvasRenderingContext2D, x: number, y: number, z: number, r: number) => {
  const c = toIso(x, y, z);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r * ISO_SCALE * Math.SQRT2, r * ISO_SCALE * Math.SQRT2 * 0.5, 0, 0, Math.PI * 2);
};

// ── Backdrop: the void around the platform ────────────────────────────────
export const drawBackdropStatic = (ctx: CanvasRenderingContext2D) => {
  const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  bg.addColorStop(0, '#05070c');
  bg.addColorStop(0.55, '#070b12');
  bg.addColorStop(1, '#0a0f18');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Atmospheric haze behind the platform
  const centre = toIso(500, 400, 0);
  const haze = ctx.createRadialGradient(centre.x, centre.y, 40, centre.x, centre.y, 620);
  haze.addColorStop(0, 'rgba(0, 120, 160, 0.10)');
  haze.addColorStop(0.5, 'rgba(60, 40, 120, 0.05)');
  haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Distant platforms: dim, flat silhouettes far below/behind the field
  const rnd = seeded(91);
  ([[-700, 0, 100], [1400, 80, 120], [-420, 1180, 100], [1460, 1000, 110], [420, -560, 90]] as const)
    .forEach(([wx, wy, size]) => {
      const drop = 160 + rnd() * 80;
      const pts = [toIso(wx - size, wy - size, -drop), toIso(wx + size, wy - size, -drop),
                   toIso(wx + size, wy + size, -drop), toIso(wx - size, wy + size, -drop)];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = 'rgba(16, 24, 36, 0.45)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 242, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // A few lit windows on each
      for (let i = 0; i < 6; i++) {
        const lp = toIso(wx + (rnd() - 0.5) * size * 1.6, wy + (rnd() - 0.5) * size * 1.6, -drop);
        ctx.fillStyle = rnd() > 0.7 ? 'rgba(255, 184, 0, 0.35)' : 'rgba(0, 242, 255, 0.3)';
        ctx.fillRect(lp.x, lp.y, 2, 1.5);
      }
    });

  // Sparse far-off lights
  for (let i = 0; i < 70; i++) {
    const x = rnd() * CANVAS_WIDTH, y = rnd() * CANVAS_HEIGHT;
    ctx.fillStyle = `rgba(${rnd() > 0.8 ? '167,139,250' : '120,200,255'}, ${0.08 + rnd() * 0.22})`;
    ctx.fillRect(x, y, 1, 1);
  }
};

// ── Platform body (walls + top), replacing the old flat slab ──────────────
export const drawPlatformStatic = (ctx: CanvasRenderingContext2D) => {
  const m = PLATFORM_MARGIN;
  const c = [{ x: -m, y: -m }, { x: CANVAS_WIDTH + m, y: -m }, { x: CANVAS_WIDTH + m, y: CANVAS_HEIGHT + m }, { x: -m, y: CANVAS_HEIGHT + m }];
  const b = c.map(p => toIso(p.x, p.y, -PLATFORM_DEPTH));
  const t = c.map(p => toIso(p.x, p.y, 0));
  const face = (i: number, j: number, fill: string | CanvasGradient) => {
    ctx.beginPath();
    ctx.moveTo(b[i].x, b[i].y); ctx.lineTo(b[j].x, b[j].y); ctx.lineTo(t[j].x, t[j].y); ctx.lineTo(t[i].x, t[i].y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  // The two walls facing the camera (+x and +y), with a lit band of panel lights along each
  const wallX = ctx.createLinearGradient(t[1].x, t[1].y, b[1].x, b[1].y + 20);
  wallX.addColorStop(0, '#141a24'); wallX.addColorStop(1, '#06080c');
  face(1, 2, wallX);
  const wallY = ctx.createLinearGradient(t[2].x, t[2].y, b[2].x, b[2].y + 20);
  wallY.addColorStop(0, '#10151d'); wallY.addColorStop(1, '#040609');
  face(2, 3, wallY);
  for (const [i, j] of [[1, 2], [2, 3]] as const) {
    for (let k = 1; k < 24; k++) {
      const f = k / 24;
      const wx = c[i].x + (c[j].x - c[i].x) * f, wy = c[i].y + (c[j].y - c[i].y) * f;
      const p = toIso(wx, wy, -PLATFORM_DEPTH * 0.45);
      ctx.fillStyle = k % 6 === 0 ? 'rgba(255, 184, 0, 0.45)' : 'rgba(0, 242, 255, 0.22)';
      ctx.fillRect(p.x - 3, p.y - 1, 6, 2);
    }
  }

  // Top surface
  const centre = toIso(500, 400, 0);
  const top = ctx.createRadialGradient(centre.x, centre.y, 60, centre.x, centre.y, 760);
  top.addColorStop(0, '#1f262f');
  top.addColorStop(0.6, '#161c24');
  top.addColorStop(1, '#0e1218');
  ctx.beginPath();
  ctx.moveTo(t[0].x, t[0].y); t.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
  ctx.fillStyle = top; ctx.fill();

  // Glowing rim along the platform edge
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.28)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
};

// ── Ground detail: panels, cables, decals in the open areas ───────────────
export const drawGroundDetailStatic = (ctx: CanvasRenderingContext2D, isNearPath: (x: number, y: number, buffer?: number) => boolean) => {
  const rnd = seeded(7);
  const tile = 80;
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const a = toIso(x0, y0), b2 = toIso(x1, y0), c = toIso(x1, y1), d = toIso(x0, y1);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  };

  // Floor panels: slight per-tile tone variation and inset seams
  for (let gx = -PLATFORM_MARGIN; gx < CANVAS_WIDTH + PLATFORM_MARGIN; gx += tile) {
    for (let gy = -PLATFORM_MARGIN; gy < CANVAS_HEIGHT + PLATFORM_MARGIN; gy += tile) {
      const v = rnd();
      quad(gx + 2, gy + 2, gx + tile - 2, gy + tile - 2);
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.05})` : `rgba(0,0,0,${(0.5 - v) * 0.18})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Cable trunks from the core out to the platform rim
  const core = PATH[PATH.length - 1];
  ([[[core.x, core.y], [40, 700], [-PLATFORM_MARGIN, 760]],
    [[core.x, core.y], [260, 720], [300, CANVAS_HEIGHT + PLATFORM_MARGIN]],
    [[PATH[0].x, PATH[0].y], [-20, 30], [-PLATFORM_MARGIN, -10]]] as [number, number][][])
    .forEach(line => {
      for (const [w, col] of [[4, 'rgba(0,0,0,0.55)'], [1.5, 'rgba(0, 242, 255, 0.16)']] as const) {
        ctx.beginPath();
        line.forEach(([x, y], i) => { const p = toIso(x, y, 0.5); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke();
      }
    });

  // Decals in the open field — skipped wherever the road is
  const decal = (x: number, y: number, draw: () => void) => { if (!isNearPath(x, y, 90)) draw(); };
  // Landing pad
  decal(840, 660, () => {
    isoEllipse(ctx, 840, 660, 0.5, 62); ctx.fillStyle = 'rgba(255,184,0,0.04)'; ctx.fill();
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(255,184,0,0.28)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    isoEllipse(ctx, 840, 660, 0.5, 40); ctx.strokeStyle = 'rgba(255,184,0,0.14)'; ctx.lineWidth = 1; ctx.stroke();
    const a = toIso(825, 645, 0.5), b2 = toIso(825, 675, 0.5), c = toIso(855, 645, 0.5), d = toIso(855, 675, 0.5);
    const m1 = toIso(825, 660, 0.5), m2 = toIso(855, 660, 0.5);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y);
    ctx.strokeStyle = 'rgba(255,184,0,0.35)'; ctx.lineWidth = 2.5; ctx.stroke();
  });
  // Vent grilles
  ([[560, 700], [300, 690], [880, 300], [940, 460], [620, 230]] as const).forEach(([x, y]) => decal(x, y, () => {
    quad(x - 22, y - 14, x + 22, y + 14); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(80, 100, 120, 0.35)'; ctx.lineWidth = 1; ctx.stroke();
    for (let k = -16; k <= 16; k += 6) {
      const p1 = toIso(x + k, y - 11), p2 = toIso(x + k, y + 11);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = 'rgba(120, 140, 160, 0.18)'; ctx.stroke();
    }
  }));
  // Hazard chevrons near the rim corners
  ([[960, 760], [960, 40], [40, 760]] as const).forEach(([x, y]) => decal(x, y, () => {
    for (let k = 0; k < 4; k++) {
      quad(x - 30 + k * 16, y - 6, x - 22 + k * 16, y + 6);
      ctx.fillStyle = 'rgba(255,184,0,0.18)'; ctx.fill();
    }
  }));
};

// ── Comm pylons on the non-buildable rim ──────────────────────────────────
export const PYLONS: { x: number; y: number; h: number }[] = [
  { x: CANVAS_WIDTH + 20, y: 420, h: 78 },
  { x: CANVAS_WIDTH + 20, y: 700, h: 96 },
  { x: 600, y: CANVAS_HEIGHT + 20, h: 70 },
  { x: -20, y: -20, h: 64 },
];

export const drawPylonsStatic = (ctx: CanvasRenderingContext2D) => {
  PYLONS.forEach(({ x, y, h }) => {
    isoEllipse(ctx, x + 6, y + 6, 0, 14); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    drawBox(ctx, x, y, 0, 16, 16, 6, '#2a3442', '#151b24', '#10151c');
    drawBox(ctx, x, y, 6, 6, 6, h - 6, '#2c3848', '#18202b', '#121820');
    // Cross-arms
    drawBox(ctx, x, y, h * 0.62, 22, 3, 3, '#36445a', '#1d2633', '#171e28');
    drawBox(ctx, x, y, h * 0.82, 3, 18, 3, '#36445a', '#1d2633', '#171e28');
  });
};

// Blinking beacon on each pylon (per frame)
export const drawPylonLights = (ctx: CanvasRenderingContext2D, nowMs: number, glowDot: (x: number, y: number, r: number, color: string, blur: number) => void) => {
  PYLONS.forEach(({ x, y, h }, i) => {
    const phase = ((nowMs / 1000) + i * 0.37) % 1.6;
    const on = phase < 0.25;
    const p = toIso(x, y, h + 2);
    ctx.globalAlpha = on ? 1 : 0.25;
    glowDot(p.x, p.y, 2, i % 2 ? '#ff4d4d' : '#ffb800', 6);
  });
  ctx.globalAlpha = 1;
};

// ── Entry gate ────────────────────────────────────────────────────────────
const GATE_HALF = 40;
const GATE_H = 52;

export const drawEntryGate = (ctx: CanvasRenderingContext2D, nowMs: number, roadHeight: number) => {
  const { x, y } = PATH[0];
  const t = nowMs / 1000;
  // Energy field spanning the road between the pylons (drawn first; pylons frame it)
  const a = toIso(x, y - GATE_HALF + 4, roadHeight), b = toIso(x, y + GATE_HALF - 4, roadHeight);
  const a2 = toIso(x, y - GATE_HALF + 4, GATE_H - 4), b2 = toIso(x, y + GATE_HALF - 4, GATE_H - 4);
  const field = ctx.createLinearGradient(a.x, a.y, a2.x, a2.y);
  field.addColorStop(0, 'rgba(0, 242, 255, 0.22)');
  field.addColorStop(1, 'rgba(0, 242, 255, 0.04)');
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath();
  ctx.fillStyle = field; ctx.fill();
  // Scanline sweeping up the field
  const s = (t * 0.8) % 1;
  const sa = toIso(x, y - GATE_HALF + 4, roadHeight + s * (GATE_H - 4 - roadHeight));
  const sb = toIso(x, y + GATE_HALF - 4, roadHeight + s * (GATE_H - 4 - roadHeight));
  ctx.strokeStyle = `rgba(0, 242, 255, ${0.5 * (1 - s)})`; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  // Pylons and lintel
  [-GATE_HALF, GATE_HALF].forEach(off => drawBox(ctx, x, y + off, 0, 10, 10, GATE_H, '#2c3a4c', '#18222e', '#121a24'));
  drawBox(ctx, x, y, GATE_H, 12, GATE_HALF * 2 + 10, 6, '#33445a', '#1b2533', '#151d28');
  // Lit edge strip on the lintel
  const l1 = toIso(x + 6, y - GATE_HALF - 5, GATE_H + 3), l2 = toIso(x + 6, y + GATE_HALF + 5, GATE_H + 3);
  ctx.strokeStyle = 'rgba(0, 242, 255, 0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(l2.x, l2.y); ctx.stroke();
};

// ── Core reactor ──────────────────────────────────────────────────────────
// Colour tracks core integrity: cyan when healthy → amber → red when failing
export const coreColor = (integrity: number) => {
  const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f);
  const [c1, c2, f] = integrity > 0.5
    ? [[255, 184, 0], [0, 242, 255], (integrity - 0.5) / 0.5]
    : [[239, 68, 68], [255, 184, 0], integrity / 0.5];
  return `rgb(${lerp(c1[0], c2[0], f)}, ${lerp(c1[1], c2[1], f)}, ${lerp(c1[2], c2[2], f)})`;
};

export const drawCoreReactor = (ctx: CanvasRenderingContext2D, nowMs: number, roadHeight: number, integrity: number) => {
  const { x, y } = PATH[PATH.length - 1];
  const t = nowMs / 1000;
  const color = coreColor(Math.max(0, Math.min(1, integrity)));
  // Failing cores flicker
  const flicker = integrity < 0.3 ? (Math.sin(t * 23) > 0.6 ? 0.45 : 1) : 1;
  const base = roadHeight;
  drawBox(ctx, x, y, base, 46, 46, 8, '#263140', '#141b25', '#10161e');
  drawBox(ctx, x, y, base + 8, 30, 30, 5, '#2e3b4d', '#18212d', '#131a24');
  // Energy column: vertical cylinder (two ellipses joined by a lit body)
  const r = 8, colH = 34 + Math.sin(t * 2.2) * 2;
  const z0 = base + 13, z1 = z0 + colH;
  const rx = r * ISO_SCALE * Math.SQRT2, ry = rx * 0.5;
  const b = toIso(x, y, z0), tp = toIso(x, y, z1);
  const body = ctx.createLinearGradient(b.x - rx, 0, b.x + rx, 0);
  body.addColorStop(0, 'rgba(0,0,0,0.35)');
  body.addColorStop(0.45, color);
  body.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.globalAlpha = 0.85 * flicker;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(tp.x - rx, tp.y);
  ctx.ellipse(tp.x, tp.y, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(tp.x, tp.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // Containment rings orbiting up and down the column
  for (let k = 0; k < 2; k++) {
    const f = (Math.sin(t * 1.6 + k * Math.PI) + 1) / 2;
    const rp = toIso(x, y, z0 + 4 + f * (colH - 8));
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.75 * flicker;
    ctx.beginPath(); ctx.ellipse(rp.x, rp.y, rx * 1.7, ry * 1.7, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return { top: tp, color };
};
