"""Railgun tower — procedural hard-surface model (the sniper).

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_railgun.py <out_dir>
    blender -b -P tools/models/build_railgun.py -- <out_dir>

Writes <out_dir>/railgun.glb (game asset) and <out_dir>/railgun.blend (model + render stage).
Hierarchy: Railgun > Base, Yaw > [Turret, Pitch > [Cradle, Recoil > [Gun, Muzzle]]]
The gun recoils inside the cradle, which stays on the trunnions.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, empty, box, cylinder, torus, cut, join,  # noqa: E402
                    curve_tube, setup_render_stage, tower_materials, tower_base)
from bake import bake_model, EXPORT_IMAGES  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
M = tower_materials(glow='#8b5cf6')
ARMOR, ARMOR_LIGHT, ARMOR_DARK = M['armor'], M['armor_light'], M['armor_dark']
STEEL, GUN, RUBBER, GLOW, LENS = M['steel'], M['gun'], M['rubber'], M['glow'], M['lens']

root = empty('Railgun')

# ── Base: same family as the Vulcan, taller body ────────────────────────────
YAW_Z = tower_base(root, M, body_h=2.8, seams=(0.67, 1.76), plate_z=1.22, plate_h=0.9, band_z=1.97)


def frame(size, hole, loc, mat, bevel=0.03, segments=2):
    """A rectangular collar around the X axis: box `size` with a through-hole `hole` (y, z)."""
    f = box(size, loc=loc, mat=mat, bevel=bevel, segments=segments)
    cut(f, box((size[0] + 0.2, hole[0], hole[1]), loc=loc))
    return f


# ── Turret (yaw): low housing, trunnion yoke, capacitor bank at the back ───
yaw = empty('Yaw', parent=root, loc=(0, 0, YAW_Z))
PIVOT_X, PIVOT_H = 0.2, 1.45  # trunnion axis, relative to the yaw pivot
turret = []
housing = box((2.6, 1.7, 0.75), loc=(-0.55, 0, YAW_Z + 0.375), mat=ARMOR, bevel=0.1, segments=3, angle=30)
cut(housing, box((1.0, 2.2, 0.9), loc=(1.05, 0, YAW_Z + 0.95), rot=(0, math.radians(-35), 0)))   # front glacis
cut(housing, box((1.0, 2.2, 0.7), loc=(-2.15, 0, YAW_Z - 0.05), rot=(0, math.radians(-40), 0)))  # rear undercut
for sx, x in ((-1, -1.85), (1, 0.75)):
    for sy in (-1, 1):
        cut(housing, box((0.42, 0.42, 2.0), loc=(x, sy * 0.85, YAW_Z + 0.4), rot=(0, 0, math.radians(45))))
turret.append(housing)
# Side skirts with louvres
for side in (-1, 1):
    plate = box((1.5, 0.1, 0.5), loc=(-0.75, side * 0.88, YAW_Z + 0.36), mat=ARMOR_DARK, bevel=0.04)
    for k in range(4):
        cut(plate, box((0.07, 0.1, 0.34), loc=(-1.25 + k * 0.3, side * 0.94, YAW_Z + 0.36)))
    turret.append(plate)
# Trunnion yoke: two arms rising from the housing, with bearing bosses
for side in (-1, 1):
    y = side * 0.78
    arm = box((0.72, 0.24, 0.9), loc=(PIVOT_X, y, YAW_Z + 0.95), mat=ARMOR, bevel=0.05)
    cut(arm, box((0.6, 0.4, 0.6), loc=(PIVOT_X + 0.5, y, YAW_Z + 1.25), rot=(0, math.radians(-40), 0)))
    turret.append(arm)
    turret.append(cylinder(0.34, 0.26, loc=(PIVOT_X, y, YAW_Z + PIVOT_H), rot=(math.pi / 2, 0, 0), verts=28, mat=ARMOR_DARK, bevel=0.04, segments=2))
    turret.append(cylinder(0.2, 0.06, loc=(PIVOT_X, side * 0.93, YAW_Z + PIVOT_H), rot=(math.pi / 2, 0, 0), verts=24, mat=STEEL, bevel=0.015, segments=2))
    for k in range(6):  # bolts around the bearing cap
        a = math.radians(30 + k * 60)
        turret.append(cylinder(0.035, 0.05, loc=(PIVOT_X + math.cos(a) * 0.27, side * 0.925, YAW_Z + PIVOT_H + math.sin(a) * 0.27),
                               rot=(math.pi / 2, 0, 0), verts=6, mat=STEEL))
# Capacitor bank: three charge cylinders with glowing cells, a bus bar and feed cables to the yoke
CAP_X = -1.5
turret.append(box((0.75, 1.5, 0.1), loc=(CAP_X, 0, YAW_Z + 0.8), mat=ARMOR_DARK, bevel=0.03))
for y in (-0.48, 0.0, 0.48):
    # Two casing halves with a recessed glowing window band between them, steel end caps
    turret.append(cylinder(0.21, 0.4, loc=(CAP_X, y, YAW_Z + 1.07), verts=20, mat=GUN, bevel=0.03, segments=2))
    turret.append(cylinder(0.21, 0.34, loc=(CAP_X, y, YAW_Z + 1.6), verts=20, mat=GUN, bevel=0.03, segments=2))
    turret.append(cylinder(0.19, 0.2, loc=(CAP_X, y, YAW_Z + 1.33), verts=20, mat=GLOW))
    turret.append(cylinder(0.23, 0.08, loc=(CAP_X, y, YAW_Z + 1.78), verts=20, mat=STEEL, bevel=0.02, segments=2))
    turret.append(cylinder(0.23, 0.08, loc=(CAP_X, y, YAW_Z + 0.89), verts=20, mat=STEEL, bevel=0.02, segments=2))
    turret.append(cylinder(0.07, 0.08, loc=(CAP_X, y, YAW_Z + 1.86), verts=12, mat=STEEL))  # terminal
turret.append(box((0.22, 1.25, 0.08), loc=(CAP_X, 0, YAW_Z + 1.92), mat=STEEL, bevel=0.02))
for side in (-1, 1):
    turret.append(curve_tube(f'Feed{side}', [(CAP_X + 0.1, side * 0.55, YAW_Z + 1.92), (CAP_X + 0.6, side * 0.75, YAW_Z + 1.95),
                                             (PIVOT_X - 0.3, side * 0.85, YAW_Z + 1.55), (PIVOT_X - 0.1, side * 0.93, YAW_Z + PIVOT_H + 0.12)],
                             0.06, RUBBER))
# Cells on the rear face behind the capacitors
turret.append(box((0.08, 1.2, 0.3), loc=(-1.86, 0, YAW_Z + 0.42), mat=ARMOR_DARK, bevel=0.02))
for k in range(3):
    turret.append(box((0.04, 0.28, 0.16), loc=(-1.9, -0.38 + k * 0.38, YAW_Z + 0.42), mat=GLOW))
join('Turret', turret, parent=yaw)

# ── Cradle (pitch): trunnion axle and side plates the gun slides in ────────
PZ = YAW_Z + PIVOT_H
pitch = empty('Pitch', parent=yaw, loc=(PIVOT_X, 0, PIVOT_H))
cradle = [cylinder(0.15, 1.6, loc=(PIVOT_X, 0, PZ), rot=(math.pi / 2, 0, 0), verts=20, mat=STEEL)]
for side in (-1, 1):
    plate = box((1.1, 0.08, 0.56), loc=(PIVOT_X + 0.15, side * 0.53, PZ), mat=ARMOR_DARK, bevel=0.03)
    cut(plate, box((0.5, 0.3, 0.5), loc=(PIVOT_X + 0.8, side * 0.53, PZ - 0.35), rot=(0, math.radians(35), 0)))
    cradle.append(plate)
join('Cradle', cradle, parent=pitch)

# ── Gun (recoil): breech, twin rails, charge coils, muzzle, scope ──────────
recoil = empty('Recoil', parent=pitch)
X0 = PIVOT_X  # gun local x = 0 at the pivot
gun = []
breech = box((1.6, 0.95, 0.7), loc=(X0 + 0.1, 0, PZ), mat=ARMOR, bevel=0.08, segments=3, angle=30)
cut(breech, box((0.8, 1.2, 0.6), loc=(X0 + 1.0, 0, PZ + 0.5), rot=(0, math.radians(-30), 0)))
cut(breech, box((0.8, 1.2, 0.6), loc=(X0 - 0.85, 0, PZ + 0.45), rot=(0, math.radians(35), 0)))
cut(breech, box((0.5, 0.42, 0.2), loc=(X0 - 0.25, 0, PZ + 0.38)))  # recess for the heat-sink fins
gun.append(breech)
# Heat-sink fins standing in the recess on top of the breech
for k in range(5):
    gun.append(box((0.04, 0.38, 0.16), loc=(X0 - 0.45 + k * 0.1, 0, PZ + 0.3), mat=STEEL, bevel=0.008, segments=1))
# Side armour: a lighter panel with bolts over a glowing charge cell
for side in (-1, 1):
    gun.append(box((0.9, 0.04, 0.12), loc=(X0 + 0.05, side * 0.48, PZ - 0.12), mat=GLOW))
    gun.append(box((0.98, 0.05, 0.2), loc=(X0 + 0.05, side * 0.47, PZ - 0.12), mat=ARMOR_DARK, bevel=0.015))
    # (kept inside the cradle plates at y ±0.49, which the gun slides between)
    gun.append(box((0.8, 0.02, 0.24), loc=(X0 - 0.05, side * 0.475, PZ + 0.12), mat=ARMOR_LIGHT, bevel=0.008, segments=1))
    for bx in (-0.38, 0.28):
        for bz in (0.03, 0.21):
            gun.append(cylinder(0.022, 0.012, loc=(X0 + bx, side * 0.484, PZ + bz), rot=(math.pi / 2, 0, 0), verts=6, mat=STEEL))
# Power coupling on the back face, where the capacitor feeds come in
gun.append(cylinder(0.2, 0.12, loc=(X0 - 0.72, 0, PZ - 0.02), rot=(0, math.pi / 2, 0), verts=24, mat=STEEL, bevel=0.02, segments=2))
gun.append(cylinder(0.11, 0.06, loc=(X0 - 0.79, 0, PZ - 0.02), rot=(0, math.pi / 2, 0), verts=20, mat=GLOW))

# Twin rails, spread apart so the channel between them shows from the game camera: dark rails
# with bright steel top edges, and a glowing plasma channel running the whole length between them
RAIL_X0, RAIL_X1 = 0.75, 4.4
rail_len = RAIL_X1 - RAIL_X0
RAIL_Y, RAIL_W, RAIL_H = 0.35, 0.17, 0.4
for side in (-1, 1):
    y = side * RAIL_Y
    rail = box((rail_len, RAIL_W, RAIL_H), loc=(X0 + RAIL_X0 + rail_len / 2, y, PZ), mat=GUN, bevel=0.03, segments=2)
    cut(rail, box((0.5, 0.4, 0.6), loc=(X0 + RAIL_X1 + 0.1, y, PZ + 0.36), rot=(0, math.radians(-45), 0)))  # chamfered tip
    for k in range(3):  # lightening slots on the outer face, between the coils
        cut(rail, box((0.42, 0.06, 0.14), loc=(X0 + 1.62 + k * 0.85, y + side * RAIL_W / 2, PZ - 0.02)))
    gun.append(rail)
    # Light cap along the top edge, stopping short of the chamfer: it catches the key light, so each
    # rail reads as its own bright line either side of the glowing channel (polished steel mirrors
    # the dark night sky and stayed black)
    gun.append(box((rail_len - 0.42, RAIL_W + 0.01, 0.06), loc=(X0 + RAIL_X0 + (rail_len - 0.42) / 2, y, PZ + RAIL_H / 2 + 0.025),
                   mat=ARMOR_LIGHT, bevel=0.015, segments=1))
    # Glowing conductor lining the inner face
    gun.append(box((rail_len - 0.3, 0.025, 0.1), loc=(X0 + RAIL_X0 + rail_len / 2 - 0.1, side * (RAIL_Y - RAIL_W / 2 - 0.01), PZ + 0.04), mat=GLOW))
GAP = 2 * (RAIL_Y - RAIL_W / 2)  # clear width between the rails
# Keel tying the rails together underneath, and the channel floor glowing on top of it
gun.append(box((rail_len - 0.3, GAP + 0.04, 0.08), loc=(X0 + RAIL_X0 + rail_len / 2 - 0.1, 0, PZ - RAIL_H / 2 + 0.04), mat=ARMOR_DARK, bevel=0.015))
gun.append(box((rail_len - 0.5, GAP - 0.1, 0.03), loc=(X0 + RAIL_X0 + rail_len / 2 - 0.1, 0, PZ - RAIL_H / 2 + 0.095), mat=GLOW))
# Plasma core riding in the middle of the channel
gun.append(cylinder(0.05, rail_len - 0.4, loc=(X0 + RAIL_X0 + rail_len / 2 - 0.1, 0, PZ), rot=(0, math.pi / 2, 0), verts=10, mat=GLOW))
# Charge coils: three slim steel collars around both rails with a glowing ring — thin enough that
# the channel stays visible between them
COIL_HOLE = (2 * RAIL_Y + RAIL_W + 0.02, RAIL_H + 0.1)
for x, s_ in ((1.5, 1.0), (2.35, 0.97), (3.2, 0.94)):
    w, h = (COIL_HOLE[0] + 0.24) * s_, (COIL_HOLE[1] + 0.24) * s_
    for dx in (-0.06, 0.06):
        gun.append(frame((0.05, w, h), COIL_HOLE, (X0 + x + dx, 0, PZ), STEEL, bevel=0.012))
    gun.append(frame((0.06, w - 0.05, h - 0.05), COIL_HOLE, (X0 + x, 0, PZ), GLOW, bevel=0))
# Muzzle: a steel frame tying the rail tips, open in the middle so the channel runs out to it
gun.append(frame((0.28, COIL_HOLE[0] + 0.2, RAIL_H + 0.24), (GAP, RAIL_H - 0.06), (X0 + 4.12, 0, PZ), STEEL, bevel=0.03))
gun.append(frame((0.03, GAP, RAIL_H - 0.06), (GAP - 0.12, RAIL_H - 0.18), (X0 + 4.1, 0, PZ), GLOW, bevel=0))
# Feed cables from the breech to the first coil, under the rails
for side in (-1, 1):
    gun.append(curve_tube(f'Coil{side}', [(X0 + 0.7, side * 0.4, PZ - 0.3), (X0 + 1.05, side * 0.42, PZ - 0.44),
                                         (X0 + 1.4, side * 0.38, PZ - 0.32)], 0.045, RUBBER))
# Targeting scope on the left of the breech: tube on two ring mounts, glowing lens, sunshade
SY, SZ = -0.3, PZ + 0.62
for x in (-0.1, 0.45):
    gun.append(box((0.14, 0.12, 0.3), loc=(X0 + x, SY, PZ + 0.42), mat=ARMOR_DARK, bevel=0.02))
    gun.append(cylinder(0.175, 0.06, loc=(X0 + x, SY, SZ), rot=(0, math.pi / 2, 0), verts=24, mat=STEEL))
gun.append(cylinder(0.15, 1.1, loc=(X0 + 0.15, SY, SZ), rot=(0, math.pi / 2, 0), verts=20, mat=GUN, bevel=0.02, segments=2))
hood = cylinder(0.21, 0.42, loc=(X0 + 0.9, SY, SZ), rot=(0, math.pi / 2, 0), radius2=0.23, verts=20, mat=ARMOR_DARK, bevel=0.02, segments=2)
cut(hood, cylinder(0.18, 0.5, loc=(X0 + 1.0, SY, SZ), rot=(0, math.pi / 2, 0), verts=20))
gun.append(hood)
gun.append(cylinder(0.18, 0.02, loc=(X0 + 0.8, SY, SZ), rot=(0, math.pi / 2, 0), verts=20, mat=LENS))
gun.append(cylinder(0.1, 0.12, loc=(X0 - 0.45, SY, SZ), rot=(0, math.pi / 2, 0), verts=20, mat=RUBBER, bevel=0.02))  # eyepiece
gun.append(box((0.2, 0.14, 0.14), loc=(X0 + 0.25, SY + 0.14, SZ), mat=ARMOR_DARK, bevel=0.02))  # adjuster turret
join('Gun', gun, parent=recoil)
empty('Muzzle', parent=recoil, loc=(4.45, 0, 0))

# ── Weather and bake textures (skip with --no-bake) ───────────────────────
bake_model(root)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'railgun.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, **EXPORT_IMAGES)
print('exported', os.path.join(OUT, 'railgun.glb'), os.path.getsize(os.path.join(OUT, 'railgun.glb')), 'bytes')

setup_render_stage(target_height=3.6)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'railgun.blend'))
print('saved', os.path.join(OUT, 'railgun.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
