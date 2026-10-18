"""Interceptor ("Shock Weaver") enemy — procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_interceptor.py <out_dir>
    blender -b -P tools/models/build_interceptor.py -- <out_dir>

Writes <out_dir>/interceptor.glb (game asset) and <out_dir>/interceptor.blend (model + render stage).
Hierarchy: Interceptor > Hull, Rotor_Weaver > WeaverRing
Origin is the centre of mass (the game hovers and banks the root); +X is the direction of travel.
"""
import math
import os
import sys

import bpy
import bmesh  # noqa: E402  (bmesh is only importable once bpy is loaded)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, sphere, cut, join,  # noqa: E402
                    setup_render_stage, _finish)
from bake import bake_model, EXPORT_IMAGES  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
HULL = material('InterceptorHull', '#323944', metallic=0.75, roughness=0.36)
PANEL = material('InterceptorPanel', '#b3bbc6', metallic=0.55, roughness=0.34)
DARK = material('InterceptorDark', '#14181e', metallic=0.7, roughness=0.45)
STEEL = material('InterceptorSteel', '#9aa4b0', metallic=1.0, roughness=0.28)
GLOW = material('EnemyGlow', '#05070a', roughness=0.25, emission='#ffb800', emission_strength=3.5)
GLOW_SOFT = material('EnemyGlowSoft', '#07080b', roughness=0.12, metallic=0.0, emission='#ffb800', emission_strength=0.15)  # smoked glass, faint amber


def _object(name, bm):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return obj


def slab(points, z0, height, mat=None, bevel=0.0, segments=2, angle=40, top_scale=1.0, pivot=(0, 0), bottom_scale=1.0):
    """Convex plan outline [(x, y), ...] extruded up from z0; top/bottom scaled about `pivot` (chamfered flanks)."""
    bm = bmesh.new()

    def ring(z, s):
        return [bm.verts.new((pivot[0] + (x - pivot[0]) * s, pivot[1] + (y - pivot[1]) * s, z)) for x, y in points]

    bot = ring(z0, bottom_scale)
    top = ring(z0 + height, top_scale)
    bm.faces.new(bot)
    bm.faces.new(list(reversed(top)))
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    return _finish(_object('slab', bm), mat, bevel, segments, angle)


def mirrored(points):
    """Plan outline for the other side (y negated, winding kept)."""
    return [(x, -y) for x, y in reversed(points)]


