"""Guardian ("Bastion Mk.I") enemy — armoured tracked tank, procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_guardian.py <out_dir>
    blender -b -P tools/models/build_guardian.py -- <out_dir>

Writes <out_dir>/guardian.glb (game asset) and <out_dir>/guardian.blend (model + render stage).
Hierarchy: Guardian > Tracks, Hull, Turret > TurretBody
Origin at ground contact, +X forward (direction of travel), Z up.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix
import bmesh  # noqa: E402  (bmesh is only importable once bpy is loaded)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, sphere, cut, join,  # noqa: E402
                    setup_render_stage, _finish)
from bake import bake_model, EXPORT_IMAGES  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
# Slate steel, lighter than the battlefield deck so the tank reads from the game camera
ARMOR = material('HullArmor', '#7a8796', metallic=0.6, roughness=0.4)
PLATE = material('HullPlate', '#8e9aa8', metallic=0.55, roughness=0.36)
DARK = material('HullDark', '#2b323b', metallic=0.6, roughness=0.5)
STEEL = material('Steel', '#a7b0bb', metallic=1.0, roughness=0.3)
GUN = material('Gunmetal', '#1d2228', metallic=0.85, roughness=0.32)
TRACK = material('Track', '#16191d', metallic=0.4, roughness=0.75)
GLOW = material('EnemyGlow', '#05070a', roughness=0.3, emission='#ffb000', emission_strength=7)
VISOR = material('EnemyVisor', '#05070a', roughness=0.1, emission='#7895c2', emission_strength=4)


def _object(name, bm):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return obj


def prism(points, width, y=0.0, mat=None, bevel=0.0, segments=2, angle=40, top_inset=0.0):
    """Convex side profile [(x, z), ...] in the XZ plane, extruded `width` along Y around `y`.

    top_inset pulls the vertices above the profile's mid-height inwards on both sides, giving
    the sloped flanks of armoured hulls.
    """
    bm = bmesh.new()
    zs = [p[1] for p in points]
    zmid = (min(zs) + max(zs)) / 2
    rings = []
    for side in (-1, 1):
        ring = []
        for x, z in points:
            inset = top_inset if z > zmid + 1e-6 else 0.0
            ring.append(bm.verts.new((x, y + side * (width / 2 - inset), z)))
        rings.append(ring)
    a, b = rings
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    return _finish(_object('prism', bm), mat, bevel, segments, angle)


def slab(points, z0, height, mat=None, bevel=0.0, segments=2, angle=40, top_scale=1.0, pivot=(0, 0)):
    """Convex plan outline [(x, y), ...] extruded up from z0; the top is scaled about `pivot`."""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in points]
    top = [bm.verts.new((pivot[0] + (x - pivot[0]) * top_scale, pivot[1] + (y - pivot[1]) * top_scale, z0 + height))
           for x, y in points]
    bm.faces.new(bot)
    bm.faces.new(list(reversed(top)))
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    return _finish(_object('slab', bm), mat, bevel, segments, angle)


def stadium(cx, cz, r, seg=12):
    """Side profile of a track run: two semicircles of radius r centred at x = ±cx, height cz."""
    pts = [(cx + r * math.cos(math.radians(-90 + 180 * k / seg)), cz + r * math.sin(math.radians(-90 + 180 * k / seg)))
           for k in range(seg + 1)]
    pts += [(-cx + r * math.cos(math.radians(90 + 180 * k / seg)), cz + r * math.sin(math.radians(90 + 180 * k / seg)))
            for k in range(seg + 1)]
    return pts


root = empty('Guardian')

# ── Running gear: track belts with cleats, road wheels, idler, sprocket ─────
TRACK_Y, TRACK_W = 1.15, 0.62
RUN_CX, RUN_CZ, RUN_R = 1.3, 0.44, 0.4   # belt bottom at z 0.04, cleats reach the ground
tracks = []
for side in (-1, 1):
    y = side * TRACK_Y
    belt = prism(stadium(RUN_CX, RUN_CZ, RUN_R), TRACK_W, y=y, mat=TRACK)
    cut(belt, prism(stadium(RUN_CX, RUN_CZ, RUN_R - 0.1), TRACK_W + 0.4, y=y))
    tracks.append(belt)
    # Cleats around the outside of the belt
    def cleat(x, z, theta):
        tracks.append(box((0.08, TRACK_W + 0.02, 0.05), loc=(x, y, z), rot=(0, math.radians(90) - theta, 0), mat=TRACK))
    k = 0
    while -RUN_CX + 0.1 + k * 0.2 < RUN_CX:
        x = -RUN_CX + 0.1 + k * 0.2
        cleat(x, RUN_CZ - RUN_R - 0.015, math.radians(-90))
        cleat(x, RUN_CZ + RUN_R + 0.015, math.radians(90))
        k += 1
    for k in range(1, 7):
        t = math.radians(-90 + k * 180 / 7)
        cleat(RUN_CX + (RUN_R + 0.015) * math.cos(t), RUN_CZ + (RUN_R + 0.015) * math.sin(t), t)
        t2 = math.radians(90 + k * 180 / 7)
        cleat(-RUN_CX + (RUN_R + 0.015) * math.cos(t2), RUN_CZ + (RUN_R + 0.015) * math.sin(t2), t2)
    # Five dual road wheels riding on the inside of the belt
    for k in range(5):
        x = -1.0 + k * 0.5
        for dy in (-0.16, 0.16):
            tracks.append(cylinder(0.27, 0.24, loc=(x, y + dy, RUN_CZ - 0.02), rot=(math.pi / 2, 0, 0), verts=16, mat=ARMOR, bevel=0.03, segments=1))
        tracks.append(cylinder(0.11, TRACK_W + 0.04, loc=(x, y, RUN_CZ - 0.02), rot=(math.pi / 2, 0, 0), verts=12, mat=STEEL, bevel=0.015))
    # Front idler and rear drive sprocket with teeth
    tracks.append(cylinder(0.26, TRACK_W - 0.06, loc=(RUN_CX, y, RUN_CZ), rot=(math.pi / 2, 0, 0), verts=20, mat=ARMOR, bevel=0.03))
    sprocket = cylinder(0.27, TRACK_W - 0.06, loc=(-RUN_CX, y, RUN_CZ), rot=(math.pi / 2, 0, 0), verts=20, mat=DARK, bevel=0.03)
    tracks.append(sprocket)
    for k in range(10):
        a = math.radians(k * 36)
        tracks.append(box((0.08, TRACK_W - 0.1, 0.08), loc=(-RUN_CX + math.cos(a) * 0.28, y, RUN_CZ + math.sin(a) * 0.28),
                          rot=(0, -a, 0), mat=DARK))
    for x in (-RUN_CX, RUN_CX):
        tracks.append(cylinder(0.12, TRACK_W + 0.04, loc=(x, y, RUN_CZ), rot=(math.pi / 2, 0, 0), verts=12, mat=STEEL, bevel=0.015))
    # Return rollers under the top run
    for x in (-0.55, 0.45):
        tracks.append(cylinder(0.075, TRACK_W - 0.12, loc=(x, y, RUN_CZ + 0.235), rot=(math.pi / 2, 0, 0), verts=12, mat=STEEL))
join('Tracks', tracks, parent=root)

# ── Hull: lower tub, faceted upper hull with glacis, fenders, side skirts ───
hull = []
hull.append(prism([(-1.6, 0.3), (1.5, 0.3), (1.95, 0.9), (-1.75, 0.9)], 1.66, mat=DARK, bevel=0.04))
upper = prism([(1.95, 0.88), (2.0, 0.98), (0.8, 1.32), (-1.25, 1.34), (-1.75, 1.12), (-1.75, 0.88)], 2.5,
              mat=ARMOR, bevel=0.06, segments=3, angle=30, top_inset=0.2)
# Chamfered corners in plan view turn the box into a long hexagon
for sx, x, s in ((1, 2.0, 0.85), (-1, -1.75, 0.55)):
    for sy in (-1, 1):
        cut(upper, box((s, s, 2.0), loc=(x, sy * 1.25, 1.0), rot=(0, 0, math.radians(45))))
# Engine deck grilles
for k in range(5):
    cut(upper, box((0.5, 0.07, 0.3), loc=(-1.25, -0.5 + k * 0.25, 1.34)))
hull.append(upper)
# Appliqué armour on the glacis
glacis = math.atan2(1.32 - 0.98, 2.0 - 0.8)
for sy in (-1, 1):
    hull.append(box((0.95, 0.78, 0.07), loc=(1.37, sy * 0.47, 1.18), rot=(0, glacis, 0), mat=PLATE, bevel=0.025))
# Fenders over the tracks
for sy in (-1, 1):
    y = sy * 1.17
    hull.append(box((3.5, 0.72, 0.06), loc=(0.0, y, 0.91), mat=DARK, bevel=0.015))
    # Side skirts in three panels, slightly splayed, bolted along the top
    for k in range(3):
        x = -1.08 + k * 1.08
        hull.append(box((1.02, 0.07, 0.46), loc=(x, sy * 1.53, 0.69), rot=(sy * math.radians(-6), 0, 0), mat=ARMOR, bevel=0.025))
        for b in (-0.36, 0, 0.36):
            hull.append(cylinder(0.035, 0.04, loc=(x + b, sy * 1.575, 0.84), rot=(math.pi / 2, 0, 0), verts=8, mat=STEEL))
    # Headlight housings with amber running lights on the fender fronts
    hull.append(box((0.22, 0.3, 0.16), loc=(1.5, sy * 1.05, 1.02), mat=DARK, bevel=0.03))
    hull.append(box((0.04, 0.22, 0.09), loc=(1.61, sy * 1.05, 1.02), mat=GLOW))
    # Rear exhaust boxes
    hull.append(box((0.24, 0.42, 0.22), loc=(-1.72, sy * 0.62, 1.0), mat=DARK, bevel=0.03))
    for k in range(3):
        hull.append(box((0.04, 0.34, 0.03), loc=(-1.85, sy * 0.62, 0.93 + k * 0.07), mat=GUN))
    # Amber tail lights between the exhausts
    hull.append(box((0.04, 0.16, 0.07), loc=(-1.765, sy * 0.24, 1.04), mat=GLOW))
    # Tow hooks on the lower front plate
    hull.append(box((0.14, 0.1, 0.18), loc=(1.8, sy * 0.55, 0.62), rot=(0, math.radians(-53), 0), mat=STEEL, bevel=0.02))
# Driver's hatch and vision block on the front deck
hull.append(cylinder(0.2, 0.06, loc=(0.82, 0.48, 1.33), verts=20, mat=PLATE, bevel=0.015))
hull.append(box((0.1, 0.3, 0.08), loc=(1.02, 0.48, 1.29), rot=(0, glacis, 0), mat=VISOR))
join('Hull', hull, parent=root)

# ── Turret: faceted wedge, gun with muzzle brake, sights, smoke launchers ──
TX, TZ = -0.15, 1.36
turret_e = empty('Turret', parent=root, loc=(TX, 0, TZ))
tur = [cylinder(0.82, 0.1, loc=(TX, 0, TZ + 0.03), verts=40, mat=STEEL, bevel=0.02)]
outline = [(TX + 0.95, 0.0), (TX + 0.55, 0.72), (TX - 0.65, 0.8), (TX - 1.05, 0.55),
           (TX - 1.05, -0.55), (TX - 0.65, -0.8), (TX + 0.55, -0.72)]
body = slab(outline, TZ + 0.07, 0.52, mat=ARMOR, bevel=0.05, segments=3, angle=30, top_scale=0.82, pivot=(TX - 0.15, 0))
# Embrasure for the gun mantlet
cut(body, box((0.5, 0.42, 0.34), loc=(TX + 0.95, 0, TZ + 0.33)))
tur.append(body)
tur.append(box((0.32, 0.46, 0.34), loc=(TX + 0.83, 0, TZ + 0.33), mat=DARK, bevel=0.04))   # mantlet
GUN_Z = TZ + 0.33
tur.append(cylinder(0.075, 1.7, loc=(TX + 1.75, 0, GUN_Z), rot=(0, math.pi / 2, 0), verts=16, mat=GUN))
tur.append(cylinder(0.12, 0.34, loc=(TX + 1.4, 0, GUN_Z), rot=(0, math.pi / 2, 0), verts=20, mat=GUN, bevel=0.03))  # fume extractor
brake = cylinder(0.11, 0.26, loc=(TX + 2.55, 0, GUN_Z), rot=(0, math.pi / 2, 0), verts=16, mat=GUN, bevel=0.02)
for dx in (-0.06, 0.06):
    cut(brake, box((0.06, 0.4, 0.12), loc=(TX + 2.55 + dx, 0, GUN_Z)))
cut(brake, cylinder(0.05, 0.4, loc=(TX + 2.65, 0, GUN_Z), rot=(0, math.pi / 2, 0), verts=12))
tur.append(brake)
# Cheek armour blocks either side of the mantlet
for sy in (-1, 1):
    tur.append(box((0.55, 0.22, 0.3), loc=(TX + 0.55, sy * 0.48, TZ + 0.42), rot=(0, 0, sy * math.radians(-28)), mat=PLATE, bevel=0.03))
# Commander's sight: armoured box with a wide glowing visor facing forward
tur.append(box((0.32, 0.5, 0.18), loc=(TX + 0.05, -0.3, TZ + 0.66), mat=DARK, bevel=0.04))
tur.append(box((0.04, 0.42, 0.08), loc=(TX + 0.21, -0.3, TZ + 0.67), mat=VISOR))
tur.append(cylinder(0.05, 0.1, loc=(TX + 0.05, -0.3, TZ + 0.78), verts=10, mat=STEEL))
# Hatch with hinge, periscopes
tur.append(cylinder(0.24, 0.07, loc=(TX - 0.45, 0.32, TZ + 0.62), verts=24, mat=PLATE, bevel=0.02))
tur.append(cylinder(0.04, 0.3, loc=(TX - 0.67, 0.32, TZ + 0.63), rot=(math.pi / 2, 0, 0), verts=8, mat=STEEL))
for a in (-40, 0, 40):
    r = math.radians(a)
    tur.append(box((0.08, 0.12, 0.07), loc=(TX - 0.45 + 0.3 * math.cos(r), 0.32 + 0.3 * math.sin(r), TZ + 0.62),
                   rot=(0, 0, r), mat=GUN))
# Smoke grenade launchers: three angled tubes per side on a bracket
for sy in (-1, 1):
    tur.append(box((0.3, 0.12, 0.12), loc=(TX + 0.15, sy * 0.78, TZ + 0.4), rot=(0, 0, sy * math.radians(-12)), mat=DARK, bevel=0.02))
    for k in range(3):
        tur.append(cylinder(0.05, 0.2, loc=(TX + 0.05 + k * 0.1, sy * 0.86, TZ + 0.5),
                            rot=(sy * math.radians(-40), math.radians(25), 0), verts=10, mat=GUN))
# Rear stowage basket and antenna with an amber beacon
tur.append(box((0.32, 1.2, 0.3), loc=(TX - 1.15, 0, TZ + 0.3), mat=DARK, bevel=0.03))
for k in range(4):
    tur.append(box((0.34, 0.03, 0.32), loc=(TX - 1.15, -0.45 + k * 0.3, TZ + 0.3), mat=STEEL))
tur.append(cylinder(0.02, 0.85, loc=(TX - 0.8, -0.5, TZ + 0.98), verts=6, mat=STEEL))
tur.append(cylinder(0.05, 0.04, loc=(TX - 0.8, -0.5, TZ + 0.57), verts=10, mat=DARK))
tur.append(sphere(0.045, loc=(TX - 0.8, -0.5, TZ + 1.42), mat=GLOW, segments=12, rings=8))
turret_body = join('TurretBody', tur, parent=turret_e)
# A slightly oversized turret keeps the silhouette readable at the game's zoom
turret_body.data.transform(Matrix.Scale(1.12, 4))

# ── Weather and bake textures (skip with --no-bake) ───────────────────────
bake_model(root)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'guardian.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, **EXPORT_IMAGES)
print('exported', os.path.join(OUT, 'guardian.glb'), os.path.getsize(os.path.join(OUT, 'guardian.glb')), 'bytes')

setup_render_stage(target_height=1.1)
bpy.data.objects['Camera'].data.ortho_scale = 6.0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'guardian.blend'))
print('saved', os.path.join(OUT, 'guardian.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
