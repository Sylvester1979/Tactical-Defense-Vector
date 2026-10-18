"""Scout (recon drone) enemy — procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_scout.py <out_dir>
    blender -b -P tools/models/build_scout.py -- <out_dir>

Writes <out_dir>/scout.glb (game asset) and <out_dir>/scout.blend (model + render stage).
Hierarchy: Scout > Hull, Rotor_L > RotorBlades_L, Rotor_R > RotorBlades_R
Origin is the centre of mass (the game hovers and banks the root); +X is the direction of travel.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, sphere, cut, join,  # noqa: E402
                    setup_render_stage)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
SHELL = material('ScoutShell', '#b9c2cd', metallic=0.6, roughness=0.32)
SHELL_DARK = material('ScoutPanel', '#5c6672', metallic=0.7, roughness=0.4)
DUCT = material('ScoutDuct', '#1b2028', metallic=0.75, roughness=0.42)
BLADE = material('ScoutBlade', '#0f1216', metallic=0.4, roughness=0.55)
STEEL = material('ScoutSteel', '#9aa4b0', metallic=1.0, roughness=0.28)
GLOW = material('EnemyGlow', '#05070a', roughness=0.25, emission='#00f2ff', emission_strength=3.5)  # many small lights: keep the bloom from swallowing the hull
GLOW_SOFT = material('EnemyGlowSoft', '#06161a', roughness=0.06, metallic=0.3, emission='#00f2ff', emission_strength=1.2)


def scaled_sphere(radius, scale, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, segments=32, rings=16):
    """UV sphere stretched into an ellipsoid (scale baked into the mesh)."""
    s = sphere(radius, loc=loc, mat=mat, segments=segments, rings=rings)
    s.rotation_euler = rot
    s.scale = scale
    bpy.context.view_layer.objects.active = s
    bpy.ops.object.select_all(action='DESELECT')
    s.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return s


def taper(obj):
    """Shape an ellipsoid into a dart: pointed nose, widest just behind the middle, narrower tail."""
    for v in obj.data.vertices:
        t = (v.co.x + 1.05) / 2.1  # 0 at the tail, 1 at the nose
        f = 0.78 + 0.22 * math.sin(min(t / 0.45, 1) * math.pi / 2) if t < 0.45 else 1 - 0.62 * ((t - 0.45) / 0.55) ** 1.6
        v.co.y *= f
        v.co.z *= f if v.co.z > 0 else 0.6 + 0.4 * f
    return obj


root = empty('Scout')

# ── Hull: lean lifting body with a pointed nose, dorsal spine and tail fins ─
hull = []
body = taper(scaled_sphere(1.0, (1.05, 0.46, 0.3), mat=SHELL, segments=40, rings=20))
# Flatten the belly so it reads as a machined hull rather than an egg
cut(body, box((3.0, 2.0, 0.5), loc=(0, 0, -0.42)))
# Two panel grooves around the fuselage
for x in (0.22, -0.42):
    groove = box((0.035, 2.0, 1.0), loc=(x, 0, 0))
    keep = taper(scaled_sphere(1.0, (1.03, 0.445, 0.285), segments=40, rings=20))
    cut(groove, keep)
    cut(body, groove)
hull.append(body)
hull.append(box((0.42, 0.9, 0.06), loc=(0.02, 0, -0.18), mat=SHELL_DARK, bevel=0.025))     # belly plate
# Dorsal spine running back from the canopy
hull.append(box((0.95, 0.2, 0.14), loc=(-0.38, 0, 0.24), mat=SHELL_DARK, bevel=0.05))
for k in range(3):  # cooling slats on the spine
    hull.append(box((0.06, 0.24, 0.03), loc=(-0.22 - k * 0.17, 0, 0.32), mat=STEEL))
# Glowing sensor canopy with a frame
hull.append(scaled_sphere(0.3, (1.5, 0.62, 0.5), loc=(0.36, 0, 0.17), rot=(0, math.radians(-8), 0), mat=GLOW_SOFT, segments=28, rings=14))
hull.append(box((0.62, 0.03, 0.03), loc=(0.36, 0, 0.32), rot=(0, math.radians(-8), 0), mat=SHELL_DARK))  # canopy frame
# Sensor mandibles either side of the nose: thin forward prongs with glowing tips
for side in (-1, 1):
    hull.append(cylinder(0.03, 0.55, loc=(0.82, side * 0.17, -0.08), rot=(0, math.pi / 2, side * math.radians(-6)), verts=8, mat=STEEL))
    hull.append(sphere(0.035, loc=(1.1, side * 0.2, -0.08), mat=GLOW, segments=10, rings=6))
# Nose sensor: dark chin pod with a bright eye
hull.append(scaled_sphere(0.16, (1.3, 1.0, 0.8), loc=(0.82, 0, -0.1), mat=DUCT, segments=20, rings=10))
hull.append(sphere(0.075, loc=(0.99, 0, -0.1), mat=GLOW, segments=16, rings=8))
# Swept twin tail fins, canted outwards
for side in (-1, 1):
    fin = box((0.42, 0.035, 0.3), loc=(-0.78, side * 0.2, 0.26), rot=(side * math.radians(28), 0, 0), mat=SHELL, bevel=0.012)
    cut(fin, box((0.5, 0.2, 0.4), loc=(-0.48, side * 0.2, 0.5), rot=(0, math.radians(-38), 0)))  # swept leading edge
    hull.append(fin)
    hull.append(box((0.08, 0.04, 0.05), loc=(-0.94, side * 0.29, 0.39), rot=(side * math.radians(28), 0, 0), mat=GLOW))  # fin tip light
# Rear thruster: nozzle with a glowing core
nozzle = cylinder(0.19, 0.3, loc=(-1.0, 0, 0.0), rot=(0, math.pi / 2, 0), verts=24, mat=DUCT, bevel=0.02)
cut(nozzle, cylinder(0.14, 0.3, loc=(-1.12, 0, 0.0), rot=(0, math.pi / 2, 0), verts=24))
hull.append(nozzle)
hull.append(cylinder(0.135, 0.02, loc=(-1.02, 0, 0.0), rot=(0, math.pi / 2, 0), verts=24, mat=GLOW))
hull.append(torus(0.195, 0.022, loc=(-1.15, 0, 0.0), rot=(0, math.pi / 2, 0), mat=STEEL, minor_seg=6, major_seg=24))
# Whip antenna, raked back
hull.append(cylinder(0.014, 0.55, loc=(-0.6, -0.1, 0.48), rot=(0, math.radians(-30), 0), verts=6, mat=STEEL))
hull.append(sphere(0.03, loc=(-0.74, -0.1, 0.72), mat=GLOW, segments=10, rings=6))

# ── Ducted rotors on swept pylons ──────────────────────────────────────────
DUCT_X, DUCT_Y, DUCT_Z = -0.12, 1.0, 0.02
DUCT_R_OUT, DUCT_R_IN, DUCT_H = 0.5, 0.43, 0.2
for side in (-1, 1):
    cy = side * DUCT_Y
    # Stub pylon from the fuselage into the duct wall, with a fairing and a light strip on top
    pylon = box((0.34, 0.36, 0.1), loc=(DUCT_X, side * 0.4, 0.05), mat=SHELL, bevel=0.03)
    cut(pylon, box((0.3, 0.5, 0.3), loc=(DUCT_X + 0.27, side * 0.45, 0.05), rot=(0, 0, side * math.radians(-35))))  # swept front
    hull.append(pylon)
    hull.append(box((0.16, 0.3, 0.02), loc=(DUCT_X - 0.04, side * 0.41, 0.105), mat=SHELL_DARK))
    duct = cylinder(DUCT_R_OUT, DUCT_H, loc=(DUCT_X, cy, DUCT_Z), verts=40, mat=DUCT, bevel=0.03, segments=2)
    cut(duct, cylinder(DUCT_R_IN, DUCT_H + 0.2, loc=(DUCT_X, cy, DUCT_Z), verts=40))
    hull.append(duct)
    # Light lip and glowing inner ring at the top of the duct
    hull.append(torus(DUCT_R_OUT - 0.005, 0.025, loc=(DUCT_X, cy, DUCT_Z + DUCT_H / 2), mat=SHELL, minor_seg=6, major_seg=40))
    hull.append(torus(DUCT_R_IN + 0.005, 0.018, loc=(DUCT_X, cy, DUCT_Z + DUCT_H / 2 - 0.03), mat=GLOW, minor_seg=6, major_seg=40))
    # Motor hub held by two struts across the duct, below the blades
    hull.append(cylinder(0.09, 0.14, loc=(DUCT_X, cy, DUCT_Z - 0.06), verts=16, mat=STEEL, bevel=0.015))
    for a in (45, 135):
        hull.append(box((DUCT_R_IN * 2, 0.04, 0.03), loc=(DUCT_X, cy, DUCT_Z - 0.08), rot=(0, 0, math.radians(a)), mat=DUCT))
    # Outboard navigation light
    hull.append(sphere(0.035, loc=(DUCT_X, side * (DUCT_Y + DUCT_R_OUT + 0.01), DUCT_Z), mat=GLOW, segments=10, rings=6))
join('Hull', hull, parent=root)

for side, tag in ((1, 'L'), (-1, 'R')):
    rotor = empty(f'Rotor_{tag}', parent=root, loc=(DUCT_X, side * DUCT_Y, DUCT_Z + 0.03))
    blades = [cylinder(0.06, 0.06, loc=(DUCT_X, side * DUCT_Y, DUCT_Z + 0.03), verts=12, mat=STEEL, bevel=0.01)]
    for k in range(3):
        a = math.radians(k * 120)
        r = 0.25
        blades.append(box((0.4, 0.09, 0.012), loc=(DUCT_X + math.cos(a) * r, side * DUCT_Y + math.sin(a) * r, DUCT_Z + 0.03),
                          rot=(math.radians(18), 0, a), mat=BLADE, bevel=0.004, segments=1))
    join(f'RotorBlades_{tag}', blades, parent=rotor)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'scout.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True)
print('exported', os.path.join(OUT, 'scout.glb'), os.path.getsize(os.path.join(OUT, 'scout.glb')), 'bytes')

# It hovers in the game: lift it off the review floor so its shadow reads
root.location = (0, 0, 1.4)
setup_render_stage(target_height=1.4)
bpy.context.scene.camera.data.ortho_scale = 3.7
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scout.blend'))
print('saved', os.path.join(OUT, 'scout.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