def along(a, b, thickness, height, z, mat, bevel=0.0):
    """Thin bar from plan point a to plan point b at height z."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    return box((math.hypot(dx, dy), thickness, height), loc=((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z),
               rot=(0, 0, math.atan2(dy, dx)), mat=mat, bevel=bevel)


root = empty('Interceptor')
hull = []

# ── Fuselage: faceted arrowhead with chamfered flanks ──────────────────────
FUSE = [(0.82, 0.0), (0.42, 0.13), (-0.15, 0.21), (-0.7, 0.19), (-0.86, 0.11),
        (-0.86, -0.11), (-0.7, -0.19), (-0.15, -0.21), (0.42, -0.13)]
body = slab(FUSE, -0.13, 0.25, mat=HULL, bevel=0.025, segments=2, top_scale=0.66, bottom_scale=0.82, pivot=(-0.1, 0))
# Panel seam across the back and a recess for the weaver mast
cut(body, box((0.03, 1.0, 0.6), loc=(-0.48, 0, 0.1)))
hull.append(body)
# Light dorsal panel (reads on the dark deck) and a darker spine strip down its middle
hull.append(slab([(0.38, 0.0), (0.1, 0.1), (-0.42, 0.12), (-0.42, -0.12), (0.1, -0.1)], 0.11, 0.035,
                 mat=PANEL, bevel=0.012, segments=1, top_scale=0.9, pivot=(-0.05, 0)))
hull.append(box((0.55, 0.035, 0.02), loc=(-0.12, 0, 0.152), mat=DARK))

# Canopy: low glazed blister over the nose, framed
canopy = sphere(0.2, loc=(0.36, 0, 0.1), mat=GLOW_SOFT, segments=24, rings=12)
canopy.scale = (1.4, 0.5, 0.42)
hull.append(canopy)
hull.append(box((0.48, 0.022, 0.022), loc=(0.36, 0, 0.18), mat=DARK))  # canopy frame
for side in (-1, 1):  # canopy sill rails
    hull.append(along((0.12, side * 0.1), (0.6, side * 0.05), 0.025, 0.03, 0.1, PANEL))

# ── Forward-swept blade wings with glowing leading edges ────────────────────
WING_R = [(-0.42, 0.17), (0.04, 0.17), (0.34, 0.8), (0.17, 0.86)]
for side, outline in ((1, WING_R), (-1, mirrored(WING_R))):
    wing = slab(outline, -0.025, 0.05, mat=HULL, bevel=0.012, segments=1, top_scale=0.97,
                pivot=(-0.1, side * 0.5))
    hull.append(wing)
    # Light panel inset on the upper surface
    inset = slab([(x * 0.8 - 0.04, y * 0.82 + side * 0.06) for x, y in outline], 0.02, 0.012,
                 mat=PANEL, bevel=0.004, segments=1, pivot=(0, side * 0.5))
    hull.append(inset)
    lead_a, lead_b = outline[1], outline[2]
    if side < 0:
        lead_a, lead_b = outline[2], outline[1]
    # Glow strip set just behind the leading edge, on top of the wing
    hull.append(along((lead_a[0] - 0.02, lead_a[1] + side * 0.06), (lead_b[0] - 0.06, lead_b[1] - side * 0.04),
                      0.025, 0.02, 0.03, GLOW))
    # Down-turned tip blade with a light
    tip = box((0.3, 0.03, 0.2), loc=(0.2, side * 0.85, -0.12), rot=(side * math.radians(-12), 0, math.radians(10 * side)),
              mat=DARK, bevel=0.01)
    cut(tip, box((0.3, 0.2, 0.3), loc=(0.42, side * 0.85, -0.2), rot=(0, math.radians(40), 0)))  # raked tip
    hull.append(tip)
    hull.append(sphere(0.03, loc=(0.3, side * 0.86, -0.01), mat=GLOW, segments=10, rings=6))

# ── Twin thruster nacelles ───────────────────────────────────────────────────
for side in (-1, 1):
    y = side * 0.23
    nac = cylinder(0.1, 0.46, loc=(-0.66, y, -0.02), rot=(0, math.pi / 2, 0), verts=20, mat=HULL, bevel=0.02)
    cut(nac, cylinder(0.072, 0.2, loc=(-0.93, y, -0.02), rot=(0, math.pi / 2, 0), verts=20))  # nozzle bore
    hull.append(nac)
    hull.append(cylinder(0.068, 0.02, loc=(-0.84, y, -0.02), rot=(0, math.pi / 2, 0), verts=20, mat=GLOW))  # hot core
    hull.append(torus(0.103, 0.018, loc=(-0.88, y, -0.02), rot=(0, math.pi / 2, 0), mat=STEEL, minor_seg=6, major_seg=20))
    hull.append(torus(0.103, 0.012, loc=(-0.52, y, -0.02), rot=(0, math.pi / 2, 0), mat=STEEL, minor_seg=6, major_seg=20))
    # Intake scoop ahead of the nacelle
    hull.append(box((0.16, 0.1, 0.08), loc=(-0.22, side * 0.24, -0.05), mat=DARK, bevel=0.015))
    # Small canted tail fin on top of each nacelle
    fin = box((0.26, 0.025, 0.18), loc=(-0.74, y, 0.12), rot=(side * math.radians(-18), 0, 0), mat=PANEL, bevel=0.008)
    cut(fin, box((0.3, 0.2, 0.3), loc=(-0.53, y, 0.28), rot=(0, math.radians(-42), 0)))  # swept leading edge
    hull.append(fin)

# ── Shock emitter at the nose: twin prongs and a glowing coil between them ──
for side in (-1, 1):
    prong = along((0.48, side * 0.12), (1.04, side * 0.07), 0.04, 0.05, -0.04, STEEL, bevel=0.01)
    hull.append(prong)
    hull.append(sphere(0.035, loc=(1.06, side * 0.068, -0.04), mat=GLOW, segments=10, rings=6))
hull.append(box((0.12, 0.26, 0.05), loc=(0.82, 0, -0.04), mat=DARK, bevel=0.015))  # emitter yoke
for k in range(3):  # coil windings around the emitter rod
    hull.append(torus(0.055, 0.014, loc=(0.9 + k * 0.05, 0, -0.04), rot=(0, math.pi / 2, 0), mat=GLOW, minor_seg=6, major_seg=16))
hull.append(cylinder(0.018, 0.22, loc=(0.95, 0, -0.04), rot=(0, math.pi / 2, 0), verts=8, mat=STEEL))
# Chin sensor
hull.append(sphere(0.05, loc=(0.62, 0, -0.14), mat=DARK, segments=12, rings=8))

# ── Dorsal mast for the weaver ring ─────────────────────────────────────────
WEAVER = (-0.22, 0.0, 0.27)
hull.append(cylinder(0.04, 0.16, loc=(WEAVER[0], 0, 0.19), verts=12, mat=STEEL, bevel=0.01))
join('Hull', hull, parent=root)

# The weaver: a spinning ring of three emitter nodes above the hull (game spins Rotor_* about local up)
weaver = empty('Rotor_Weaver', parent=root, loc=WEAVER)
# Flat dark band with a faint energy lip inside, three bright emitter pods and fine tie-rods
band = cylinder(0.33, 0.045, loc=WEAVER, verts=48, mat=DARK, bevel=0.01)
cut(band, cylinder(0.29, 0.2, loc=WEAVER, verts=48))
ring = [cylinder(0.06, 0.05, loc=WEAVER, verts=16, mat=STEEL, bevel=0.012), band,
        torus(0.29, 0.01, loc=WEAVER, mat=GLOW_SOFT, minor_seg=6, major_seg=48)]
for k in range(3):
    a = math.radians(k * 120 + 60)
    ring.append(along((WEAVER[0], 0), (WEAVER[0] + math.cos(a) * 0.3, math.sin(a) * 0.3), 0.014, 0.014, WEAVER[2], STEEL))
    a = math.radians(k * 120)
    pod = box((0.1, 0.07, 0.065), loc=(WEAVER[0] + math.cos(a) * 0.33, math.sin(a) * 0.33, WEAVER[2]), rot=(0, 0, a), mat=DARK, bevel=0.015)
    ring.append(pod)
    ring.append(sphere(0.035, loc=(WEAVER[0] + math.cos(a) * 0.37, math.sin(a) * 0.37, WEAVER[2]), mat=GLOW, segments=12, rings=8))
join('WeaverRing', ring, parent=weaver)

# ── Weather and bake textures (skip with --no-bake) ───────────────────────
bake_model(root)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'interceptor.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, **EXPORT_IMAGES)
print('exported', os.path.join(OUT, 'interceptor.glb'), os.path.getsize(os.path.join(OUT, 'interceptor.glb')), 'bytes')

# It hovers in the game: lift it off the review floor so its shadow reads
root.location = (0, 0, 1.2)
setup_render_stage(target_height=1.2)
bpy.context.scene.camera.data.ortho_scale = 3.2
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'interceptor.blend'))
print('saved', os.path.join(OUT, 'interceptor.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
