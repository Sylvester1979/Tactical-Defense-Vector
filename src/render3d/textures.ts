import * as THREE from 'three';

// Procedural PBR texture sets. Each set is painted as a height field plus albedo/roughness on
// 2D canvases; the normal map is derived from the height field, so seams, bolts and vents catch
// the light the way real machined panels do.

const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const canvas = (size: number) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
};

// Sobel over a greyscale height canvas → tangent-space normal map
const heightToNormal = (height: HTMLCanvasElement, strength: number) => {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const { c, ctx } = canvas(size);
  const out = ctx.createImageData(size, size);
  const h = (x: number, y: number) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out.data[i] = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (-ny * 0.5 + 0.5) * 255; // flip for three's +Y-up normal convention
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
};

const toTexture = (c: HTMLCanvasElement, repeat: number, srgb: boolean) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
};

export interface PbrSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

// Deck plating: 4×4 machined panels with grooves, corner bolts, occasional vents and wear
export const makeDeckPlating = (repeat: number): PbrSet => {
  const S = 1024, P = S / 4, rand = rng(42);
  const height = canvas(S), albedo = canvas(S), rough = canvas(S);
  height.ctx.fillStyle = '#808080'; height.ctx.fillRect(0, 0, S, S);
  albedo.ctx.fillStyle = '#3a414b'; albedo.ctx.fillRect(0, 0, S, S);
  rough.ctx.fillStyle = '#8c8c8c'; rough.ctx.fillRect(0, 0, S, S);

  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x0 = px * P, y0 = py * P;
      // Per-panel tone and finish
      const tone = 0.82 + rand() * 0.3;
      albedo.ctx.fillStyle = `rgb(${58 * tone | 0},${65 * tone | 0},${75 * tone | 0})`;
      albedo.ctx.fillRect(x0 + 6, y0 + 6, P - 12, P - 12);
      const r = 110 + rand() * 60;
      rough.ctx.fillStyle = `rgb(${r | 0},${r | 0},${r | 0})`;
      rough.ctx.fillRect(x0 + 6, y0 + 6, P - 12, P - 12);
      // Raised panel with bevelled rim
      height.ctx.fillStyle = '#9a9a9a'; height.ctx.fillRect(x0 + 6, y0 + 6, P - 12, P - 12);
      height.ctx.fillStyle = '#a8a8a8'; height.ctx.fillRect(x0 + 10, y0 + 10, P - 20, P - 20);
      // Corner bolts
      for (const [bx, by] of [[16, 16], [P - 16, 16], [16, P - 16], [P - 16, P - 16]]) {
        height.ctx.fillStyle = '#d0d0d0';
        height.ctx.beginPath(); height.ctx.arc(x0 + bx, y0 + by, 5, 0, Math.PI * 2); height.ctx.fill();
        albedo.ctx.fillStyle = '#5a636e';
        albedo.ctx.beginPath(); albedo.ctx.arc(x0 + bx, y0 + by, 5, 0, Math.PI * 2); albedo.ctx.fill();
        rough.ctx.fillStyle = '#505050';
        rough.ctx.beginPath(); rough.ctx.arc(x0 + bx, y0 + by, 5, 0, Math.PI * 2); rough.ctx.fill();
      }
      // Some panels get a vent grille or an inset hatch
      const kind = rand();
      if (kind < 0.25) {
        for (let k = 0; k < 7; k++) {
          height.ctx.fillStyle = '#404040';
          height.ctx.fillRect(x0 + P * 0.25, y0 + P * 0.3 + k * 11, P * 0.5, 5);
          albedo.ctx.fillStyle = '#1b1f25';
          albedo.ctx.fillRect(x0 + P * 0.25, y0 + P * 0.3 + k * 11, P * 0.5, 5);
        }
      } else if (kind < 0.45) {
        height.ctx.strokeStyle = '#6a6a6a'; height.ctx.lineWidth = 4;
        height.ctx.strokeRect(x0 + P * 0.22, y0 + P * 0.22, P * 0.56, P * 0.56);
      }
    }
  }
  // Wear: scuffs and grime that make the roughness vary across the deck
  for (let i = 0; i < 260; i++) {
    const x = rand() * S, y = rand() * S, len = 10 + rand() * 50, a = rand() * Math.PI;
    rough.ctx.strokeStyle = `rgba(60,60,60,${0.15 + rand() * 0.25})`;
    rough.ctx.lineWidth = 1 + rand() * 2;
    rough.ctx.beginPath(); rough.ctx.moveTo(x, y); rough.ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); rough.ctx.stroke();
    albedo.ctx.strokeStyle = `rgba(110,120,132,${0.05 + rand() * 0.08})`;
    albedo.ctx.lineWidth = 1;
    albedo.ctx.beginPath(); albedo.ctx.moveTo(x, y); albedo.ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); albedo.ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * S, y = rand() * S, r = 20 + rand() * 70;
    const g = albedo.ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(10,12,16,${0.12 + rand() * 0.15})`); g.addColorStop(1, 'rgba(10,12,16,0)');
    albedo.ctx.fillStyle = g; albedo.ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const gr = rough.ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(230,230,230,0.25)'); gr.addColorStop(1, 'rgba(230,230,230,0)');
    rough.ctx.fillStyle = gr; rough.ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return {
    map: toTexture(albedo.c, repeat, true),
    normalMap: toTexture(heightToNormal(height.c, 6), repeat, false),
    roughnessMap: toTexture(rough.c, repeat, false),
  };
};

// Road surface: dark composite with lengthwise grooves and amber hazard edges
export const makeRoadSurface = (): PbrSet & { emissiveMap: THREE.Texture } => {
  const S = 512, rand = rng(9);
  const height = canvas(S), albedo = canvas(S), rough = canvas(S), emit = canvas(S);
  height.ctx.fillStyle = '#808080'; height.ctx.fillRect(0, 0, S, S);
  albedo.ctx.fillStyle = '#2c333d'; albedo.ctx.fillRect(0, 0, S, S);
  rough.ctx.fillStyle = '#9c9c9c'; rough.ctx.fillRect(0, 0, S, S);
  emit.ctx.fillStyle = '#000'; emit.ctx.fillRect(0, 0, S, S);
  // Lengthwise grip grooves (texture u runs across the road, v along it)
  for (let x = 40; x < S - 40; x += 18) {
    height.ctx.fillStyle = '#5a5a5a'; height.ctx.fillRect(x, 0, 4, S);
    albedo.ctx.fillStyle = '#161b21'; albedo.ctx.fillRect(x, 0, 4, S);
  }
  // Hazard edges: amber dashes along both borders
  for (let y = 0; y < S; y += 64) {
    for (const x of [8, S - 26]) {
      albedo.ctx.fillStyle = '#8a6a10'; albedo.ctx.fillRect(x, y, 18, 38);
      emit.ctx.fillStyle = '#5a4000'; emit.ctx.fillRect(x, y, 18, 38);
      rough.ctx.fillStyle = '#707070'; rough.ctx.fillRect(x, y, 18, 38);
    }
  }
  // Centre guide line (glowing)
  for (let y = 0; y < S; y += 128) {
    emit.ctx.fillStyle = '#0aa8b8'; emit.ctx.fillRect(S / 2 - 3, y + 20, 6, 70);
    albedo.ctx.fillStyle = '#20646c'; albedo.ctx.fillRect(S / 2 - 3, y + 20, 6, 70);
  }
  for (let i = 0; i < 400; i++) {
    const x = rand() * S, y = rand() * S;
    rough.ctx.fillStyle = `rgba(${rand() > 0.5 ? 255 : 60},${rand() > 0.5 ? 255 : 60},${rand() > 0.5 ? 255 : 60},0.12)`;
    rough.ctx.fillRect(x, y, 2 + rand() * 6, 2 + rand() * 6);
  }
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = toTexture(c, 1, srgb);
    t.wrapS = THREE.ClampToEdgeWrapping;
    return t;
  };
  return {
    map: mk(albedo.c, true),
    normalMap: mk(heightToNormal(height.c, 4), false),
    roughnessMap: mk(rough.c, false),
    emissiveMap: mk(emit.c, true),
  };
};

// Fine panel lines for tower/enemy hulls (tiling, subtle)
export const makeHullDetail = (): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } => {
  const S = 256, rand = rng(5);
  const height = canvas(S), rough = canvas(S);
  height.ctx.fillStyle = '#808080'; height.ctx.fillRect(0, 0, S, S);
  rough.ctx.fillStyle = '#6e6e6e'; rough.ctx.fillRect(0, 0, S, S);
  height.ctx.strokeStyle = '#5c5c5c'; height.ctx.lineWidth = 2;
  for (let k = 0; k < 6; k++) {
    const v = rand() * S;
    height.ctx.beginPath(); height.ctx.moveTo(0, v); height.ctx.lineTo(S, v); height.ctx.stroke();
    const u = rand() * S;
    height.ctx.beginPath(); height.ctx.moveTo(u, 0); height.ctx.lineTo(u, S); height.ctx.stroke();
  }
  for (let i = 0; i < 120; i++) {
    rough.ctx.fillStyle = `rgba(${rand() > 0.5 ? 200 : 40},${rand() > 0.5 ? 200 : 40},${rand() > 0.5 ? 200 : 40},0.15)`;
    rough.ctx.fillRect(rand() * S, rand() * S, 2 + rand() * 10, 1 + rand() * 3);
  }
  return { normalMap: toTexture(heightToNormal(height.c, 3), 1, false), roughnessMap: toTexture(rough.c, 1, false) };
};
