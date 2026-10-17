# Tactical Defense: Vector

An isometric tower defense game built with React and Canvas 2D. Hold the core
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

## 3D rendering prototype

`prototype.html` is a standalone WebGL (Three.js) rendering of the same battlefield — PBR
materials, real-time shadows, ambient occlusion, HDR bloom and a night-time reflection
environment — used to evaluate moving the game to a 3D renderer. It is not playable.

```bash
npm run dev      # then open http://localhost:3000/prototype.html
                 # close-up: /prototype.html?zoom=3&x=-6&z=-10
```

Code lives in `src/proto/`; the game itself does not load Three.js.

## Project layout

- `src/hooks/useGame.ts` — simulation loop (spawning, movement, projectiles, economy)
- `src/constants.ts` — tower/enemy stats, wave table and shared balance helpers
- `src/components/GameCanvas.tsx` — isometric renderer
- `src/components/UIOverlay.tsx`, `TowerModule.tsx` — HUD, sidebar and tower panel
