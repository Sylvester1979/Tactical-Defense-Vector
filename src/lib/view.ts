import type React from 'react';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

// The battlefield fills the window. Game logic, clicks and the tower panel still think in the fixed
// 1000×800 isometric frame (toIso / fromIso); a View says where that frame sits on screen. The 3D
// camera is orthographic with a fixed angle, so any framing is just a scale and an offset of it.

export interface View {
  k: number;  // screen px per frame px
  ox: number; // screen position of the frame's origin
  oy: number;
  w: number;  // size of the battlefield layer, screen px
  h: number;
}

export interface Insets { top: number; right: number; bottom: number; left: number }

export const FRAME_VIEW: View = { k: 1, ox: 0, oy: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT };

// The platform (deck, rim, entry gate and lamp posts) in frame coordinates. The deck's right corner
// reaches past x = 1000, which is why the old fixed frame cut it off.
export const PLATFORM_BOUNDS = { x0: -28, y0: 105, x1: 1148, y1: 790 };

// Largest framing that shows the whole platform inside the part of the layer the HUD leaves free
export const fitView = (w: number, h: number, insets: Insets, pad = 16): View => {
  const b = PLATFORM_BOUNDS;
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const freeW = Math.max(1, w - insets.left - insets.right - pad * 2);
  const freeH = Math.max(1, h - insets.top - insets.bottom - pad * 2);
  const k = Math.max(0.3, Math.min(freeW / bw, freeH / bh));
  return {
    k, w, h,
    ox: insets.left + pad + (freeW - bw * k) / 2 - b.x0 * k,
    oy: insets.top + pad + (freeH - bh * k) / 2 - b.y0 * k,
  };
};

// Screen px (relative to the layer) → frame coordinates
export const screenToFrame = (view: View, sx: number, sy: number) => ({ x: (sx - view.ox) / view.k, y: (sy - view.oy) / view.k });

// The frame-sized box that holds anything drawn in frame coordinates (2D canvas, tower panel)
export const frameStyle = (view: View): React.CSSProperties => ({
  position: 'absolute', left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT,
  transform: `translate(${view.ox}px, ${view.oy}px) scale(${view.k})`, transformOrigin: 'top left',
});

// The part of the frame that is on screen and not under the HUD, for keeping panels in view
export const visibleFrame = (view: View, insets: Insets) => ({
  x0: (insets.left - view.ox) / view.k,
  y0: (insets.top - view.oy) / view.k,
  x1: (view.w - insets.right - view.ox) / view.k,
  y1: (view.h - insets.bottom - view.oy) / view.k,
});
