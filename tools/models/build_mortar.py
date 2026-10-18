"""Heavy Mortar tower — procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_mortar.py <out_dir>
    blender -b -P tools/models/build_mortar.py -- <out_dir>

Writes <out_dir>/mortar.glb (game asset) and <out_dir>/mortar.blend (model + render stage).
Hierarchy: Mortar > Base, Yaw > [Turret, Pitch > [Cradle, Recoil > [Tube, Muzzle]]]
The tube is modelled level along +X, then Pitch is given a fixed lob elevation.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, sphere, cut, join,  # noqa: E402
                    curve_tube, setup_render_stage, tower_materials, tower_base)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
M = tower_materials(glow='#ef4444')
ARMOR, ARMOR_LIGHT, ARMOR_DARK = M['armor'], M['armor_light'], M['armor_dark']
STEEL, GUN, RUBBER, GLOW, LENS = M['steel'], M['gun'], M['rubber'], M['glow'], M['lens']
HAZARD = material('Hazard', '#c9900a', metallic=0.3, roughness=0.5)
HAZARD_DARK = material('HazardDark', '#14171b', metallic=0.3, roughness=0.6)
SHELL = material('ShellCasing', '#8a6a3a', metallic=0.9, roughness=0.35)

ELEVATION = 0.9  # fixed lob angle (rad) the game keeps for the mortar

root = empty('Mortar')


def intersect(target, other):
    """Boolean-intersect `target` with `other` (applied), then delete `other`."""
    mod = target.modifiers.new('clip', 'BOOLEAN')
    mod.object = other
    mod.operation = 'INTERSECT'
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(other, do_unlink=True)


def hazard_strip(length, height, loc, rot_z=0.0, depth=0.04):
    """Amber plate with black 45° stripes, `length` along local X, facing local ±Y."""
    plate = box((length, depth, height), mat=HAZARD, bevel=0.01, segments=1)
    bars = []
    w = height * 0.32
    n = int(length / (2 * w)) + 3
    for i in range(n):
        x = -length / 2 - height + i * 2 * w
        bars.append(box((w, depth + 0.012, height * 2.2), loc=(x, 0, 0), rot=(0, math.radians(45), 0), mat=HAZARD_DARK))
    bpy.ops.object.select_all(action='DESELECT')
    for b in bars:
        b.select_set(True)
    bpy.context.view_layer.objects.active = bars[0]
    # Bake each bar's placement into its mesh so the joined stripes live in strip space
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    stripes = bpy.context.active_object
    intersect(stripes, box((length - 0.02, depth + 0.02, height - 0.02)))
    for o in (plate, stripes):
        o.location = loc
        o.rotation_euler = (0, 0, rot_z)
    return [plate, stripes]


# ── Base: same family as the Vulcan, squatter body ──────────────────────────
YAW_Z = tower_base(root, M, body_h=1.7, seams=(0.3,), plate_z=0.8, plate_h=0.55, band_z=1.35)

# ── Turret (yaw): armoured deck, trunnion cheeks, shell pannier ─────────────
yaw = empty('Yaw', parent=root, loc=(0, 0, YAW_Z))
PIVOT_X, PIVOT_DZ = 0.15, 1.85        # trunnion axis, relative to the yaw pivot
PZ = YAW_Z + PIVOT_DZ
DECK_TOP = YAW_Z + 0.62
turret = []

deck = box((3.1, 2.7, 0.62), loc=(-0.1, 0, YAW_Z + 0.31), mat=ARMOR, bevel=0.1, segments=2, angle=30)
# Sloped front edge and an undercut at the back
cut(deck, box((1.0, 3.0, 0.8), loc=(1.62, 0, YAW_Z + 0.78), rot=(0, math.radians(-35), 0)))
cut(deck, box((0.8, 3.0, 0.7), loc=(-1.86, 0, YAW_Z - 0.12), rot=(0, math.radians(-40), 0)))
for sx in (-1, 1):
    for sy in (-1, 1):
        cut(deck, box((0.6, 0.6, 2.0), loc=(-0.1 + sx * 1.55, sy * 1.35, YAW_Z + 0.3), rot=(0, 0, math.radians(45))))
# Breech well: when the tube recoils its breech dips below deck level
cut(deck, box((1.25, 1.34, 0.6), loc=(-0.6, 0, DECK_TOP), mat=None))
turret.append(deck)
# Well lining and floor
turret.append(box((1.2, 1.3, 0.04), loc=(-0.6, 0, DECK_TOP - 0.29), mat=ARMOR_DARK))
# Side skirts with hazard striping along the deck flanks
for side in (-1, 1):
    skirt = box((2.2, 0.1, 0.42), loc=(-0.15, side * 1.38, YAW_Z + 0.3), mat=ARMOR_DARK, bevel=0.03)
    for k in range(5):  # vent slots
        cut(skirt, box((0.08, 0.3, 0.24), loc=(-0.85 + k * 0.32, side * 1.44, YAW_Z + 0.3)))
    turret.append(skirt)
turret += hazard_strip(1.5, 0.2, loc=(1.46, 0, YAW_Z + 0.2), rot_z=math.radians(90))  # front face
# Glacis plate on the sloped front edge, with two hooded work lights
turret.append(box((0.55, 1.5, 0.05), loc=(1.29, 0, YAW_Z + 0.5), rot=(0, math.radians(-35), 0), mat=ARMOR_LIGHT, bevel=0.015, segments=2))
for sy in (-1, 1):
    turret.append(box((0.16, 0.26, 0.14), loc=(1.42, sy * 0.95, YAW_Z + 0.46), mat=GUN, bevel=0.03))
    turret.append(box((0.03, 0.18, 0.07), loc=(1.505, sy * 0.95, YAW_Z + 0.45), mat=LENS))
# Deck plates and tie-down bolts
for sy in (-1, 1):
    turret.append(box((0.9, 0.55, 0.05), loc=(0.75, sy * 0.85, DECK_TOP), mat=ARMOR_LIGHT, bevel=0.015, segments=2))
    for bx in (0.4, 1.1):
        turret.append(cylinder(0.05, 0.06, loc=(bx, sy * 1.06, DECK_TOP + 0.04), verts=6, mat=STEEL))

# Trunnion cheeks: thick plates holding the cradle, trapezoid profile with a lightening cut
for side in (-1, 1):
    y = side * 1.0
    cheek = box((1.75, 0.3, 1.75), loc=(PIVOT_X - 0.05, y, DECK_TOP + 0.85), mat=ARMOR, bevel=0.06, segments=2)
    cut(cheek, box((1.0, 0.6, 1.0), loc=(PIVOT_X + 0.95, y, DECK_TOP + 1.95), rot=(0, math.radians(40), 0)))
    cut(cheek, box((1.0, 0.6, 1.0), loc=(PIVOT_X - 1.05, y, DECK_TOP + 1.95), rot=(0, math.radians(-40), 0)))
    cut(cheek, cylinder(0.26, 0.6, loc=(PIVOT_X - 0.35, y, DECK_TOP + 0.42), rot=(math.pi / 2, 0, 0), verts=24))
    turret.append(cheek)
    # Outer armour plate on the cheek
    plate = box((1.25, 0.08, 0.95), loc=(PIVOT_X - 0.1, side * 1.19, DECK_TOP + 0.62), mat=ARMOR_DARK, bevel=0.03)
    for k in range(3):
        cut(plate, box((0.7, 0.2, 0.05), loc=(PIVOT_X - 0.15, side * 1.23, DECK_TOP + 0.4 + k * 0.16)))
    turret.append(plate)
    # Trunnion hub with a bolt circle
    turret.append(cylinder(0.42, 0.14, loc=(PIVOT_X, side * 1.2, PZ), rot=(math.pi / 2, 0, 0), verts=24, mat=STEEL, bevel=0.03))
    turret.append(cylinder(0.24, 0.1, loc=(PIVOT_X, side * 1.3, PZ), rot=(math.pi / 2, 0, 0), verts=24, mat=ARMOR_DARK, bevel=0.02))
    for k in range(6):
        a = math.radians(k * 60)
        turret.append(cylinder(0.045, 0.05, loc=(PIVOT_X + math.cos(a) * 0.33, side * 1.29, PZ + math.sin(a) * 0.33),
                               rot=(math.pi / 2, 0, 0), verts=6, mat=GUN))

# Sensor pod on the right cheek, whip antenna on the left
turret.append(box((0.4, 0.3, 0.28), loc=(PIVOT_X - 0.25, -1.0, DECK_TOP + 1.88), mat=GUN, bevel=0.05))
turret.append(cylinder(0.1, 0.06, loc=(PIVOT_X - 0.03, -1.0, DECK_TOP + 1.9), rot=(0, math.pi / 2, 0), verts=16, mat=LENS))
turret.append(cylinder(0.025, 0.9, loc=(PIVOT_X - 0.5, 1.0, DECK_TOP + 2.2), verts=8, mat=STEEL))
turret.append(sphere(0.05, loc=(PIVOT_X - 0.5, 1.0, DECK_TOP + 2.66), mat=GLOW))

# Shell pannier hung off the back: open-top rack with six rounds standing in it
PX = -2.05
rack = box((0.7, 1.9, 0.7), loc=(PX, 0, YAW_Z + 0.55), mat=ARMOR_DARK, bevel=0.05)
cut(rack, box((0.56, 1.76, 0.7), loc=(PX, 0, YAW_Z + 0.9)))
for k in range(2):  # lightening slots in the back wall
    cut(rack, box((0.3, 0.6, 0.18), loc=(PX - 0.3, -0.45 + k * 0.9, YAW_Z + 0.55)))
turret.append(rack)
turret.append(box((0.5, 1.5, 0.12), loc=(PX + 0.5, 0, YAW_Z + 0.4), mat=ARMOR, bevel=0.03))  # bracket to the deck
turret += hazard_strip(1.7, 0.12, loc=(PX - 0.36, 0, YAW_Z + 0.82), rot_z=math.radians(90))
for row, dx in enumerate((-0.12, 0.12)):
    for k in range(3):
        y = -0.55 + k * 0.55 + (0.12 if row else -0.12)
        z0 = YAW_Z + 0.32
        turret.append(cylinder(0.12, 0.6, loc=(PX + dx, y, z0 + 0.3), verts=12, mat=SHELL))
        turret.append(cylinder(0.12, 0.22, radius2=0.03, loc=(PX + dx, y, z0 + 0.71), verts=12, mat=GUN))
        turret.append(torus(0.122, 0.022, loc=(PX + dx, y, z0 + 0.48), mat=GLOW, major_seg=12, minor_seg=4))
join('Turret', turret, parent=yaw)

# ── Cradle (pitch): trunnion collar and recoil cylinders ────────────────────
pitch = empty('Pitch', parent=yaw, loc=(PIVOT_X, 0, PIVOT_DZ))
recoil = empty('Recoil', parent=pitch)
X0 = PIVOT_X  # world x of the pivot; everything below is built level along +X
cradle = [
    cylinder(0.74, 0.62, loc=(X0, 0, PZ), rot=(0, math.pi / 2, 0), verts=32, mat=ARMOR, bevel=0.05),
    cylinder(0.3, 1.9, loc=(X0, 0, PZ), rot=(math.pi / 2, 0, 0), verts=20, mat=STEEL, bevel=0.03),  # trunnion pin
]
for k in range(2):  # clamp ridges on the collar
    cradle.append(torus(0.75, 0.035, loc=(X0 - 0.2 + k * 0.4, 0, PZ), rot=(0, math.pi / 2, 0), mat=STEEL, major_seg=32, minor_seg=6))
# Hydraulic recoil buffers above the tube
for sy in (-1, 1):
    y, z = sy * 0.42, PZ + 0.6
    cradle.append(cylinder(0.13, 1.25, loc=(X0 + 0.25, y, z), rot=(0, math.pi / 2, 0), verts=20, mat=ARMOR_DARK, bevel=0.03))
    cradle.append(cylinder(0.15, 0.08, loc=(X0 + 0.86, y, z), rot=(0, math.pi / 2, 0), verts=20, mat=STEEL))
    cradle.append(box((0.3, 0.16, 0.3), loc=(X0, y, PZ + 0.5), mat=ARMOR, bevel=0.03))  # mount on the collar
cradle.append(curve_tube('HydraulicHose', [(X0 - 0.3, -0.42, PZ + 0.62), (X0 - 0.55, -0.25, PZ + 0.85),
                                           (X0 - 0.55, 0.25, PZ + 0.85), (X0 - 0.3, 0.42, PZ + 0.62)], 0.045, RUBBER))
join('Cradle', cradle, parent=pitch)

# ── Tube (recoil): thick short barrel, reinforcing rings, glowing bore ─────
TUBE_R, BORE_R = 0.58, 0.44
T0, T1 = X0 - 0.45, X0 + 1.95          # breech face → muzzle face
tube_parts = []
tube = cylinder(TUBE_R, T1 - T0, loc=((T0 + T1) / 2, 0, PZ), rot=(0, math.pi / 2, 0), verts=36, mat=GUN, bevel=0.03)
cut(tube, cylinder(BORE_R, 1.4, loc=(T1, 0, PZ), rot=(0, math.pi / 2, 0), verts=36))
tube_parts.append(tube)
# Glowing charge at the bottom of the bore, with a dark ring around it
tube_parts.append(cylinder(BORE_R - 0.06, 0.04, loc=(T1 - 0.68, 0, PZ), rot=(0, math.pi / 2, 0), verts=32, mat=GLOW))
tube_parts.append(torus(BORE_R - 0.04, 0.03, loc=(T1 - 0.66, 0, PZ), rot=(0, math.pi / 2, 0), mat=GLOW, minor_seg=8))
# Muzzle reinforcement: a flared ring
muzzle_ring = cylinder(0.7, 0.32, radius2=0.66, loc=(T1 - 0.16, 0, PZ), rot=(0, math.pi / 2, 0), verts=36, mat=STEEL, bevel=0.03)
cut(muzzle_ring, cylinder(BORE_R, 0.5, loc=(T1 - 0.16, 0, PZ), rot=(0, math.pi / 2, 0), verts=36))
tube_parts.append(muzzle_ring)
for x in (X0 + 0.55, X0 + 1.1):
    tube_parts.append(cylinder(0.64, 0.12, loc=(x, 0, PZ), rot=(0, math.pi / 2, 0), verts=36, mat=ARMOR_DARK, bevel=0.025))
# Recoil rod lug: buffer pistons ride in the cradle cylinders
lug = box((0.18, 1.0, 0.26), loc=(X0 + 1.55, 0, PZ + 0.52), mat=ARMOR, bevel=0.04)
tube_parts.append(lug)
for sy in (-1, 1):
    tube_parts.append(cylinder(0.065, 0.7, loc=(X0 + 1.2, sy * 0.42, PZ + 0.6), rot=(0, math.pi / 2, 0), verts=12, mat=STEEL))
# Breech: tapered block and cap
tube_parts.append(cylinder(0.56, 0.35, radius2=0.5, loc=(T0 - 0.17, 0, PZ), rot=(0, -math.pi / 2, 0), verts=32, mat=ARMOR_DARK, bevel=0.03))
tube_parts.append(cylinder(0.36, 0.1, loc=(T0 - 0.39, 0, PZ), rot=(0, math.pi / 2, 0), verts=32, mat=STEEL, bevel=0.02))
join('Tube', tube_parts, parent=recoil)
empty('Muzzle', parent=recoil, loc=(T1 - X0, 0, 0))

# Fixed lob elevation (+X tilts up)
pitch.rotation_euler = (0, -ELEVATION, 0)
bpy.context.view_layer.update()

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'mortar.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True)
print('exported', os.path.join(OUT, 'mortar.glb'), os.path.getsize(os.path.join(OUT, 'mortar.glb')), 'bytes')
print('muzzle world', tuple(round(v, 3) for v in bpy.data.objects['Muzzle'].matrix_world.translation))

setup_render_stage(target_height=3.2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'mortar.blend'))
print('saved', os.path.join(OUT, 'mortar.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
for o in mesh_objs:
    print('  ', o.name, len(o.data.loop_triangles))
