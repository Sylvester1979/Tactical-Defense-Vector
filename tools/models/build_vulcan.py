"""Rapid Vulcan tower — procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_vulcan.py <out_dir>
    blender -b -P tools/models/build_vulcan.py -- <out_dir>

Writes <out_dir>/vulcan.glb (game asset) and <out_dir>/vulcan.blend (model + render stage).
Hierarchy: Vulcan > Base, Yaw > [Turret, Pitch > Recoil > [Gun, Spin > Barrels, Muzzle]]
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, sphere, cut, join,  # noqa: E402
                    curve_tube, setup_render_stage)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
ARMOR = material('Armor', '#47515f', metallic=0.35, roughness=0.45)
ARMOR_LIGHT = material('ArmorLight', '#5b6676', metallic=0.3, roughness=0.42)
ARMOR_DARK = material('ArmorDark', '#262d36', metallic=0.55, roughness=0.5)
STEEL = material('Steel', '#9aa4b0', metallic=1.0, roughness=0.3)
GUN = material('Gunmetal', '#2a2f36', metallic=0.85, roughness=0.32)
RUBBER = material('Rubber', '#0d0f12', metallic=0.0, roughness=0.8)
GLOW = material('Glow', '#05070a', roughness=0.3, emission='#3b82f6', emission_strength=8)
LENS = material('Lens', '#05070a', roughness=0.1, emission='#8fbaff', emission_strength=10)

root = empty('Vulcan')

# ── Base: plinth, armoured hex body, energy band, yaw bearing ──────────────
PLINTH_H, BODY_H = 0.7, 2.3
BODY_Z0 = 0.88
base = []
base.append(cylinder(2.5, PLINTH_H, loc=(0, 0, PLINTH_H / 2), rot=(0, 0, math.radians(22.5)), verts=8, mat=ARMOR_DARK, bevel=0.1))
base.append(cylinder(2.1, 0.18, loc=(0, 0, 0.79), rot=(0, 0, math.radians(22.5)), verts=8, mat=ARMOR, bevel=0.04))
STEP_TOP = 0.88
# Hex bolts with washers, one in each corner of the step: the corners have the most room
# between the body and the step's edge (edge-midpoints are only ~0.5 from the body)
for k in range(8):
    a = math.radians(22.5 + k * 45)
    x, y = math.cos(a) * 1.8, math.sin(a) * 1.8
    base.append(cylinder(0.14, 0.03, loc=(x, y, STEP_TOP + 0.015), verts=16, mat=STEEL))
    base.append(cylinder(0.095, 0.09, loc=(x, y, STEP_TOP + 0.075), rot=(0, 0, a), verts=6, mat=STEEL, bevel=0.015))
BODY_R0, BODY_R1 = 1.62, 1.22
APOTHEM = math.cos(math.radians(30))  # hex face distance / corner radius


def body_apothem(z):
    """Distance from the axis to a face of the tapered hex body at height z."""
    return (BODY_R0 + (BODY_R1 - BODY_R0) * (z - BODY_Z0) / BODY_H) * APOTHEM


body = cylinder(BODY_R0, BODY_H, radius2=BODY_R1, loc=(0, 0, BODY_Z0 + BODY_H / 2), verts=6, mat=ARMOR, bevel=0.07)
# Two horizontal panel seams cut into the body
for z in (BODY_Z0 + 0.55, BODY_Z0 + 1.45):
    seam = cylinder(2.0, 0.05, loc=(0, 0, z), verts=6)
    inner = cylinder((body_apothem(z) - 0.04) / APOTHEM, 0.2, loc=(0, 0, z), verts=6)  # 4 cm deep groove
    cut(seam, inner)
    cut(body, seam)
base.append(body)
# Armour plates on each face, tilted with the taper
slope = math.atan(0.4 / BODY_H)
for k in range(6):
    a = math.radians(30 + k * 60)
    r = body_apothem(BODY_Z0 + 1.0) + 0.05
    base.append(box((0.1, 0.95, 0.75), loc=(math.cos(a) * r, math.sin(a) * r, BODY_Z0 + 1.0),
                    rot=(0, -slope, a), mat=ARMOR_LIGHT, bevel=0.03))
BAND_Z = BODY_Z0 + 1.62
base.append(torus(1.36, 0.075, loc=(0, 0, BAND_Z), mat=GLOW))
for dz in (-0.13, 0.13):
    base.append(torus(1.34, 0.04, loc=(0, 0, BAND_Z + dz), mat=STEEL, minor_seg=8))
base.append(cylinder(1.32, 0.16, loc=(0, 0, BODY_Z0 + BODY_H + 0.04), verts=6, mat=ARMOR_DARK, bevel=0.03))
base.append(cylinder(1.2, 0.28, loc=(0, 0, BODY_Z0 + BODY_H + 0.26), verts=40, mat=STEEL, bevel=0.03))
join('Base', base, parent=root)

# ── Turret (yaw) ────────────────────────────────────────────────────────────
YAW_Z = BODY_Z0 + BODY_H + 0.4
yaw = empty('Yaw', parent=root, loc=(0, 0, YAW_Z))
turret = []
housing = box((2.3, 2.0, 1.2), loc=(-0.2, 0, YAW_Z + 0.62), mat=ARMOR, bevel=0.12, segments=3, angle=30)
# Sloped glacis at the front-top and an undercut at the rear-bottom give the turret a wedge profile
cut(housing, box((1.6, 2.4, 1.0), loc=(1.12, 0, YAW_Z + 1.42), rot=(0, math.radians(-32), 0)))
cut(housing, box((1.2, 2.4, 0.8), loc=(-1.42, 0, YAW_Z + 0.02), rot=(0, math.radians(-38), 0)))
# Chamfer the four vertical corners
for sx in (-1, 1):
    for sy in (-1, 1):
        cut(housing, box((0.5, 0.5, 2.0), loc=(-0.2 + sx * 1.15, sy * 1.0, YAW_Z + 0.62), rot=(0, 0, math.radians(45))))
for k in range(4):  # cooling slots on the rear deck
    cut(housing, box((0.55, 0.08, 0.3), loc=(-0.85, -0.45 + k * 0.3, YAW_Z + 1.22)))
turret.append(housing)
for side in (-1, 1):
    plate = box((1.35, 0.12, 0.72), loc=(0.1, side * 1.07, YAW_Z + 0.62), mat=ARMOR_DARK, bevel=0.05)
    for k in range(3):  # louvres in the cheek plates
        cut(plate, box((0.8, 0.1, 0.06), loc=(0.0, side * 1.14, YAW_Z + 0.45 + k * 0.17)))
    turret.append(plate)
turret.append(cylinder(0.38, 0.08, loc=(-0.45, 0.25, YAW_Z + 1.24), verts=24, mat=ARMOR_DARK, bevel=0.02))
# Sensor turret with glowing lens
turret.append(cylinder(0.22, 0.32, loc=(0.95, -0.62, YAW_Z + 1.0), rot=(0, math.pi / 2, 0), verts=20, mat=GUN, bevel=0.03))
turret.append(sphere(0.15, loc=(1.1, -0.62, YAW_Z + 1.0), mat=LENS))
# Whip antenna with a tip light
turret.append(cylinder(0.025, 0.9, loc=(-0.95, -0.65, YAW_Z + 1.65), verts=8, mat=STEEL))
turret.append(sphere(0.05, loc=(-0.95, -0.65, YAW_Z + 2.12), mat=GLOW))
# Ammo drum on the left with ribs, bracket and a feed hose to the gun
DRUM = (-0.75, 1.52, YAW_Z + 0.58)
turret.append(cylinder(0.52, 0.75, loc=DRUM, rot=(math.pi / 2, 0, 0), verts=32, mat=ARMOR_DARK, bevel=0.05))
for dy in (-0.22, 0.22):
    turret.append(torus(0.53, 0.035, loc=(DRUM[0], DRUM[1] + dy, DRUM[2]), rot=(math.pi / 2, 0, 0), mat=STEEL, minor_seg=8))
turret.append(box((0.5, 0.3, 0.35), loc=(-0.75, 1.12, YAW_Z + 0.58), mat=ARMOR, bevel=0.04))
turret.append(curve_tube('FeedHose', [(-0.3, 1.55, YAW_Z + 0.75), (0.45, 1.25, YAW_Z + 1.05),
                                      (1.05, 0.55, YAW_Z + 0.85), (1.2, 0.35, YAW_Z + 0.62)], 0.09, RUBBER))
join('Turret', turret, parent=yaw)

# ── Gun: pitch → recoil → spinning barrel cluster ──────────────────────────
PIVOT = (0.9, 0.0, YAW_Z + 0.6)
pitch = empty('Pitch', parent=yaw, loc=(0.9, 0, 0.6))
recoil = empty('Recoil', parent=pitch)
gun = [
    box((0.32, 1.0, 0.9), loc=(1.0, 0, PIVOT[2]), mat=ARMOR_DARK, bevel=0.08),        # mantlet
    cylinder(0.46, 0.75, loc=(1.42, 0, PIVOT[2]), rot=(0, math.pi / 2, 0), verts=32, mat=ARMOR, bevel=0.05),  # shroud
    torus(0.47, 0.03, loc=(1.78, 0, PIVOT[2]), rot=(0, math.pi / 2, 0), mat=STEEL, minor_seg=8),
]
join('Gun', gun, parent=recoil, loc=(0, 0, 0))

spin = empty('Spin', parent=recoil)
barrels = []
for k in range(6):
    a = math.radians(k * 60)
    y, z = math.cos(a) * 0.25, math.sin(a) * 0.25
    barrels.append(cylinder(0.085, 2.15, loc=(2.1 + 0.95 / 2 - 0.45, y, PIVOT[2] + z), rot=(0, math.pi / 2, 0), verts=14, mat=GUN))
for x, r in ((1.95, 0.38), (2.6, 0.4)):
    barrels.append(cylinder(r, 0.14, loc=(x, 0, PIVOT[2]), rot=(0, math.pi / 2, 0), verts=32, mat=STEEL, bevel=0.02))
collar = cylinder(0.37, 0.32, loc=(3.26, 0, PIVOT[2]), rot=(0, math.pi / 2, 0), verts=32, mat=GUN, bevel=0.03)
for k in range(6):  # bore holes for each barrel
    a = math.radians(k * 60)
    cut(collar, cylinder(0.07, 0.4, loc=(3.45, math.cos(a) * 0.25, PIVOT[2] + math.sin(a) * 0.25), rot=(0, math.pi / 2, 0), verts=12))
cut(collar, cylinder(0.09, 0.4, loc=(3.45, 0, PIVOT[2]), rot=(0, math.pi / 2, 0), verts=12))
barrels.append(collar)
join('Barrels', barrels, parent=spin, loc=(0, 0, 0))
empty('Muzzle', parent=recoil, loc=(2.55, 0, 0))

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'vulcan.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True)
print('exported', os.path.join(OUT, 'vulcan.glb'), os.path.getsize(os.path.join(OUT, 'vulcan.glb')), 'bytes')

setup_render_stage(target_height=3.0)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'vulcan.blend'))
print('saved', os.path.join(OUT, 'vulcan.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
