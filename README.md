# Tactical Defense: Vector

An isometric tower defense game built with React and Three.js (WebGL). Hold the core
against 20 scripted waves (and endless procedural ones after that) using three
tower lines, each with two specializations.

## Run locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build into dist/
npm run lint     # type-check
```

## How to play

- **Towers**: Rapid Vulcan (kinetic), Railgun (energy), Nova Mortar (explosive splash).
  Overclock a tower up to MK.3, then specialize it into one of two variants (up to MK.5).
- **Damage types matter**: enemies resist or are weak to specific damage types.
  The *Incoming* panel shows the next wave's enemies, their HP, resistances, and how
  many lives each one costs if it reaches the core.
- **Wave modifiers**: RUSH (faster), SWARM (more, weaker), ELITE (fewer, tougher, richer).
- Selling refunds 60% of everything invested in a tower; relocating costs a flat fee.
- Progress autosaves between waves and resumes on reload (Restart starts over; losing
  clears the save). Your best run — most waves cleared — is tracked in the HUD.

### Controls

| Key | Action |
| --- | --- |
| `1` `2` `3` | Pick Vulcan / Railgun / Mortar for placement |
| `Space` | Start next wave |
| `P` | Pause / resume |
| `F` | Game speed 1× / 2× / 3× |
| `M` | Mute / unmute sound |
| `U` | Overclock selected tower |
| `S` `S` | Sell selected tower (press twice) |
| `R` | Relocate selected tower |
| `T` | Cycle targeting priority |
| `Esc` | Cancel / deselect |

## Rendering

The battlefield renders in WebGL with Three.js: models built in Blender (`tools/models/`),
PBR materials with baked weathering, real-time shadows, ambient occlusion and HDR bloom.
The renderer lowers its own quality (ambient occlusion first, then resolution) on slower GPUs.

- `?quality=low` starts without ambient occlusion.
- `?renderer=2d` uses the original Canvas 2D renderer (also the automatic fallback when the
  browser has no WebGL2). Three.js is loaded on demand, so the 2D path never downloads it.
- `?models=procedural` swaps the authored models for the primitive-built ones.

`prototype.html` is a non-playable looping skirmish for inspecting models up close:

```bash
npm run dev      # then open http://localhost:3000/prototype.html?zoom=3&x=-6&z=-10
```

## Project layout

- `src/hooks/useGame.ts` — simulation loop (spawning, movement, projectiles, economy)
- `src/constants.ts` — tower/enemy stats, wave table and shared balance helpers
- `src/components/GameView3D.tsx`, `src/render3d/` — WebGL renderer (scene sync, models, effects)
- `src/components/GameCanvas.tsx` — Canvas 2D renderer (fallback)
- `src/components/UIOverlay.tsx`, `TowerModule.tsx` — HUD, sidebar and tower panel
